<script lang="ts">
    interface RehearsalSegmentSummary {
        index: number
        showId?: string | null
        title?: string | null
        status: "learned" | "partial" | "failed" | "matched" | "review"
        confidence?: number
        startSec?: number
        endSec?: number
        sourceAudioPath?: string | null
    }

    export let segments: RehearsalSegmentSummary[] = []
    export let onReview: (segment: RehearsalSegmentSummary) => void

    function label(status: RehearsalSegmentSummary["status"]): "learned" | "partial" | "failed" {
        if (status === "matched" || status === "learned") return "learned"
        if (status === "review" || status === "partial") return "partial"
        return "failed"
    }
</script>

<section aria-label="Rehearsal Summary">
    <h2>Rehearsal Summary</h2>
    <ul>
        {#each segments as segment}
            <li data-status={label(segment.status)}>
                <button on:click={() => onReview(segment)}>
                    {segment.title ?? `Segment ${segment.index + 1}`}
                    <span>{label(segment.status)}</span>
                </button>
            </li>
        {/each}
    </ul>
</section>

<style>
    ul {
        list-style: none;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }
    button {
        width: 100%;
        display: flex;
        justify-content: space-between;
        padding: 0.55rem;
        font: inherit;
    }
    [data-status="learned"] span {
        color: #15803d;
    }
    [data-status="partial"] span {
        color: #a16207;
    }
    [data-status="failed"] span {
        color: #b42318;
    }
</style>
