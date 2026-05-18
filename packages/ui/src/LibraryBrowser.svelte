<script lang="ts">
    import type { LibraryCatalogEntry } from "@lyricue/core"

    export let entries: LibraryCatalogEntry[] = []
    export let onDownloadSelected: (entries: LibraryCatalogEntry[]) => Promise<void>

    let query = ""
    let selected = new Set<string>()
    let status = ""
    let downloading = false

    $: filtered = entries.filter((entry) => {
        const haystack = `${entry.title} ${entry.songId}`.toLowerCase()
        return haystack.includes(query.trim().toLowerCase())
    })

    function toggle(songId: string): void {
        selected = new Set(selected)
        if (selected.has(songId)) selected.delete(songId)
        else selected.add(songId)
    }

    async function download(): Promise<void> {
        const chosen = entries.filter((entry) => selected.has(entry.songId))
        if (chosen.length === 0) return
        downloading = true
        status = `Downloading ${chosen.length} bundle${chosen.length === 1 ? "" : "s"}...`
        try {
            await onDownloadSelected(chosen)
            status = `Downloaded ${chosen.length} bundle${chosen.length === 1 ? "" : "s"}.`
            selected = new Set()
        } catch (err) {
            status = (err as Error).message
        } finally {
            downloading = false
        }
    }
</script>

<section class="library-browser" aria-label="Library Browser">
    <header>
        <h2>Library Browser</h2>
        <input aria-label="Filter library" placeholder="Filter by title or ID" bind:value={query} />
    </header>

    <table>
        <thead>
            <tr><th></th><th>Title</th><th>Version</th><th>Updated</th></tr>
        </thead>
        <tbody>
            {#each filtered as entry}
                <tr>
                    <td>
                        <input
                            aria-label={`Select ${entry.title}`}
                            type="checkbox"
                            checked={selected.has(entry.songId)}
                            on:change={() => toggle(entry.songId)}
                        />
                    </td>
                    <td>{entry.title}</td>
                    <td>{entry.bundleVersion}</td>
                    <td>{entry.updatedAt ?? "unknown"}</td>
                </tr>
            {/each}
        </tbody>
    </table>

    <button disabled={selected.size === 0 || downloading} on:click={download}>
        {downloading ? "Downloading..." : "Download Selected"}
    </button>
    {#if status}<p>{status}</p>{/if}
</section>

<style>
    .library-browser {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }
    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
    }
    table {
        width: 100%;
        border-collapse: collapse;
    }
    th,
    td {
        text-align: left;
        border-bottom: 1px solid #ddd;
        padding: 0.4rem;
    }
    button,
    input {
        font: inherit;
        padding: 0.4rem;
    }
</style>
