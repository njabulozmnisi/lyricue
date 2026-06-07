<script lang="ts">
    interface RehearsalRecordingInfo {
        fileName: string
        filePath: string
        sizeBytes: number
        modifiedAtMs: number
    }

    export let recordings: RehearsalRecordingInfo[] = []
    export let onRefresh: () => Promise<void> | void
    export let onDelete: (fileName: string) => Promise<void> | void
    export let onDeleteOlderThan: (olderThanDays: number) => Promise<void> | void

    let sweepDays = 30
    let busy = false
    let error: string | null = null

    $: totalBytes = recordings.reduce((sum, recording) => sum + recording.sizeBytes, 0)

    async function run(action: () => Promise<void> | void): Promise<void> {
        busy = true
        error = null
        try {
            await action()
        } catch (err) {
            error = (err as Error).message || "Storage action failed."
        } finally {
            busy = false
        }
    }

    function formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    }

    function formatDate(ms: number): string {
        return new Date(ms).toLocaleString()
    }
</script>

<section>
    <header>
        <div>
            <h2>Storage</h2>
            <p>{recordings.length} rehearsal recording{recordings.length === 1 ? "" : "s"} · {formatBytes(totalBytes)}</p>
        </div>
        <button class="link" disabled={busy} on:click={() => run(onRefresh)}>Refresh</button>
    </header>

    {#if error}
        <p class="error" role="alert">{error}</p>
    {/if}

    <fieldset>
        <legend>Cleanup</legend>
        <label>
            Delete recordings older than
            <input type="number" min="0" max="3650" bind:value={sweepDays} />
        </label>
        <button disabled={busy} on:click={() => run(() => onDeleteOlderThan(sweepDays))}>Delete older than {sweepDays} days</button>
    </fieldset>

    {#if recordings.length === 0}
        <p class="empty">No rehearsal recordings found.</p>
    {:else}
        <ul>
            {#each recordings as recording}
                <li>
                    <div>
                        <strong>{recording.fileName}</strong>
                        <span>{formatBytes(recording.sizeBytes)} · {formatDate(recording.modifiedAtMs)}</span>
                    </div>
                    <button disabled={busy} on:click={() => run(() => onDelete(recording.fileName))}>Delete</button>
                </li>
            {/each}
        </ul>
    {/if}
</section>

<style>
    section {
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
    }
    header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
    }
    h2,
    p {
        margin: 0;
    }
    h2 {
        font-size: 1.1rem;
    }
    header p,
    .empty,
    li span {
        color: #666;
        font-size: 0.85rem;
    }
    fieldset {
        border: 1px solid #e3e3e3;
        border-radius: 6px;
        padding: 0.75rem;
        margin: 0;
        display: flex;
        align-items: end;
        gap: 0.75rem;
    }
    legend {
        font-size: 0.85rem;
        color: #666;
        padding: 0 0.25rem;
    }
    label {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        font-size: 0.9rem;
    }
    input,
    button {
        font: inherit;
        padding: 0.4rem;
        border: 1px solid #ccc;
        border-radius: 6px;
        background: #fafafa;
    }
    button {
        cursor: pointer;
    }
    button:hover:not(:disabled) {
        background: #eaeaea;
    }
    button.link {
        background: none;
        border: none;
        color: #1f6feb;
        cursor: pointer;
        text-decoration: underline;
    }
    ul {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }
    li {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 0.75rem;
        align-items: center;
        border: 1px solid #e3e3e3;
        border-radius: 6px;
        padding: 0.65rem;
    }
    li div {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        min-width: 0;
    }
    strong {
        overflow-wrap: anywhere;
    }
    .error {
        color: #b42318;
        font-size: 0.9rem;
    }
</style>
