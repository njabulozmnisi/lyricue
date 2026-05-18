<script lang="ts">
    import { createParallelLyricsDraft, sectionPlainText, upsertParallelLyricsTrack } from "@lyricue/core/translations"
    import type { ParallelLyricsTrack, TimingMap } from "@lyricue/core/types"

    export let timingMap: TimingMap
    export let language = "zu-ZA"
    export let onSave: (map: TimingMap) => void

    let draft: ParallelLyricsTrack = createParallelLyricsDraft(timingMap, language)

    $: if (draft.language !== language) {
        draft = createParallelLyricsDraft(timingMap, language)
    }

    function updateSection(sectionId: string, text: string): void {
        draft = {
            ...draft,
            sections: draft.sections.map((section) => (section.sectionId === sectionId ? { ...section, text } : section))
        }
    }

    function onSectionInput(sectionId: string, e: Event): void {
        updateSection(sectionId, (e.currentTarget as HTMLTextAreaElement).value)
    }

    function save(): void {
        onSave(upsertParallelLyricsTrack(timingMap, draft))
    }
</script>

<section class="translation-editor" aria-label="Translation Editor">
    <header>
        <h2>Translation Editor</h2>
        <label>
            Language
            <input aria-label="Translation language" bind:value={language} />
        </label>
    </header>

    <div class="sections">
        {#each timingMap.sections as section}
            {@const translated = draft.sections.find((candidate) => candidate.sectionId === section.id)?.text ?? ""}
            <article class="section-row">
                <div class="original">
                    <h3>{section.label}</h3>
                    {#each sectionPlainText(section).split("\n") as line}
                        <p>{line}</p>
                    {/each}
                </div>
                <label class="translation">
                    Translation
                    <textarea aria-label={`Translation for ${section.label}`} value={translated} on:input={(e) => onSectionInput(section.id, e)}></textarea>
                </label>
            </article>
        {/each}
    </div>

    <footer>
        <button type="button" on:click={save}>Save Translation</button>
    </footer>
</section>

<style>
    .translation-editor {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }
    header,
    footer {
        align-items: flex-end;
        display: flex;
        gap: 0.75rem;
        justify-content: space-between;
    }
    h2,
    h3,
    p {
        margin: 0;
    }
    label {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
    }
    input,
    textarea,
    button {
        font: inherit;
        padding: 0.45rem 0.6rem;
    }
    textarea {
        min-height: 7rem;
        resize: vertical;
    }
    .sections {
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
    }
    .section-row {
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .original {
        border: 1px solid #d0d5dd;
        border-radius: 6px;
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
        padding: 0.75rem;
    }
    .translation {
        min-width: 0;
    }
    button {
        border: 1px solid #94a3b8;
        background: #f8fafc;
        border-radius: 6px;
        cursor: pointer;
    }
    @media (max-width: 720px) {
        header,
        footer {
            align-items: stretch;
            flex-direction: column;
        }
        .section-row {
            grid-template-columns: 1fr;
        }
    }
</style>
