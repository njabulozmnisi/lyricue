<script lang="ts">
    export let currentKeyId: string | null = null
    export let onSave: (payload: { keyId: string; credential: string }) => Promise<void>
    export let onClear: (() => Promise<void>) | undefined = undefined

    let keyId = currentKeyId ?? ""
    let credential = ""
    let busy = false
    let status = ""
    $: canSave = keyId.trim().length > 0 && credential.trim().length > 0 && !busy

    async function save(): Promise<void> {
        if (!canSave) return
        busy = true
        status = ""
        try {
            await onSave({ keyId: keyId.trim(), credential })
            credential = ""
            status = "Publish credential saved."
        } catch (err) {
            status = (err as Error).message
        } finally {
            busy = false
        }
    }

    async function clear(): Promise<void> {
        if (!onClear || busy) return
        busy = true
        status = ""
        try {
            await onClear()
            keyId = ""
            credential = ""
            status = "Publish credential removed."
        } catch (err) {
            status = (err as Error).message
        } finally {
            busy = false
        }
    }
</script>

<section class="credential-dialog" aria-label="Publish Credential">
    {#if currentKeyId}
        <p class="current">Configured credential: {currentKeyId}</p>
    {/if}
    <label>
        Credential label
        <input aria-label="Credential label" bind:value={keyId} placeholder="central-2026-q1" />
    </label>
    <label>
        Credential
        <input aria-label="Publish credential" type="password" bind:value={credential} autocomplete="off" />
    </label>
    <div class="actions">
        {#if currentKeyId && onClear}
            <button type="button" class="danger" disabled={busy} on:click={clear}>Remove</button>
        {/if}
        <button type="button" class="primary" disabled={!canSave} on:click={save}>
            {busy ? "Saving..." : "Save"}
        </button>
    </div>
    {#if status}<p class="status">{status}</p>{/if}
</section>

<style>
    .credential-dialog {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }
    .current,
    .status {
        margin: 0;
    }
    label {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }
    input,
    button {
        font: inherit;
        padding: 0.45rem;
    }
    .actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
    }
    .primary {
        background: #1f6feb;
        color: white;
        border: 1px solid #1f6feb;
    }
    .danger {
        background: #fff;
        color: #b42318;
        border: 1px solid #b42318;
    }
    button:disabled {
        opacity: 0.55;
    }
    .status {
        color: #146c2e;
    }
</style>
