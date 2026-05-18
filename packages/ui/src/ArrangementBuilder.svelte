<script lang="ts">
    import { dndzone } from "svelte-dnd-action"
    import { createArrangement, duplicateArrangementStep, moveArrangementStep, parseArrangementShorthand, removeArrangementStep, selectActiveArrangement } from "@lyricue/core/arrangements"
    import type { Arrangement, ArrangementStep, TimingMap, TimingSection } from "@lyricue/core/types"

    export let timingMap: TimingMap
    export let arrangements: Arrangement[] = []
    export let activeArrangementId: string | null = null
    export let onSave: (arrangement: Arrangement) => void
    export let onSelectArrangement: (arrangement: Arrangement | null) => void = () => {}

    interface SequenceItem extends ArrangementStep {
        id: string
    }

    let selectedArrangementId = ""
    let arrangementName = ""
    let shorthand = ""
    let sequence: SequenceItem[] = []
    let unknownTokens: string[] = []
    let hydratedSelectionKey = ""
    let nextItemId = 0

    $: sectionById = new Map(timingMap.sections.map((section) => [section.id, section]))
    $: {
        const selectedArrangement = selectActiveArrangement(arrangements, activeArrangementId)
        const selectionKey = `${timingMap.showId}:${selectedArrangement?.id ?? ""}:${arrangements.length}`
        if (selectionKey !== hydratedSelectionKey) {
            hydratedSelectionKey = selectionKey
            selectedArrangementId = selectedArrangement?.id ?? ""
            arrangementName = selectedArrangement?.name ?? ""
            sequence = selectedArrangement ? toItems(selectedArrangement.sequence) : []
            unknownTokens = []
        }
    }

    function sectionLabel(step: ArrangementStep): string {
        const section = sectionById.get(step.sectionId)
        return section ? section.label : step.sectionId
    }

    function sectionMeta(section: TimingSection): string {
        return `${section.label} - slide ${section.slideIndex + 1}`
    }

    function selectArrangement(e: Event): void {
        selectedArrangementId = (e.currentTarget as HTMLSelectElement).value
        const arrangement = selectActiveArrangement(arrangements, selectedArrangementId)
        arrangementName = arrangement?.name ?? ""
        sequence = arrangement ? toItems(arrangement.sequence) : []
        unknownTokens = []
        onSelectArrangement(arrangement)
    }

    function applyShorthand(): void {
        const parsed = parseArrangementShorthand(shorthand, timingMap)
        sequence = toItems(parsed.sequence)
        unknownTokens = parsed.unknownTokens
    }

    function addSection(section: TimingSection): void {
        sequence = [...sequence, item(section.id)]
    }

    function moveStep(index: number, delta: number): void {
        sequence = toItems(moveArrangementStep(toSteps(sequence), index, index + delta))
    }

    function duplicateStep(index: number): void {
        sequence = toItems(duplicateArrangementStep(toSteps(sequence), index))
    }

    function removeStep(index: number): void {
        sequence = toItems(removeArrangementStep(toSteps(sequence), index))
    }

    function handleDnd(e: CustomEvent<{ items: SequenceItem[] }>): void {
        sequence = e.detail.items
    }

    function save(): void {
        const id = selectedArrangementId || slugify(arrangementName || "arrangement")
        const existing = arrangements.find((arrangement) => arrangement.id === id)
        const now = new Date().toISOString()
        onSave({
            ...createArrangement({
                id,
                name: arrangementName.trim(),
                showId: timingMap.showId,
                sequence: toSteps(sequence),
                isDefault: existing?.isDefault ?? arrangements.length === 0,
                now: existing?.createdAt ?? now
            }),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now
        })
    }

    function slugify(value: string): string {
        const slug = value
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
        return slug || "arrangement"
    }

    function item(sectionId: string): SequenceItem {
        nextItemId += 1
        return { id: `step-${nextItemId}`, sectionId }
    }

    function toItems(steps: ArrangementStep[]): SequenceItem[] {
        return steps.map((step) => item(step.sectionId))
    }

    function toSteps(items: SequenceItem[]): ArrangementStep[] {
        return items.map((step) => ({ sectionId: step.sectionId }))
    }

    $: canSave = arrangementName.trim().length > 0 && sequence.length > 0
</script>

<section class="arrangement-builder" aria-label="Arrangement Builder">
    <header>
        <h2>Arrangement Builder</h2>
        <select aria-label="Saved arrangement" on:change={selectArrangement} bind:value={selectedArrangementId}>
            <option value="">New arrangement</option>
            {#each arrangements as arrangement}
                <option value={arrangement.id}>{arrangement.name}{arrangement.isDefault ? " (Default)" : ""}</option>
            {/each}
        </select>
    </header>

    <label class="field">
        Name
        <input aria-label="Arrangement name" bind:value={arrangementName} />
    </label>

    <div class="shorthand">
        <label class="field">
            Shorthand
            <input aria-label="Arrangement shorthand" placeholder="V1 C V2 C B C Tag" bind:value={shorthand} />
        </label>
        <button type="button" on:click={applyShorthand}>Apply</button>
    </div>
    {#if unknownTokens.length > 0}
        <p class="warning" role="alert">Unrecognized: {unknownTokens.join(", ")}</p>
    {/if}

    <div class="columns">
        <section aria-label="Available sections">
            <h3>Sections</h3>
            <div class="section-list">
                {#each timingMap.sections as section}
                    <button type="button" title={sectionMeta(section)} on:click={() => addSection(section)}>
                        {section.label}
                    </button>
                {/each}
            </div>
        </section>

        <section aria-label="Arrangement sequence">
            <h3>Sequence</h3>
            {#if sequence.length === 0}
                <p class="empty">No sections selected</p>
            {:else}
                <ol class="sequence" use:dndzone={{ items: sequence, flipDurationMs: 120 }} on:consider={handleDnd} on:finalize={handleDnd}>
                    {#each sequence as step, index (step.id)}
                        <li>
                            <span>{sectionLabel(step)}</span>
                            <div class="row-actions" aria-label={`Controls for ${sectionLabel(step)}`}>
                                <button type="button" title="Move up" disabled={index === 0} on:click={() => moveStep(index, -1)}>↑</button>
                                <button type="button" title="Move down" disabled={index === sequence.length - 1} on:click={() => moveStep(index, 1)}>↓</button>
                                <button type="button" title="Duplicate" on:click={() => duplicateStep(index)}>⧉</button>
                                <button type="button" title="Remove" on:click={() => removeStep(index)}>×</button>
                            </div>
                        </li>
                    {/each}
                </ol>
            {/if}
        </section>
    </div>

    <footer>
        <button type="button" disabled={!canSave} on:click={save}>Save Arrangement</button>
    </footer>
</section>

<style>
    .arrangement-builder {
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
    }
    header,
    .shorthand,
    footer {
        display: flex;
        gap: 0.75rem;
        align-items: flex-end;
        justify-content: space-between;
    }
    h2,
    h3,
    p {
        margin: 0;
    }
    .field {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 0.35rem;
        font-size: 0.9rem;
    }
    input,
    select,
    button {
        font: inherit;
        padding: 0.45rem 0.6rem;
    }
    button {
        border: 1px solid #94a3b8;
        background: #f8fafc;
        border-radius: 6px;
        cursor: pointer;
    }
    button:disabled {
        cursor: not-allowed;
        opacity: 0.45;
    }
    .warning {
        color: #b42318;
        font-weight: 700;
    }
    .columns {
        display: grid;
        grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
        gap: 1rem;
    }
    .section-list {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
    }
    .sequence {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        margin: 0;
        padding-left: 1.5rem;
    }
    .sequence li {
        align-items: center;
        display: flex;
        gap: 0.75rem;
        justify-content: space-between;
        min-height: 2.25rem;
    }
    .row-actions {
        display: flex;
        gap: 0.25rem;
    }
    .row-actions button {
        min-width: 2.1rem;
        padding: 0.35rem;
    }
    .empty {
        color: #64748b;
    }
    @media (max-width: 720px) {
        header,
        .shorthand,
        footer {
            align-items: stretch;
            flex-direction: column;
        }
        .columns {
            grid-template-columns: 1fr;
        }
    }
</style>
