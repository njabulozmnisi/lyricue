<script lang="ts">
    import type { InstallIdentity } from "@lyricue/core"

    export let identity: InstallIdentity
    export let onChange: (next: InstallIdentity) => void
    export let onCampusChange: (() => void) | undefined = undefined

    let isAnonymous = identity.user?.isAnonymous ?? true
    let displayName = identity.user?.displayName ?? ""
    let orgName = identity.org.name
    let orgId = identity.org.id
    let campusName = identity.campus.name
    let campusId = identity.campus.id

    function commit(): void {
        const next = {
            ...identity,
            org: { id: slug(orgId || orgName || "local"), name: orgName.trim() || "Local" },
            campus: { id: slug(campusId || campusName || "default"), name: campusName.trim() || "Default" },
            user: isAnonymous
                ? { isAnonymous: true }
                : {
                      isAnonymous: false,
                      displayName: displayName.trim() || undefined
                  }
        }
        onChange(next)
        if (next.campus.id !== identity.campus.id) onCampusChange?.()
    }

    function slug(value: string): string {
        return (
            value
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "") || "default"
        )
    }
</script>

<section>
    <header>
        <h2>Identity</h2>
    </header>

    <label>
        Organisation
        <input type="text" bind:value={orgName} on:blur={commit} />
    </label>
    <label>
        Organisation ID
        <input type="text" bind:value={orgId} on:blur={commit} />
    </label>
    <label>
        Campus
        <input type="text" bind:value={campusName} on:blur={commit} />
    </label>
    <label>
        Campus ID
        <input type="text" bind:value={campusId} on:blur={commit} />
    </label>

    <fieldset>
        <legend>Display name</legend>
        <label class="row">
            <input
                type="radio"
                bind:group={isAnonymous}
                value={true}
                on:change={commit}
            />
            Anonymous
        </label>
        <label class="row">
            <input
                type="radio"
                bind:group={isAnonymous}
                value={false}
                on:change={commit}
            />
            Show my name
        </label>
        {#if !isAnonymous}
            <input
                type="text"
                placeholder="Display name"
                bind:value={displayName}
                on:blur={commit}
            />
        {/if}
    </fieldset>

    <p class="hint">Changing campus should trigger a library catalog refresh in the host.</p>
</section>

<style>
    section {
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
    }
    header h2 {
        margin: 0;
        font-size: 1.1rem;
    }
    label {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        font-size: 0.9rem;
    }
    fieldset {
        border: 1px solid #e3e3e3;
        border-radius: 6px;
        padding: 0.75rem;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
    }
    legend {
        font-size: 0.85rem;
        color: #666;
        padding: 0 0.25rem;
    }
    label.row {
        flex-direction: row;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.9rem;
    }
    input[type="text"] {
        font: inherit;
        padding: 0.4rem;
        border: 1px solid #ccc;
        border-radius: 6px;
    }
    .hint {
        color: #666;
        font-size: 0.85rem;
        margin: 0;
    }
</style>
