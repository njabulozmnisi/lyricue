<!--
    KaraokeOutput.svelte — the karaoke rendering surface for both deployment modes.

    Per architecture.md §4.9 and ADR-16. This component is *adapter-agnostic*:
      - In **fork mode**, FreeShow's MainOutput.svelte mounts this when the output's
        karaokeMode flag is true. Envelopes arrive via FreeShow's OUTPUT IPC channel.
      - In **sister mode**, LyriCue's own BrowserWindow mounts this directly. Envelopes
        arrive via Electron IPC inside LyriCue's process tree.

    Either way, the component sees the same inputs:
      - A stream of envelopes (LC_LOAD_MAP — once per song change; LC_SYNC_FRAME — up to 60 Hz).
      - A `displaySettings` Svelte-store-compatible source so colors, opacity, fonts, and
        held-note style react live to operator changes (FR4.3, FR4.4).

    EP-06 scope (STORY-06.1 → 06.7):
      - Render the active slide's lines/words from the loaded TimingMap.
      - Each word: CSS sweep via `--progress` custom property (GPU-composited).
      - Word state classes (`sung`/`active`/`upcoming`) drive opacity from settings.
      - Line transitions: smooth scroll using Svelte's `fly` (STORY-06.3).
      - Held-note pulse keyframe (STORY-06.4) for words flagged `held=true`.
      - Next-section preview line (STORY-06.5) — SE-driven event lands in EP-09.
      - Resolution-adaptive sizing: vmin clamp + horizontal pan for ultrawide.
      - Parallel lyrics: secondary container, section-level advance only (STORY-06.7).

    No state lives in KR. Every visible pixel is derived from:
        (TimingMap, Arrangement?, ParallelLyricsTrack[]?, currentSyncFrame, displaySettings)
    This is essential for the 30 fps target (NFR1.3) — the CSS engine, not JS, drives the
    sweep, so the per-frame cost is one Svelte reactive-statement run + one inline-style
    update per active word.

    Closes M1-partial QA carry-forwards:
      - D6: gradient semantic + settings-driven colors (no more hardcoded #FFCC00/#666666).
      - D7: defensive frame validation at the boundary — malformed frames are dropped.
      - D10: outputId is a prop driven by the bootstrap; load-map payloads validate it
        against the prop and route correctly even in a multi-output configuration.
-->
<script lang="ts">
    import { onDestroy, tick } from "svelte"
    import { fly } from "svelte/transition"
    import { wordEaseMs } from "./karaoke-easing.js"

    /**
     * Identifier for this output window. The adapter tags every envelope with the
     * outputId so a multi-output setup can route correctly. We accept and store frames
     * + load-map payloads that match this id; mismatched ones are dropped silently
     * (the wire format permits broadcast to all outputs).
     */
    export let outputId: string

    /**
     * Optional dispatcher: the bootstrap installs an envelope consumer here. The
     * dispatcher receives every LC_SYNC_FRAME and LC_LOAD_MAP message addressed to
     * any output; this component decides whether to consume each.
     *
     * Returning an unsubscribe function lets the bootstrap clean up on destroy.
     * In unit tests, omitting this prop renders the component with no live data.
     */
    export let subscribe: ((handler: (envelope: EnvelopeLike) => void) => () => void) | undefined = undefined

    /**
     * Display-settings source. Svelte-store-compatible (anything with `subscribe`).
     * Live changes are reactive — color / opacity / font swaps don't require a remount.
     *
     * If omitted (e.g. in unit tests), we use the hard-coded defaults below. Production
     * always provides a real store wired to SettingsStore via IPC.
     */
    export let displaySettings: { subscribe: (run: (value: DisplaySettingsLike) => void) => () => void } | undefined = undefined

    /**
     * Envelope shape mirroring the wire format (`@lyricue/core/output`). Kept inline so
     * @lyricue/ui has no compile-time dep on the IPC channel constants — the literals
     * "LC_SYNC_FRAME" and "LC_LOAD_MAP" are the contract.
     */
    interface EnvelopeLike {
        channel: string
        data: unknown
    }

    /** Minimal SyncFrame shape; canonical type lives in @lyricue/core/output. */
    interface SyncFrameLike {
        outputId: string
        slideIndex: number
        wordIndex: number
        wordProgress: number
        tier: "auto" | "timer" | "manual"
        vad: "active" | "silent"
        nextSongTitle?: string | null
    }

    /** Minimal LoadMapPayload shape. */
    interface LoadMapPayloadLike {
        outputId: string
        showId: string
        timingMap: TimingMapLike
        arrangement: ArrangementLike | null
        parallelLyrics?: ParallelLyricsTrackLike[]
    }

    interface TimingWordLike {
        text: string
        startMs: number
        endMs: number
        lineIndex: number
        held?: boolean
    }
    interface TimingLineLike {
        startMs: number
        endMs: number
        wordStartIndex: number
        wordEndIndex: number
    }
    interface TimingSectionLike {
        id: string
        type: string
        label: string
        slideIndex: number
        startMs: number
        endMs: number
        words: TimingWordLike[]
        lines: TimingLineLike[]
    }
    interface TimingMapLike {
        showId: string
        language?: string
        sections: TimingSectionLike[]
        parallel?: ParallelLyricsTrackLike[]
    }
    interface ArrangementLike {
        sequence: { sectionId: string }[]
    }
    interface ParallelLyricsTrackLike {
        language: string
        sections: { sectionId: string; text: string }[]
    }

    /** Subset of DisplaySettings that the renderer reads. */
    interface DisplaySettingsLike {
        highlightColor: string
        sungColor: string
        upcomingColor: string
        sungWordOpacity: number
        fontSize: number
        fontFamily: string
        heldNoteAnimation: "pulse" | "glow" | "static"
        parallelLyricsEnabled: boolean
        primaryLyricsLanguage?: string
        parallelLyricsLanguage?: string
    }

    /**
     * Defaults applied when the parent doesn't supply a displaySettings store.
     * Values mirror DEFAULT_LYRICUE_SETTINGS.display — kept inline so @lyricue/ui has no
     * compile-time dep on the settings schema (UI components must work in storybook /
     * isolated previews where the full settings tree isn't available).
     */
    const DEFAULT_DISPLAY: DisplaySettingsLike = {
        highlightColor: "#FFCC00",
        sungColor: "#666666",
        upcomingColor: "#CCCCCC",
        sungWordOpacity: 0.4,
        fontSize: 48,
        fontFamily: "Inter",
        heldNoteAnimation: "pulse",
        parallelLyricsEnabled: false
    }

    // --- runtime state (no global stores; component-local) ---
    let currentFrame: SyncFrameLike | null = null
    let timingMap: TimingMapLike | null = null
    let arrangement: ArrangementLike | null = null
    let parallelLyrics: ParallelLyricsTrackLike[] = []
    let style: DisplaySettingsLike = DEFAULT_DISPLAY

    /**
     * Subscribe synchronously during script-body execution rather than in onMount.
     * Svelte's auto-subscription (`$store`) does the same — running before the first
     * render lets us receive a snapshot during initial mount, which avoids a flash of
     * the placeholder when a fast envelope arrives before onMount fires.
     */
    const envelopeUnsub: (() => void) | null = subscribe ? subscribe(handleEnvelope) : null
    const settingsUnsub: (() => void) | null = displaySettings
        ? displaySettings.subscribe((s) => {
              // Validate at boundary (D7): accept only objects that look like
              // DisplaySettingsLike. Missing fields fall back to DEFAULT_DISPLAY so
              // a partial settings push can't blank the screen.
              style = { ...DEFAULT_DISPLAY, ...(isDisplaySettings(s) ? s : {}) }
          })
        : null

    onDestroy(() => {
        envelopeUnsub?.()
        settingsUnsub?.()
    })

    function handleEnvelope(envelope: EnvelopeLike): void {
        if (!envelope || typeof envelope !== "object") return
        if (envelope.channel === "LC_SYNC_FRAME") {
            const frame = validateFrame(envelope.data)
            if (!frame) return
            if (frame.outputId !== outputId) return
            currentFrame = frame
        } else if (envelope.channel === "LC_LOAD_MAP") {
            const map = validateLoadMap(envelope.data)
            if (!map) return
            if (map.outputId !== outputId) return
            timingMap = map.timingMap
            arrangement = map.arrangement
            parallelLyrics = map.parallelLyrics ?? map.timingMap.parallel ?? []
            // Reset frame state so we don't render stale cursor positions against a new map.
            currentFrame = null
        }
        // Unknown channels: ignore. The wire is shared across modes; we don't gate on it.
    }

    /**
     * Validate a SyncFrame at the IPC boundary. Returns null for malformed data so the
     * caller can drop the frame without try/catching every renderer reactive statement.
     * D7 from the M1-partial QA pass.
     */
    function validateFrame(data: unknown): SyncFrameLike | null {
        if (!data || typeof data !== "object") return null
        const d = data as Record<string, unknown>
        if (typeof d.outputId !== "string") return null
        if (typeof d.slideIndex !== "number" || !Number.isFinite(d.slideIndex) || d.slideIndex < 0) return null
        if (typeof d.wordIndex !== "number" || !Number.isFinite(d.wordIndex) || d.wordIndex < 0) return null
        if (typeof d.wordProgress !== "number" || !Number.isFinite(d.wordProgress)) return null
        if (d.tier !== "auto" && d.tier !== "timer" && d.tier !== "manual") return null
        if (d.vad !== "active" && d.vad !== "silent") return null
        if (d.nextSongTitle !== undefined && d.nextSongTitle !== null && typeof d.nextSongTitle !== "string") {
            return null
        }
        return d as unknown as SyncFrameLike
    }

    /**
     * Validate a LoadMapPayload at the IPC boundary. Same rationale as validateFrame —
     * a malformed map must not crash the renderer. Returns null on failure; the caller
     * keeps the previous map and continues rendering.
     */
    function validateLoadMap(data: unknown): LoadMapPayloadLike | null {
        if (!data || typeof data !== "object") return null
        const d = data as Record<string, unknown>
        if (typeof d.outputId !== "string") return null
        if (typeof d.showId !== "string") return null
        if (!d.timingMap || typeof d.timingMap !== "object") return null
        const tm = d.timingMap as Record<string, unknown>
        if (!Array.isArray(tm.sections)) return null
        return d as unknown as LoadMapPayloadLike
    }

    function isDisplaySettings(value: unknown): value is Partial<DisplaySettingsLike> {
        return !!value && typeof value === "object"
    }

    /**
     * Resolve the section currently displayed given the (possibly custom) arrangement.
     * When arrangement is null, slideIndex indexes into the timing map's native section
     * order. When arrangement is non-null, slideIndex indexes into the arrangement's
     * sequence; we resolve each step's sectionId to a TimingSection.
     */
    $: activeSection = resolveSection(timingMap, arrangement, currentFrame?.slideIndex ?? 0)

    function resolveSection(map: TimingMapLike | null, arr: ArrangementLike | null, slideIndex: number): TimingSectionLike | null {
        if (!map) return null
        if (arr) {
            const step = arr.sequence[slideIndex]
            if (!step) return null
            return map.sections.find((s) => s.id === step.sectionId) ?? null
        }
        return map.sections[slideIndex] ?? null
    }

    /** Group the active section's words by lineIndex so we can render one row per line. */
    $: linesForActiveSection = groupWordsByLine(activeSection)

    function groupWordsByLine(section: TimingSectionLike | null): TimingWordLike[][] {
        if (!section) return []
        const buckets: TimingWordLike[][] = []
        for (const word of section.words) {
            const idx = Math.max(0, word.lineIndex)
            while (buckets.length <= idx) buckets.push([])
            buckets[idx]!.push(word)
        }
        return buckets
    }

    /**
     * Map a section-local word index (from SyncFrame.wordIndex) to the (lineIndex, wordIndex-in-line).
     * Returns null when the cursor is past the end of the section.
     */
    $: cursor = resolveCursor(activeSection, currentFrame?.wordIndex ?? 0)

    function resolveCursor(section: TimingSectionLike | null, wordIndex: number): { lineIdx: number; localWordIdx: number } | null {
        if (!section) return null
        if (wordIndex < 0 || wordIndex >= section.words.length) return null
        const word = section.words[wordIndex]!
        const lineIdx = Math.max(0, word.lineIndex)
        // Word index within its line: position relative to first word of that line.
        let localIdx = wordIndex
        for (let i = 0; i < wordIndex; i++) {
            if (section.words[i]!.lineIndex !== lineIdx) localIdx--
        }
        return { lineIdx, localWordIdx: localIdx }
    }

    /**
     * Translate a global section-local word index (the index into `section.words`) into
     * the global progress state expected by the CSS — `sung` / `active` / `upcoming`.
     */
    function wordState(sectionWordIndex: number, currentWordIndex: number): "sung" | "active" | "upcoming" {
        if (sectionWordIndex < currentWordIndex) return "sung"
        if (sectionWordIndex === currentWordIndex) return "active"
        return "upcoming"
    }

    /**
     * --progress for a given word. The active word uses the current wordProgress;
     * sung words read 1; upcoming words read 0.
     */
    function wordProgress(sectionWordIndex: number, currentWordIndex: number, currentWordProgress: number): number {
        if (sectionWordIndex < currentWordIndex) return 1
        if (sectionWordIndex === currentWordIndex) return Math.max(0, Math.min(1, currentWordProgress))
        return 0
    }

    $: primaryTranslation = resolvePrimaryTranslation(parallelLyrics, activeSection, style)
    $: parallelLines = resolveParallelTexts(parallelLyrics, activeSection, style, primaryTranslation, timingMap)

    function resolvePrimaryTranslation(tracks: ParallelLyricsTrackLike[], section: TimingSectionLike | null, styleNow: DisplaySettingsLike): { text: string; language: string } | null {
        if (!styleNow.primaryLyricsLanguage) return null
        if (styleNow.primaryLyricsLanguage === timingMap?.language) return null
        const chosen = tracks.find((track) => track.language === styleNow.primaryLyricsLanguage)
        if (!chosen || !section) return null
        const match = chosen.sections.find((candidate) => candidate.sectionId === section.id)
        return match ? { text: match.text, language: chosen.language } : null
    }

    /**
     * Resolve secondary lyric blocks for the active section. Translations advance by
     * section only (FR10.4), and up to two secondary tracks can render at once (FR10.8).
     */
    function resolveParallelTexts(tracks: ParallelLyricsTrackLike[], section: TimingSectionLike | null, styleNow: DisplaySettingsLike, primary: { text: string; language: string } | null, map: TimingMapLike | null): { text: string; language: string }[] {
        if (!styleNow.parallelLyricsEnabled) return []
        if (tracks.length === 0 || !section) return []
        const lines: { text: string; language: string }[] = []

        if (primary && map) {
            lines.push({ text: sectionText(section), language: map.language ?? "primary" })
        }

        const ordered = styleNow.parallelLyricsLanguage ? [...tracks.filter((track) => track.language === styleNow.parallelLyricsLanguage), ...tracks.filter((track) => track.language !== styleNow.parallelLyricsLanguage)] : tracks

        for (const track of ordered) {
            if (primary && track.language === primary.language) continue
            const match = track.sections.find((candidate) => candidate.sectionId === section.id)
            if (match) lines.push({ text: match.text, language: track.language })
            if (lines.length >= 2) break
        }

        return lines
    }

    function sectionText(section: TimingSectionLike): string {
        if (section.lines.length === 0) return section.words.map((word) => word.text).join(" ")
        return section.lines
            .map((line) =>
                section.words
                    .slice(line.wordStartIndex, line.wordEndIndex)
                    .map((word) => word.text)
                    .join(" ")
            )
            .join("\n")
    }

    /** Font-size scaling per FR10.8: 60% for 2 languages, 50% for 3. */
    $: parallelFontFactor = parallelLines.length >= 2 ? 0.5 : parallelLines.length === 1 ? 0.6 : 0.75

    /**
     * Resolved easing duration for the currently-active word. Recomputed whenever the
     * cursor moves to a new word. Pushed through as `--word-ease-ms` on the karaoke-
     * output root — the CSS reads it for the transition durations on .word. The
     * computation itself lives in `./karaoke-easing.ts` so it's unit-testable in
     * plain Node.
     */
    $: activeWordEaseMs = (() => {
        if (!activeSection || !currentFrame) return 80
        const idx = currentFrame.wordIndex
        const word = activeSection.words[idx]
        if (!word) return 80
        return wordEaseMs(word.endMs - word.startMs)
    })()

    /**
     * Element ref for the active-line container — used to scroll the active line into
     * view when it changes (STORY-06.3 smooth scroll behaviour). Svelte's `fly`
     * transition handles the vertical slide; we use scrollIntoView as a fallback when
     * the active line moves out of viewport due to content overflow.
     */
    let activeLineEl: HTMLElement | null = null
    let lastActiveLineIdx = -1
    $: if (cursor && cursor.lineIdx !== lastActiveLineIdx) {
        lastActiveLineIdx = cursor.lineIdx
        // Defer to next tick so the new active class is applied before we scroll.
        // jsdom (and some older browsers) doesn't implement scrollIntoView — guard so a
        // test environment or stripped renderer doesn't crash the reactive statement.
        tick().then(() => {
            if (activeLineEl && typeof activeLineEl.scrollIntoView === "function") {
                activeLineEl.scrollIntoView({ behavior: "smooth", block: "center" })
            }
        })
    }

    /**
     * Svelte action that captures the element ref only when the predicate is true.
     * Used to bind `activeLineEl` to whichever rendered line currently has the active
     * class — `bind:this` cannot itself be conditional, but an action can.
     */
    function captureActiveLine(node: HTMLElement, isActive: boolean): { update(v: boolean): void; destroy(): void } {
        if (isActive) activeLineEl = node
        return {
            update(v: boolean) {
                if (v) activeLineEl = node
                else if (activeLineEl === node) activeLineEl = null
            },
            destroy() {
                if (activeLineEl === node) activeLineEl = null
            }
        }
    }
</script>

<div
    class="karaoke-output"
    data-output-id={outputId}
    data-tier={currentFrame?.tier ?? "auto"}
    data-vad={currentFrame?.vad ?? "active"}
    style="
        --highlight-color: {style.highlightColor};
        --sung-color: {style.sungColor};
        --upcoming-color: {style.upcomingColor};
        --sung-opacity: {style.sungWordOpacity};
        --font-size-base: {style.fontSize}px;
        --font-family: {style.fontFamily};
        --word-ease-ms: {activeWordEaseMs}ms;
    "
>
    {#if !timingMap}
        <!-- No map loaded yet — show a friendly placeholder. STORY-06.1 AC: must not
             crash when the renderer is mounted before LC_LOAD_MAP arrives. -->
        <div class="placeholder">
            <div class="placeholder-title">LyriCue</div>
            <div class="placeholder-sub">Waiting for song…</div>
        </div>
    {:else if !activeSection}
        <div class="placeholder">
            <div class="placeholder-sub">No active section</div>
        </div>
    {:else}
        {#if primaryTranslation}
            <div class="lines primary-translation" data-language={primaryTranslation.language}>
                {#each primaryTranslation.text.split("\n") as translatedLine}
                    <div class="line active">{translatedLine}</div>
                {/each}
            </div>
        {:else}
            <div class="lines">
                {#each linesForActiveSection as line, lineIdx (`${activeSection.id}:${lineIdx}`)}
                    {@const isActiveLine = cursor?.lineIdx === lineIdx}
                    <div class="line" class:active={isActiveLine} class:sung-line={cursor !== null && lineIdx < cursor.lineIdx} class:upcoming-line={cursor !== null && lineIdx > cursor.lineIdx} use:captureActiveLine={isActiveLine} in:fly|local={{ y: 40, duration: 250 }} out:fly|local={{ y: -40, duration: 250 }}>
                        {#each line as word}
                            {@const sectionWordIdx = activeSection.words.indexOf(word)}
                            {@const wState = wordState(sectionWordIdx, currentFrame?.wordIndex ?? 0)}
                            {@const wProgress = wordProgress(sectionWordIdx, currentFrame?.wordIndex ?? 0, currentFrame?.wordProgress ?? 0)}
                            <span class="word" class:sung={wState === "sung"} class:active={wState === "active"} class:upcoming={wState === "upcoming"} class:held={word.held === true} class:silent={currentFrame?.vad === "silent"} data-held-anim={style.heldNoteAnimation} style="--progress: {wProgress}">{word.text}</span>
                        {/each}
                    </div>
                {/each}
            </div>
        {/if}

        {#if parallelLines.length > 0}
            <div class="parallel" style="font-size: calc(var(--font-size-base) * {parallelFontFactor})">
                {#each parallelLines as line}
                    <div class="parallel-track" data-language={line.language}>
                        {#each line.text.split("\n") as ptLine}
                            <div class="parallel-line">{ptLine}</div>
                        {/each}
                    </div>
                {/each}
            </div>
        {/if}

        {#if currentFrame?.nextSongTitle}
            <div class="next-song-hint" role="status" aria-live="polite">
                <span class="next-song-label">Next:</span>
                <span class="next-song-title">{currentFrame.nextSongTitle}</span>
            </div>
        {/if}
    {/if}
</div>

<style>
    .karaoke-output {
        position: relative;
        height: 100%;
        width: 100%;
        background: black;
        color: white;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1.5rem;
        font-family: var(--font-family, system-ui, sans-serif);
        overflow: hidden;
        /* STORY-06.6: vmin-based font sizing with clamp() bounds. Settings give the
           base; clamp keeps it legible across 1080p / 4K / ultrawide.
           Min: ~2rem at very narrow viewports.
           Pref: caller-supplied --font-size-base scaled to viewport's smaller axis.
           Max: 12vmin so 4K projections don't go absurd. */
        font-size: clamp(2rem, 8vmin, 12vmin);
    }

    .placeholder {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.75rem;
        opacity: 0.7;
    }
    .placeholder-title {
        font-size: 1.2em;
        font-weight: 700;
        letter-spacing: 0.05em;
    }
    .placeholder-sub {
        font-size: 0.7em;
        opacity: 0.5;
    }

    .lines {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5em;
        max-width: 95%;
        text-align: center;
        line-height: 1.2;
    }

    .line {
        font-weight: 700;
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 0.4em;
        transition: opacity 200ms ease;
    }

    .line.sung-line {
        opacity: var(--sung-opacity, 0.4);
    }
    .line.upcoming-line {
        opacity: 0.7;
    }
    .primary-translation {
        text-align: center;
    }

    /* STORY-06.6: when a single line exceeds container width, horizontal-pan layout. */
    .line.active {
        max-width: 100%;
        overflow: hidden;
        white-space: nowrap;
        flex-wrap: nowrap;
        scroll-snap-type: x mandatory;
    }

    /* STORY-06.1: sweep is highlight (sung-portion) → upcoming (not-yet-sung). The
       previously-shipped stub used `#666666` (the dim "sung past words" color) for the
       right side, making the not-yet-sung portion read as "already past" — D6 inversion.
       We now use --upcoming-color for the right side (readable but subdued) and
       --highlight-color for the sung-portion sweep.

       Tempo-adaptive easing (operator feedback 2026-05-15): without a CSS transition,
       the 16ms per-tick --progress updates render as a hard stair-step. We add an
       `ease-out` transition driven by `--word-ease-ms` — computed per active word from
       its musical duration (see wordEaseMs in the script). Short staccato words → 50ms;
       normal words → 80ms; long held notes → 200ms. This unifies the gradient sweep
       AND the opacity/colour handoff so word-to-word transitions feel like one motion. */
    .word {
        position: relative;
        background: linear-gradient(to right, var(--highlight-color) calc(var(--progress, 0) * 100%), var(--upcoming-color) calc(var(--progress, 0) * 100%));
        background-clip: text;
        -webkit-background-clip: text;
        color: transparent;
        transition:
            background var(--word-ease-ms, 80ms) ease-out,
            opacity var(--word-ease-ms, 80ms) ease-out,
            filter var(--word-ease-ms, 80ms) ease-out;
    }

    .word.sung {
        background: linear-gradient(to right, var(--sung-color) 100%, var(--sung-color) 100%);
        background-clip: text;
        -webkit-background-clip: text;
        opacity: var(--sung-opacity, 0.4);
    }

    .word.upcoming {
        opacity: 0.85;
    }

    .word.active {
        opacity: 1;
    }

    /* STORY-06.4: held-note pulse. Animation period 1.2s; runs only while progress is
       mid-sweep (0.2 → 0.95 — gated by JS via the `held` class + active state, see below).
       The settings-driven `data-held-anim` attribute switches the visual effect. */
    .word.active.held[data-held-anim="pulse"] {
        animation: held-pulse 1.2s ease-in-out infinite;
    }
    .word.active.held[data-held-anim="glow"] {
        animation: held-glow 1.5s ease-in-out infinite;
    }
    /* `static` is the no-animation fallback — operators who find motion distracting. */

    @keyframes held-pulse {
        0%,
        100% {
            transform: scale(1);
            filter: brightness(1);
        }
        50% {
            transform: scale(1.04);
            filter: brightness(1.15);
        }
    }
    @keyframes held-glow {
        0%,
        100% {
            text-shadow: 0 0 0 transparent;
        }
        50% {
            text-shadow: 0 0 24px var(--highlight-color);
        }
    }

    /* VAD silent: dim the active word slightly so operators know live audio is gated.
       Not a full failure state — just a hint. */
    .word.silent {
        filter: brightness(0.85);
    }

    .parallel {
        opacity: 0.75;
        text-align: center;
        font-weight: 500;
        line-height: 1.3;
        color: var(--upcoming-color, #cccccc);
        max-width: 95%;
    }
    .parallel-track + .parallel-track {
        margin-top: 0.25em;
    }
    .parallel-line {
        padding: 0.1em 0;
    }

    .next-song-hint {
        position: absolute;
        left: 50%;
        bottom: 6vmin;
        transform: translateX(-50%);
        display: flex;
        align-items: baseline;
        justify-content: center;
        gap: 0.3em;
        max-width: 88%;
        color: var(--upcoming-color, #cccccc);
        font-size: clamp(1.1rem, 2.8vmin, 3rem);
        font-weight: 700;
        line-height: 1.1;
        opacity: 0.82;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        pointer-events: none;
    }
    .next-song-label {
        opacity: 0.72;
    }
    .next-song-title {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
    }
</style>
