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

    function details(segment: RehearsalSegmentSummary): string {
        const bits: string[] = []
        if (typeof segment.startSec === "number" && typeof segment.endSec === "number") {
            bits.push(`${formatTime(segment.startSec)}-${formatTime(segment.endSec)}`)
        }
        if (typeof segment.confidence === "number") bits.push(`${Math.round(segment.confidence * 100)}%`)
        return bits.join(" · ")
    }

    function formatTime(seconds: number): string {
        const safe = Math.max(0, Math.round(seconds))
        const minutes = Math.floor(safe / 60)
        const remainder = String(safe % 60).padStart(2, "0")
        return `${minutes}:${remainder}`
    }
</script>

<section aria-label="Rehearsal Summary">
    <h2>Rehearsal Summary</h2>
    <ul>
        {#each segments as segment}
            <li data-status={label(segment.status)}>
                <button on:click={() => onReview(segment)}>
                    <span class="title">
                        {segment.title ?? `Segment ${segment.index + 1}`}
                        {#if details(segment)}
                            <small>{details(segment)}</small>
                        {/if}
                    </span>
                    <span class="status">{label(segment.status)}</span>
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
        align-items: center;
        gap: 0.75rem;
        padding: 0.55rem;
        font: inherit;
        text-align: left;
    }
    .title {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
    }
    small {
        color: #6b7280;
    }
    [data-status="learned"] .status {
        color: #15803d;
    }
    [data-status="partial"] .status {
        color: #a16207;
    }
    [data-status="failed"] .status {
        color: #b42318;
    }
</style>
