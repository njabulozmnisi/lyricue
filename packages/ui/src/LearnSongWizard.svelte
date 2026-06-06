<!--
    LearnSongWizard.svelte — EP-11 song-learning flow.

    Host-neutral by design: FreeShow lyric search, file extraction, and sidecar learning
    are injected callbacks. This keeps the component usable in fork and sister mode while
    the host APIs are still being finalized.
-->
<script context="module" lang="ts">
    import type { ParsedLyricsSection } from "@lyricue/core/lyrics"

    export type LearnSongStep = "source" | "sections" | "audio" | "progress" | "preview"
    export type LearnSongAlignmentMode = "deterministic" | "production"
    export type LearnSongDemucsModel = "htdemucs" | "htdemucs_ft" | "mdx_extra"
    export type LearnSongWhisperxModel = "tiny" | "base" | "small" | "medium"

    export interface LearnSongDraft {
        step: LearnSongStep
        title: string
        lyricsText: string
        sections: ParsedLyricsSection[]
        audioFileName: string | null
        audioFileSize: number | null
        audioPath: string | null
        progressLabel: string
        warnings: string[]
        timingMap: unknown | null
        alignmentMode: LearnSongAlignmentMode
        demucsModel: LearnSongDemucsModel
        whisperxModel: LearnSongWhisperxModel
    }

    export interface LyricSearchResult {
        id: string
        title: string
        artist?: string
        lyrics: string
    }
</script>

<script lang="ts">
    import { createEventDispatcher, onDestroy } from "svelte"
    import { parseLyrics, parseLyricsFileText } from "@lyricue/core/lyrics"
    import { validateTimingMap, type TimingMap, type TimingSection, type TimingSectionType } from "@lyricue/core/types"

    export let initialDraft: Partial<LearnSongDraft> | undefined = undefined
    export let searchLyrics: ((query: string) => Promise<LyricSearchResult[]>) | undefined = undefined
    export let readFileText: ((file: File) => Promise<string>) | undefined = undefined
    export let learnSong:
        | ((draft: LearnSongDraft, onProgress: (label: string) => void) => Promise<{ progressLabel?: string; timingMap?: unknown } | void>)
        | undefined = undefined
    export let saveTimingMap: ((timingMap: TimingMap) => Promise<void> | void) | undefined = undefined
    export let confirmCancel: ((draft: LearnSongDraft) => boolean) | undefined = undefined

    const dispatch = createEventDispatcher<{
        "draft-change": { draft: LearnSongDraft }
        cancel: { draft: LearnSongDraft }
        complete: { draft: LearnSongDraft }
    }>()

    const stepOrder: LearnSongStep[] = ["source", "sections", "audio", "progress", "preview"]
    const stepLabels = ["Source lyrics", "Review sections", "Attach audio", "Learn", "Preview"]
    const sectionTypes: TimingSectionType[] = [
        "verse",
        "chorus",
        "pre-chorus",
        "bridge",
        "tag",
        "intro",
        "outro",
        "other"
    ]

    let draft: LearnSongDraft = {
        step: initialDraft?.step ?? "source",
        title: initialDraft?.title ?? "",
        lyricsText: initialDraft?.lyricsText ?? "",
        sections: initialDraft?.sections ?? [],
        audioFileName: initialDraft?.audioFileName ?? null,
        audioFileSize: initialDraft?.audioFileSize ?? null,
        audioPath: initialDraft?.audioPath ?? null,
        progressLabel: initialDraft?.progressLabel ?? "Ready to learn",
        warnings: initialDraft?.warnings ?? [],
        timingMap: initialDraft?.timingMap ?? null,
        alignmentMode: initialDraft?.alignmentMode ?? "deterministic",
        demucsModel: initialDraft?.demucsModel ?? "htdemucs",
        whisperxModel: initialDraft?.whisperxModel ?? "small"
    }

    let searchQuery = ""
    let searchResults: LyricSearchResult[] = []
    let searchError = ""
    let searching = false
    let importError = ""
    let learnError = ""
    let learning = false
    let audioPreviewUrl: string | null = null
    let previewAudio: HTMLAudioElement | null = null
    let previewCurrentMs = 0
    let timingEditStatus = ""
    let dragState:
        | {
              sectionIndex: number
              wordIndex: number
              edge: "start" | "end"
              left: number
              width: number
          }
        | null = null

    $: stepIndex = stepOrder.indexOf(draft.step)
    $: timingMapResult = draft.timingMap ? validateTimingMap(draft.timingMap) : null
    $: timingMap = timingMapResult?.ok ? timingMapResult.value : null
    $: timingMapErrors = timingMapResult && !timingMapResult.ok ? timingMapResult.errors : []
    $: firstTimingMapError = timingMapErrors[0]
    $: totalDurationMs = timingMap ? Math.max(timingMap.learnedFrom.duration * 1000, ...timingMap.sections.map((section) => section.endMs), 1) : 1
    $: activePreviewWordKey = timingMap ? activeWordKey(timingMap, previewCurrentMs) : ""
    $: waveformBars = buildWaveformBars(timingMap, totalDurationMs)
    $: canGoNext =
        draft.step === "source"
            ? draft.lyricsText.trim().length > 0 && draft.sections.length > 0
            : draft.step === "sections"
              ? draft.sections.length > 0 && draft.sections.every((s) => s.label.trim() && s.text.trim())
              : draft.step !== "progress"

    function emitDraft(): void {
        draft = { ...draft, sections: draft.sections.map((s) => ({ ...s, lines: [...s.lines] })) }
        dispatch("draft-change", { draft })
    }

    function parseCurrentLyrics(): void {
        const parsed = parseLyrics(draft.lyricsText)
        draft.title = draft.title || parsed.title || ""
        draft.sections = parsed.sections
        draft.warnings = parsed.warnings
        emitDraft()
    }

    function setLyrics(text: string): void {
        draft.lyricsText = text
        parseCurrentLyrics()
    }

    async function runSearch(): Promise<void> {
        if (!searchLyrics || searchQuery.trim() === "") return
        searching = true
        searchError = ""
        try {
            searchResults = await searchLyrics(searchQuery.trim())
        } catch (err) {
            searchResults = []
            searchError = (err as Error).message || "Lyric search failed."
        } finally {
            searching = false
        }
    }

    function chooseResult(result: LyricSearchResult): void {
        draft.title = result.title
        setLyrics(result.lyrics)
        searchResults = []
    }

    async function onFileSelected(event: Event): Promise<void> {
        const input = event.currentTarget as HTMLInputElement
        const file = input.files?.[0]
        if (!file) return
        importError = ""
        try {
            const text = readFileText ? await readFileText(file) : await file.text()
            const parsed = parseLyricsFileText(file.name, text)
            draft.title = draft.title || parsed.title || file.name.replace(/\.[^.]+$/, "")
            draft.lyricsText = text
            draft.sections = parsed.sections
            draft.warnings = parsed.warnings
            emitDraft()
        } catch (err) {
            importError = (err as Error).message || "Could not read that file."
        } finally {
            input.value = ""
        }
    }

    function goNext(): void {
        if (!canGoNext) return
        const next = stepOrder[stepIndex + 1]
        if (!next) return
        draft.step = next
        emitDraft()
    }

    function goBack(): void {
        const prev = stepOrder[stepIndex - 1]
        if (!prev) return
        draft.step = prev
        emitDraft()
    }

    function skipAudio(): void {
        draft.audioFileName = null
        draft.audioFileSize = null
        draft.audioPath = null
        draft.timingMap = null
        goNext()
    }

    function onAudioSelected(event: Event): void {
        const input = event.currentTarget as HTMLInputElement
        const file = input.files?.[0]
        if (!file) return
        const filePath = (file as unknown as { path?: string }).path
        if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl)
        audioPreviewUrl = typeof URL !== "undefined" && URL.createObjectURL ? URL.createObjectURL(file) : null
        draft.audioFileName = file.name
        draft.audioFileSize = file.size
        draft.audioPath = typeof filePath === "string" && filePath.length > 0 ? filePath : null
        draft.timingMap = null
        emitDraft()
    }

    function onAlignmentModeChange(event: Event): void {
        draft.alignmentMode = (event.currentTarget as HTMLSelectElement).value as LearnSongAlignmentMode
        draft.timingMap = null
        emitDraft()
    }

    function onDemucsModelChange(event: Event): void {
        draft.demucsModel = (event.currentTarget as HTMLSelectElement).value as LearnSongDemucsModel
        draft.timingMap = null
        emitDraft()
    }

    function onWhisperxModelChange(event: Event): void {
        draft.whisperxModel = (event.currentTarget as HTMLSelectElement).value as LearnSongWhisperxModel
        draft.timingMap = null
        emitDraft()
    }

    async function startLearning(): Promise<void> {
        const manualFallback = learnError !== "" || !draft.audioPath
        learning = true
        learnError = ""
        draft.progressLabel = manualFallback ? "Manual preview ready" : "Learning song"
        emitDraft()
        try {
            const result = manualFallback ? { progressLabel: "Manual preview ready" } : learnSong ? await learnSong(draft, updateProgressLabel) : { progressLabel: "Preview ready" }
            draft.progressLabel = result?.progressLabel ?? "Preview ready"
            if (result && "timingMap" in result) {
                draft.timingMap = (result as { timingMap?: unknown }).timingMap ?? null
            }
            draft.step = "preview"
            emitDraft()
        } catch (err) {
            learnError = (err as Error).message || "Learning failed. The song can still be saved for manual mode."
            draft.progressLabel = "Manual-mode fallback ready"
            emitDraft()
        } finally {
            learning = false
        }
    }

    function updateProgressLabel(label: string): void {
        if (!label.trim()) return
        draft.progressLabel = label
        emitDraft()
    }

    function cancel(): void {
        const dirty = draft.lyricsText.trim() || draft.sections.length > 0 || draft.audioFileName || draft.timingMap
        if (dirty && confirmCancel && !confirmCancel(draft)) return
        dispatch("cancel", { draft })
    }

    function complete(): void {
        dispatch("complete", { draft })
    }

    async function playPreview(): Promise<void> {
        if (!previewAudio) return
        try {
            await previewAudio.play()
        } catch {
            timingEditStatus = "Audio preview could not start in this environment."
        }
    }

    function onPreviewTimeUpdate(): void {
        previewCurrentMs = Math.max(0, (previewAudio?.currentTime ?? 0) * 1000)
    }

    async function saveTimingEdits(): Promise<void> {
        if (!timingMap) return
        timingEditStatus = "Saving timing edits"
        try {
            bumpTimingMapVersion(timingMap)
            draft.timingMap = timingMap
            emitDraft()
            await saveTimingMap?.(timingMap)
            timingEditStatus = saveTimingMap ? "Timing edits saved." : "Timing edits saved to draft."
        } catch (err) {
            timingEditStatus = (err as Error).message || "Timing edits could not be saved."
        }
    }

    function startBoundaryDrag(sectionIndex: number, wordIndex: number, edge: "start" | "end", event: PointerEvent): void {
        const stage = (event.currentTarget as HTMLElement).closest(".waveform-stage")
        if (!(stage instanceof HTMLElement)) return
        const bounds = stage.getBoundingClientRect()
        dragState = { sectionIndex, wordIndex, edge, left: bounds.left, width: Math.max(bounds.width, 1) }
        window.addEventListener("pointermove", onBoundaryDrag)
        window.addEventListener("pointerup", stopBoundaryDrag, { once: true })
        event.preventDefault()
    }

    function onBoundaryDrag(event: PointerEvent): void {
        if (!dragState || !timingMap) return
        const ratio = Math.max(0, Math.min(1, (event.clientX - dragState.left) / dragState.width))
        updateWordBoundary(dragState.sectionIndex, dragState.wordIndex, dragState.edge, Math.round(ratio * totalDurationMs))
    }

    function stopBoundaryDrag(): void {
        window.removeEventListener("pointermove", onBoundaryDrag)
        dragState = null
    }

    function onWordTimeInput(sectionIndex: number, wordIndex: number, edge: "start" | "end", event: Event): void {
        const value = Number((event.currentTarget as HTMLInputElement).value)
        if (!Number.isFinite(value)) return
        updateWordBoundary(sectionIndex, wordIndex, edge, Math.round(value))
    }

    function updateWordBoundary(sectionIndex: number, wordIndex: number, edge: "start" | "end", requestedMs: number): void {
        if (!timingMap) return
        const next = cloneTimingMap(timingMap)
        const section = next.sections[sectionIndex]
        const word = section?.words[wordIndex]
        if (!section || !word) return
        const minGap = 25
        if (edge === "start") {
            const previous = section.words[wordIndex - 1]
            const lower = previous ? previous.startMs + minGap : section.startMs
            const upper = word.endMs - minGap
            const startMs = clampMs(requestedMs, lower, upper)
            word.startMs = startMs
            if (previous) previous.endMs = startMs
        } else {
            const nextWord = section.words[wordIndex + 1]
            const lower = word.startMs + minGap
            const upper = nextWord ? nextWord.endMs - minGap : section.endMs
            const endMs = clampMs(requestedMs, lower, upper)
            word.endMs = endMs
            if (nextWord) nextWord.startMs = endMs
        }
        normalizeSection(section)
        draft.timingMap = next
        timingEditStatus = "Timing edits pending save."
        emitDraft()
    }

    function cloneTimingMap(map: TimingMap): TimingMap {
        return {
            ...map,
            learnedFrom: { ...map.learnedFrom },
            metadata: { ...map.metadata },
            sections: map.sections.map((section) => ({
                ...section,
                words: section.words.map((word) => ({ ...word })),
                lines: section.lines.map((line) => ({ ...line }))
            })),
            ...(map.parallel ? { parallel: map.parallel.map((track) => ({ ...track, sections: track.sections.map((section) => ({ ...section })) })) } : {})
        }
    }

    function normalizeSection(section: TimingSection): void {
        if (section.words.length === 0) return
        section.startMs = Math.min(...section.words.map((word) => word.startMs))
        section.endMs = Math.max(...section.words.map((word) => word.endMs))
        section.lines = section.lines.map((line) => {
            const words = section.words.slice(line.wordStartIndex, line.wordEndIndex)
            if (words.length === 0) return line
            return { ...line, startMs: words[0]!.startMs, endMs: words[words.length - 1]!.endMs }
        })
    }

    function bumpTimingMapVersion(map: TimingMap): void {
        const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)
        map.metadata = { ...map.metadata, version: `${map.metadata.version}+manual.${stamp}` }
    }

    function activeWordKey(map: TimingMap, currentMs: number): string {
        for (let sectionIndex = 0; sectionIndex < map.sections.length; sectionIndex += 1) {
            const section = map.sections[sectionIndex]!
            for (let wordIndex = 0; wordIndex < section.words.length; wordIndex += 1) {
                const word = section.words[wordIndex]!
                if (currentMs >= word.startMs && currentMs <= word.endMs) return `${sectionIndex}:${wordIndex}`
            }
        }
        return ""
    }

    function buildWaveformBars(map: TimingMap | null, durationMs: number): { x: number; y: number; height: number }[] {
        const bars = 72
        return Array.from({ length: bars }, (_, index) => {
            const t = (index / Math.max(bars - 1, 1)) * durationMs
            const confidence = nearestConfidence(map, t)
            const wave = Math.abs(Math.sin(index * 0.63)) * 0.45 + Math.abs(Math.sin(index * 0.17 + 1.8)) * 0.35 + confidence * 0.25
            const height = 18 + Math.min(76, Math.round(wave * 70))
            return { x: 8 + index * 13.65, y: Math.round((104 - height) / 2), height }
        })
    }

    function nearestConfidence(map: TimingMap | null, ms: number): number {
        if (!map) return 0.5
        for (const section of map.sections) {
            const word = section.words.find((candidate) => ms >= candidate.startMs && ms <= candidate.endMs)
            if (word) return word.confidence ?? 0.35
        }
        return 0.45
    }

    function pct(ms: number, durationMs: number): number {
        return Math.max(0, Math.min(100, (ms / Math.max(durationMs, 1)) * 100))
    }

    function clampMs(value: number, min: number, max: number): number {
        if (max < min) return min
        return Math.max(min, Math.min(max, value))
    }

    onDestroy(() => {
        if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl)
        stopBoundaryDrag()
    })

    function updateSection(index: number, patch: Partial<ParsedLyricsSection>): void {
        const section = draft.sections[index]
        if (!section) return
        const text = patch.text ?? section.text
        const lines = text.split("\n").map((line) => line.trim()).filter(Boolean)
        draft.sections[index] = { ...section, ...patch, text, lines }
        emitDraft()
    }

    function onSectionTypeChange(index: number, event: Event): void {
        updateSection(index, { type: (event.currentTarget as HTMLSelectElement).value as TimingSectionType })
    }

    function onSectionLabelInput(index: number, event: Event): void {
        updateSection(index, { label: (event.currentTarget as HTMLInputElement).value })
    }

    function onSectionTextInput(index: number, event: Event): void {
        updateSection(index, { text: (event.currentTarget as HTMLTextAreaElement).value })
    }

    function moveSection(index: number, delta: -1 | 1): void {
        const target = index + delta
        if (target < 0 || target >= draft.sections.length) return
        const next = [...draft.sections]
        const [item] = next.splice(index, 1)
        next.splice(target, 0, item!)
        draft.sections = next
        emitDraft()
    }

    function mergeWithPrevious(index: number): void {
        if (index <= 0) return
        const previous = draft.sections[index - 1]
        const current = draft.sections[index]
        if (!previous || !current) return
        const mergedText = `${previous.text}\n${current.text}`
        draft.sections[index - 1] = {
            ...previous,
            text: mergedText,
            lines: mergedText.split("\n").map((line) => line.trim()).filter(Boolean)
        }
        draft.sections = draft.sections.filter((_, i) => i !== index)
        emitDraft()
    }

    function splitSection(index: number): void {
        const section = draft.sections[index]
        if (!section || section.lines.length < 2) return
        const splitAt = Math.ceil(section.lines.length / 2)
        const beforeLines = section.lines.slice(0, splitAt)
        const afterLines = section.lines.slice(splitAt)
        draft.sections = [
            ...draft.sections.slice(0, index),
            { ...section, text: beforeLines.join("\n"), lines: beforeLines },
            {
                ...section,
                id: `${section.id}-split`,
                label: `${section.label} B`,
                text: afterLines.join("\n"),
                lines: afterLines
            },
            ...draft.sections.slice(index + 1)
        ]
        emitDraft()
    }
</script>

<div class="learn-song-wizard" role="dialog" aria-modal="true" aria-labelledby="learn-song-title">
    <header class="wizard-header">
        <div>
            <p class="eyebrow">Learn song</p>
            <h1 id="learn-song-title">{draft.title || "New song"}</h1>
        </div>
        <button type="button" class="ghost" on:click={cancel}>Cancel</button>
    </header>

    <ol class="steps" aria-label="Learn song steps">
        {#each stepLabels as label, i}
            <li class:active={i === stepIndex} class:done={i < stepIndex}>{i + 1}. {label}</li>
        {/each}
    </ol>

    {#if draft.step === "source"}
        <section class="step-panel">
            <div class="source-grid">
                <div class="source-card">
                    <h2>Search</h2>
                    <div class="search-row">
                        <input aria-label="Lyric search query" bind:value={searchQuery} placeholder="Song title or first line" />
                        <button type="button" disabled={!searchLyrics || searching || !searchQuery.trim()} on:click={runSearch}>
                            {searching ? "Searching" : "Search"}
                        </button>
                    </div>
                    {#if !searchLyrics}<p class="hint">Search is waiting for FreeShow host wiring.</p>{/if}
                    {#if searchError}<p class="error">{searchError}</p>{/if}
                    {#if searchResults.length > 0}
                        <ul class="results">
                            {#each searchResults as result}
                                <li>
                                    <button type="button" on:click={() => chooseResult(result)}>
                                        <strong>{result.title}</strong>
                                        {#if result.artist}<span>{result.artist}</span>{/if}
                                    </button>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                </div>

                <div class="source-card">
                    <h2>Import</h2>
                    <label class="file-picker">
                        <span>Choose lyrics file</span>
                        <input
                            type="file"
                            accept=".txt,.docx,.pdf,.opensong,.xml,.chordpro,.cho,.pro"
                            on:change={onFileSelected}
                        />
                    </label>
                    <p class="hint">Plain text, OpenSong/OpenLyrics XML, and ChordPro are parsed locally. DOCX/PDF extraction is injected by the host.</p>
                    {#if importError}<p class="error">{importError}</p>{/if}
                </div>
            </div>

            <label>
                Title
                <input bind:value={draft.title} placeholder="Optional song title" on:input={emitDraft} />
            </label>
            <label>
                Lyrics
                <textarea
                    class="lyrics-input"
                    bind:value={draft.lyricsText}
                    placeholder="[Verse 1]&#10;Amazing grace..."
                    on:input={parseCurrentLyrics}
                />
            </label>
            {#each draft.warnings as warning}
                <p class="warning">{warning}</p>
            {/each}
            <p class="summary">{draft.sections.length} detected section{draft.sections.length === 1 ? "" : "s"}</p>
        </section>
    {:else if draft.step === "sections"}
        <section class="step-panel">
            <div class="section-list">
                {#each draft.sections as section, i}
                    <article class="section-editor">
                        <div class="section-tools">
                            <label>
                                Type
                                <select value={section.type} on:change={(e) => onSectionTypeChange(i, e)}>
                                    {#each sectionTypes as type}
                                        <option value={type}>{type}</option>
                                    {/each}
                                </select>
                            </label>
                            <label>
                                Label
                                <input value={section.label} on:input={(e) => onSectionLabelInput(i, e)} />
                            </label>
                            <div class="tool-buttons">
                                <button type="button" disabled={i === 0} on:click={() => moveSection(i, -1)}>Up</button>
                                <button type="button" disabled={i === draft.sections.length - 1} on:click={() => moveSection(i, 1)}>Down</button>
                                <button type="button" disabled={i === 0} on:click={() => mergeWithPrevious(i)}>Merge</button>
                                <button type="button" disabled={section.lines.length < 2} on:click={() => splitSection(i)}>Split</button>
                            </div>
                        </div>
                        <textarea value={section.text} on:input={(e) => onSectionTextInput(i, e)} />
                    </article>
                {/each}
            </div>
        </section>
    {:else if draft.step === "audio"}
        <section class="step-panel">
            <h2>Attach reference audio</h2>
            <label class="file-picker">
                <span>Choose MP3, WAV, FLAC, or OGG</span>
                <input type="file" accept=".mp3,.wav,.flac,.ogg" on:change={onAudioSelected} />
            </label>
            {#if draft.audioFileName}
                <p class="ok">{draft.audioFileName} selected</p>
            {:else}
                <p class="hint">Skip for now to save this song for manual setup.</p>
            {/if}
            {#if draft.audioFileName}
                <div class="learning-mode-panel">
                    <label>
                        Learning mode
                        <select aria-label="Learning mode" value={draft.alignmentMode} on:change={onAlignmentModeChange}>
                            <option value="deterministic">Fast deterministic alignment</option>
                            <option value="production">Production Demucs + WhisperX</option>
                        </select>
                    </label>
                    {#if draft.alignmentMode === "production"}
                        <div class="model-grid">
                            <label>
                                Demucs model
                                <select aria-label="Demucs model" value={draft.demucsModel} on:change={onDemucsModelChange}>
                                    <option value="htdemucs">htdemucs</option>
                                    <option value="htdemucs_ft">htdemucs_ft</option>
                                    <option value="mdx_extra">mdx_extra</option>
                                </select>
                            </label>
                            <label>
                                WhisperX model
                                <select aria-label="WhisperX model" value={draft.whisperxModel} on:change={onWhisperxModelChange}>
                                    <option value="tiny">tiny</option>
                                    <option value="base">base</option>
                                    <option value="small">small</option>
                                    <option value="medium">medium</option>
                                </select>
                            </label>
                        </div>
                        <p class="hint">Production mode uses the configured model manifest and may download model weights on first use.</p>
                    {/if}
                </div>
            {/if}
        </section>
    {:else if draft.step === "progress"}
        <section class="step-panel">
            <h2>Learn timing</h2>
            <p class="progress-label">{draft.progressLabel}</p>
            <div class="progress-bar" aria-label="Learning progress">
                <span class:running={learning}></span>
            </div>
            {#if learnError}<p class="error">{learnError}</p>{/if}
            <button type="button" class="primary" disabled={learning} on:click={startLearning}>
                {learning ? "Learning" : learnError || !draft.audioPath ? "Create manual preview" : "Start learning"}
            </button>
        </section>
    {:else if draft.step === "preview"}
        <section class="step-panel preview">
            <h2>Timing review</h2>
            <p class="summary">{draft.sections.length} sections ready{draft.audioFileName ? ` with ${draft.audioFileName}` : " for manual mode"}.</p>
            {#if timingMap}
                <p class="ok">Timing map learned and ready for review.</p>
                <div class="timing-review">
                    <div class="preview-controls">
                        {#if audioPreviewUrl}
                            <audio bind:this={previewAudio} src={audioPreviewUrl} preload="metadata" on:timeupdate={onPreviewTimeUpdate} />
                            <button type="button" on:click={playPreview}>Play reference</button>
                        {:else}
                            <p class="hint">Reference playback is available immediately after choosing audio in this wizard session.</p>
                        {/if}
                        <button type="button" class="primary" on:click={saveTimingEdits}>Save timing edits</button>
                        {#if timingEditStatus}<p class:ok={timingEditStatus.includes("saved")} class:error={timingEditStatus.includes("could not")}>{timingEditStatus}</p>{/if}
                    </div>
                    <div class="waveform-stage" aria-label="Timing waveform">
                        <svg viewBox="0 0 1000 120" role="img" aria-label="Reference audio waveform">
                            <rect x="0" y="0" width="1000" height="120" rx="8" />
                            {#each waveformBars as bar}
                                <line x1={bar.x} x2={bar.x} y1={60 - bar.height / 2} y2={60 + bar.height / 2} />
                            {/each}
                            <line class="playhead" x1={pct(previewCurrentMs, totalDurationMs) * 10} x2={pct(previewCurrentMs, totalDurationMs) * 10} y1="10" y2="110" />
                        </svg>
                        {#each timingMap.sections as section, sectionIndex}
                            {#each section.words as word, wordIndex}
                                <button
                                    type="button"
                                    class="word-marker"
                                    class:active={activePreviewWordKey === `${sectionIndex}:${wordIndex}`}
                                    style={`left:${pct(word.startMs, totalDurationMs)}%`}
                                    aria-label={`Start ${word.text}`}
                                    on:pointerdown={(e) => startBoundaryDrag(sectionIndex, wordIndex, "start", e)}
                                />
                                <button
                                    type="button"
                                    class="word-marker end"
                                    style={`left:${pct(word.endMs, totalDurationMs)}%`}
                                    aria-label={`End ${word.text}`}
                                    on:pointerdown={(e) => startBoundaryDrag(sectionIndex, wordIndex, "end", e)}
                                />
                            {/each}
                        {/each}
                    </div>
                    <div class="word-timing-list">
                        {#each timingMap.sections as section, sectionIndex}
                            <article class="timing-section">
                                <h3>{section.label}</h3>
                                <div class="word-grid">
                                    {#each section.words as word, wordIndex}
                                        <div class="word-row" class:active={activePreviewWordKey === `${sectionIndex}:${wordIndex}`}>
                                            <span>{word.text}</span>
                                            <label>
                                                Start
                                                <input type="number" min="0" step="25" value={word.startMs} on:input={(e) => onWordTimeInput(sectionIndex, wordIndex, "start", e)} />
                                            </label>
                                            <label>
                                                End
                                                <input type="number" min="0" step="25" value={word.endMs} on:input={(e) => onWordTimeInput(sectionIndex, wordIndex, "end", e)} />
                                            </label>
                                            <small>{word.confidence === null ? "Needs review" : `${Math.round(word.confidence * 100)}%`}</small>
                                        </div>
                                    {/each}
                                </div>
                            </article>
                        {/each}
                    </div>
                </div>
            {:else if firstTimingMapError}
                <p class="error">Timing map cannot be reviewed: {firstTimingMapError.path} {firstTimingMapError.message}</p>
            {/if}
            <div class="preview-sections">
                {#each draft.sections as section}
                    <article>
                        <h3>{section.label}</h3>
                        <p>{section.text}</p>
                    </article>
                {/each}
            </div>
        </section>
    {/if}

    <footer class="actions">
        <button type="button" disabled={stepIndex === 0 || learning} on:click={goBack}>Back</button>
        {#if draft.step === "audio"}
            <button type="button" disabled={learning} on:click={skipAudio}>Skip audio</button>
        {/if}
        {#if draft.step !== "progress" && draft.step !== "preview"}
            <button type="button" class="primary" disabled={!canGoNext || learning} on:click={goNext}>Next</button>
        {:else if draft.step === "progress"}
            <button type="button" class="primary" disabled={!canGoNext || learning} on:click={goNext}>Preview</button>
        {:else}
            <button type="button" class="primary" on:click={complete}>Finish</button>
        {/if}
    </footer>
</div>

<style>
    .learn-song-wizard {
        width: min(960px, calc(100vw - 2rem));
        max-height: calc(100vh - 2rem);
        margin: 1rem auto;
        padding: 1.25rem;
        overflow: auto;
        background: #111;
        color: #f5f5f5;
        border: 1px solid #303030;
        border-radius: 8px;
        font-family: system-ui, sans-serif;
    }
    .wizard-header,
    .actions,
    .search-row,
    .section-tools,
    .tool-buttons {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }
    .wizard-header,
    .actions {
        justify-content: space-between;
    }
    .eyebrow {
        margin: 0 0 0.15rem;
        color: #9ca3af;
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
    }
    h1,
    h2,
    h3,
    p {
        margin: 0;
    }
    h1 {
        font-size: 1.45rem;
    }
    h2 {
        font-size: 1.05rem;
    }
    h3 {
        font-size: 0.95rem;
    }
    .steps {
        list-style: none;
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 0.35rem;
        margin: 1.25rem 0;
        padding: 0;
        color: #777;
        font-size: 0.82rem;
    }
    .steps li {
        padding: 0.45rem 0.55rem;
        border: 1px solid #303030;
        border-radius: 6px;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }
    .steps li.active {
        color: #fff;
        border-color: #4ade80;
    }
    .steps li.done {
        color: #4ade80;
    }
    .step-panel {
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
        min-height: 430px;
    }
    .source-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 0.75rem;
    }
    .source-card,
    .section-editor,
    .preview article {
        padding: 0.85rem;
        border: 1px solid #303030;
        border-radius: 8px;
        background: #181818;
    }
    label {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        color: #d1d5db;
        font-size: 0.85rem;
        font-weight: 600;
    }
    input,
    select,
    textarea {
        min-width: 0;
        width: 100%;
        box-sizing: border-box;
        padding: 0.55rem 0.65rem;
        color: #f5f5f5;
        background: #242424;
        border: 1px solid #3a3a3a;
        border-radius: 6px;
        font: inherit;
    }
    textarea {
        resize: vertical;
    }
    .lyrics-input {
        min-height: 220px;
    }
    .section-list,
    .preview-sections,
    .results {
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
    }
    .learning-mode-panel {
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
        padding: 0.85rem;
        border: 1px solid #303030;
        border-radius: 8px;
        background: #181818;
    }
    .model-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.75rem;
    }
    .section-tools {
        align-items: end;
        margin-bottom: 0.65rem;
    }
    .section-tools label {
        flex: 1;
    }
    .section-editor textarea {
        min-height: 110px;
    }
    button,
    .file-picker span {
        border: 1px solid #3a3a3a;
        border-radius: 6px;
        padding: 0.52rem 0.8rem;
        color: #f5f5f5;
        background: #2b2b2b;
        font: inherit;
        cursor: pointer;
    }
    button:hover:not(:disabled),
    .file-picker:hover span {
        background: #353535;
    }
    button:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
    button.primary {
        color: #06130a;
        background: #4ade80;
        border-color: #4ade80;
        font-weight: 700;
    }
    button.ghost {
        background: transparent;
    }
    .file-picker input {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
    }
    .results {
        margin: 0.75rem 0 0;
        padding: 0;
        list-style: none;
    }
    .results button {
        width: 100%;
        text-align: left;
    }
    .results span {
        display: block;
        color: #aaa;
        font-size: 0.8rem;
    }
    .hint,
    .warning,
    .summary,
    .ok,
    .error {
        color: #aaa;
        font-size: 0.86rem;
    }
    .warning {
        color: #facc15;
    }
    .ok {
        color: #4ade80;
    }
    .error {
        color: #f87171;
    }
    .progress-label {
        color: #d1d5db;
    }
    .progress-bar {
        height: 10px;
        overflow: hidden;
        background: #242424;
        border-radius: 999px;
    }
    .progress-bar span {
        display: block;
        width: 65%;
        height: 100%;
        background: #4ade80;
    }
    .progress-bar span.running {
        animation: progress-slide 1.1s ease-in-out infinite alternate;
    }
    @keyframes progress-slide {
        from {
            transform: translateX(-45%);
        }
        to {
            transform: translateX(55%);
        }
    }
    .preview article p {
        margin-top: 0.35rem;
        color: #d1d5db;
        white-space: pre-line;
    }
    .timing-review,
    .word-timing-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }
    .preview-controls {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.75rem;
    }
    .waveform-stage {
        position: relative;
        min-height: 120px;
        overflow: hidden;
        border: 1px solid #303030;
        border-radius: 8px;
        background: #090909;
        touch-action: none;
    }
    .waveform-stage svg {
        display: block;
        width: 100%;
        height: 120px;
    }
    .waveform-stage rect {
        fill: #090909;
    }
    .waveform-stage line {
        stroke: #4ade80;
        stroke-width: 5;
        stroke-linecap: round;
        opacity: 0.48;
    }
    .waveform-stage .playhead {
        stroke: #f5f5f5;
        stroke-width: 2;
        opacity: 0.95;
    }
    .word-marker {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 10px;
        min-width: 10px;
        padding: 0;
        transform: translateX(-5px);
        border: 0;
        border-radius: 0;
        background: transparent;
        cursor: ew-resize;
    }
    .word-marker::before {
        content: "";
        position: absolute;
        top: 12px;
        bottom: 12px;
        left: 4px;
        width: 2px;
        background: #facc15;
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.65);
    }
    .word-marker.end::before {
        background: #60a5fa;
    }
    .word-marker.active::before {
        width: 4px;
        background: #f5f5f5;
    }
    .timing-section {
        padding: 0.8rem;
        border: 1px solid #303030;
        border-radius: 8px;
        background: #181818;
    }
    .word-grid {
        display: grid;
        gap: 0.45rem;
        margin-top: 0.65rem;
    }
    .word-row {
        display: grid;
        grid-template-columns: minmax(7rem, 1fr) 8rem 8rem 5.5rem;
        align-items: end;
        gap: 0.55rem;
        padding: 0.45rem;
        border: 1px solid transparent;
        border-radius: 6px;
        background: #121212;
    }
    .word-row.active {
        border-color: #4ade80;
        background: #17251b;
    }
    .word-row span {
        color: #f5f5f5;
        font-weight: 700;
    }
    .word-row small {
        color: #aaa;
        align-self: center;
    }
    @media (max-width: 760px) {
        .steps,
        .source-grid {
            grid-template-columns: 1fr;
        }
        .section-tools {
            flex-direction: column;
            align-items: stretch;
        }
        .actions {
            flex-wrap: wrap;
        }
        .word-row {
            grid-template-columns: 1fr;
        }
    }
</style>
