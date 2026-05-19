<script lang="ts">
    import type { TimingMap } from "@lyricue/core/types"

    interface RehearsalReviewSegment {
        index: number
        showId?: string | null
        title?: string | null
        status: "matched" | "review" | "failed" | "learned" | "partial"
        confidence?: number
        startSec?: number
        endSec?: number
        sourceAudioPath?: string | null
    }

    export let timingMap: TimingMap
    export let segment: RehearsalReviewSegment
    export let onApprove: (payload: { segment: RehearsalReviewSegment; skippedWordKeys: string[] }) => void
    export let onCancel: () => void

    let includedWordKeys = new Set<string>()
    let initializedFor = ""
    $: allWordKeys = timingMap.sections.flatMap((section) => section.words.map((_word, index) => wordReviewKey(section.id, index)))
    $: {
        const identity = `${timingMap.showId}:${segment.index}:${allWordKeys.join("|")}`
        if (identity !== initializedFor) {
            includedWordKeys = new Set(allWordKeys)
            initializedFor = identity
        }
    }
    $: skippedWordKeys = allWordKeys.filter((key) => !includedWordKeys.has(key))

    function toggleWord(key: string, checked: boolean): void {
        const next = new Set(includedWordKeys)
        if (checked) next.add(key)
        else next.delete(key)
        includedWordKeys = next
    }

    function handleWordToggle(key: string, event: Event): void {
        toggleWord(key, (event.currentTarget as HTMLInputElement).checked)
    }

    function wordReviewKey(sectionId: string, wordIndex: number): string {
        return `${sectionId}:${wordIndex}`
    }

    function approve(): void {
        onApprove({ segment, skippedWordKeys })
    }

    function formatRange(): string {
        if (typeof segment.startSec !== "number" || typeof segment.endSec !== "number") return "Unknown range"
        return `${segment.startSec.toFixed(1)}s → ${segment.endSec.toFixed(1)}s`
    }
</script>

<section class="review" aria-label="Rehearsal Review">
    <header>
        <div>
            <h2>{segment.title ?? timingMap.showId}</h2>
            <p>{formatRange()} · {Math.round((segment.confidence ?? 0) * 100)}% match</p>
        </div>
        <span>{skippedWordKeys.length} skipped</span>
    </header>

    <div class="sections">
        {#each timingMap.sections as section}
            <article>
                <h3>{section.label}</h3>
                <div class="words">
                    {#each section.words as word, index}
                        {@const key = wordReviewKey(section.id, index)}
                        <label class:skipped={!includedWordKeys.has(key)}>
                            <input
                                type="checkbox"
                                checked={includedWordKeys.has(key)}
                                on:change={(event) => handleWordToggle(key, event)}
                            />
                            <span>{word.text}</span>
                        </label>
                    {/each}
                </div>
            </article>
        {/each}
    </div>

    <footer>
        <button type="button" on:click={onCancel}>Back</button>
        <button type="button" class="primary" disabled={!segment.showId} on:click={approve}>Approve rehearsal map</button>
    </footer>
</section>

<style>
    .review {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }
    header,
    footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
    }
    h2,
    h3,
    p {
        margin: 0;
    }
    p,
    header span {
        color: #64748b;
        font-size: 0.85rem;
    }
    .sections {
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
    }
    article {
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        padding: 0.75rem;
        background: #fff;
    }
    .words {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
        margin-top: 0.6rem;
    }
    label {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        padding: 0.3rem 0.45rem;
        background: #f8fafc;
    }
    label.skipped {
        color: #94a3b8;
        text-decoration: line-through;
    }
    button {
        font: inherit;
        padding: 0.45rem 0.75rem;
        border: 1px solid #94a3b8;
        border-radius: 6px;
        background: #fff;
    }
    button.primary {
        color: #fff;
        border-color: #166534;
        background: #15803d;
    }
    button:disabled {
        opacity: 0.45;
    }
</style>
