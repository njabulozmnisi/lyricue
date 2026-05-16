<!--
    LearnSongWizard.svelte — EP-11 song-learning flow.

    Host-neutral by design: FreeShow lyric search, file extraction, and sidecar learning
    are injected callbacks. This keeps the component usable in fork and sister mode while
    the host APIs are still being finalized.
-->
<script context="module" lang="ts">
    import type { ParsedLyricsSection } from "@lyricue/core/lyrics"

    export type LearnSongStep = "source" | "sections" | "audio" | "progress" | "preview"

    export interface LearnSongDraft {
        step: LearnSongStep
        title: string
        lyricsText: string
        sections: ParsedLyricsSection[]
        audioFileName: string | null
        audioFileSize: number | null
        progressLabel: string
        warnings: string[]
    }

    export interface LyricSearchResult {
        id: string
        title: string
        artist?: string
        lyrics: string
    }
</script>

<script lang="ts">
    import { createEventDispatcher } from "svelte"
    import { parseLyrics, parseLyricsFileText } from "@lyricue/core/lyrics"
    import type { TimingSectionType } from "@lyricue/core/types"

    export let initialDraft: Partial<LearnSongDraft> | undefined = undefined
    export let searchLyrics: ((query: string) => Promise<LyricSearchResult[]>) | undefined = undefined
    export let readFileText: ((file: File) => Promise<string>) | undefined = undefined
    export let learnSong:
        | ((draft: LearnSongDraft) => Promise<{ progressLabel?: string } | void>)
        | undefined = undefined
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
        progressLabel: initialDraft?.progressLabel ?? "Ready to learn",
        warnings: initialDraft?.warnings ?? []
    }

    let searchQuery = ""
    let searchResults: LyricSearchResult[] = []
    let searchError = ""
    let searching = false
    let importError = ""
    let learnError = ""
    let learning = false

    $: stepIndex = stepOrder.indexOf(draft.step)
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
        goNext()
    }

    function onAudioSelected(event: Event): void {
        const input = event.currentTarget as HTMLInputElement
        const file = input.files?.[0]
        if (!file) return
        draft.audioFileName = file.name
        draft.audioFileSize = file.size
        emitDraft()
    }

    async function startLearning(): Promise<void> {
        learning = true
        learnError = ""
        draft.progressLabel = "Learning song"
        emitDraft()
        try {
            const result = learnSong ? await learnSong(draft) : { progressLabel: "Preview ready" }
            draft.progressLabel = result?.progressLabel ?? "Preview ready"
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

    function cancel(): void {
        const dirty = draft.lyricsText.trim() || draft.sections.length > 0 || draft.audioFileName
        if (dirty && confirmCancel && !confirmCancel(draft)) return
        dispatch("cancel", { draft })
    }

    function complete(): void {
        dispatch("complete", { draft })
    }

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
                {learning ? "Learning" : draft.audioFileName ? "Start learning" : "Create manual preview"}
            </button>
        </section>
    {:else if draft.step === "preview"}
        <section class="step-panel preview">
            <h2>Preview structure</h2>
            <p class="summary">{draft.sections.length} sections ready{draft.audioFileName ? ` with ${draft.audioFileName}` : " for manual mode"}.</p>
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
    }
</style>
