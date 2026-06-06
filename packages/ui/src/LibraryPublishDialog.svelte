<script lang="ts">
    import type { InstallIdentity } from "@lyricue/core"

    interface PublishDialogPayload {
        mode: "song" | "project"
        title: string
        tags: string[]
        attribution: string
        target: "central" | "campus"
        anonymous: boolean
    }

    export let identity: InstallIdentity
    export let hasCredential = false
    export let credentialTargets: { central?: boolean; campus?: boolean } | null = null
    export let initialTitle = ""
    export let onPublish: (payload: PublishDialogPayload) => Promise<{ bundleUrl?: string; projectUrl?: string }>

    let mode: "song" | "project" = "song"
    let title = initialTitle
    let tagsText = ""
    let attribution = ""
    let target: "central" | "campus" = "central"
    let anonymous = identity.user?.isAnonymous ?? true
    let status = ""
    let publishing = false
    $: targetHasCredential = credentialTargets ? credentialTargets[target] === true : hasCredential

    async function publish(): Promise<void> {
        if (!targetHasCredential || !title.trim()) return
        publishing = true
        status = ""
        try {
            const result = await onPublish({
                mode,
                title: title.trim(),
                tags: tagsText.split(",").map((tag) => tag.trim()).filter(Boolean),
                attribution: attribution.trim(),
                target,
                anonymous
            })
            status = `Published: ${result.projectUrl ?? result.bundleUrl ?? "complete"}`
        } catch (err) {
            status = (err as Error).message
        } finally {
            publishing = false
        }
    }
</script>

<section class="publish-dialog" aria-label="Publish to Library">
    <h2>Publish to Library</h2>
    <fieldset>
        <legend>Type</legend>
        <label><input type="radio" bind:group={mode} value="song" /> Song</label>
        <label><input type="radio" bind:group={mode} value="project" /> Project</label>
    </fieldset>
    <label>
        Title
        <input aria-label="Publish title" bind:value={title} />
    </label>
    <label>
        Tags
        <input aria-label="Publish tags" placeholder="worship, fast, communion" bind:value={tagsText} />
    </label>
    <label>
        Attribution
        <input aria-label="Publish attribution" bind:value={attribution} />
    </label>
    <fieldset>
        <legend>Target</legend>
        <label><input type="radio" bind:group={target} value="central" /> Central</label>
        <label><input type="radio" bind:group={target} value="campus" /> Campus</label>
    </fieldset>
    <label class="row">
        <input type="checkbox" bind:checked={anonymous} />
        Publish anonymously
    </label>
    {#if !targetHasCredential}<p class="error">No publish credential configured for {target} publishing.</p>{/if}
    <button class="primary" disabled={!targetHasCredential || !title.trim() || publishing} on:click={publish}>
        {publishing ? "Publishing..." : "Publish"}
    </button>
    {#if status}<p class="status">{status}</p>{/if}
</section>

<style>
    .publish-dialog {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }
    label {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }
    label.row,
    fieldset label {
        flex-direction: row;
        align-items: center;
        gap: 0.4rem;
    }
    input,
    button {
        font: inherit;
        padding: 0.45rem;
    }
    .error {
        color: #b42318;
    }
    .status {
        color: #146c2e;
    }
</style>
