<script lang="ts">
    import type { InstallIdentity } from "@lyricue/core"

    export let identity: InstallIdentity
    export let onChange: (next: InstallIdentity) => void

    let isAnonymous = identity.user?.isAnonymous ?? true
    let displayName = identity.user?.displayName ?? ""

    function commit(): void {
        onChange({
            ...identity,
            user: isAnonymous
                ? { isAnonymous: true }
                : {
                      isAnonymous: false,
                      displayName: displayName.trim() || undefined
                  }
        })
    }
</script>

<section>
    <header>
        <h2>Identity</h2>
    </header>

    <div class="info">
        <strong>Organisation</strong>
        <span class="value">{identity.org.name} <code>({identity.org.id})</code></span>
    </div>

    <div class="info">
        <strong>Campus</strong>
        <span class="value">{identity.campus.name} <code>({identity.campus.id})</code></span>
    </div>

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

    <p class="hint">
        Org and campus are set during the first-run wizard. Changing them is a re-setup
        operation that lands in EP-15 STORY-15.7 (it triggers a library re-fetch since
        campus filters may differ).
    </p>
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
    .info {
        display: flex;
        gap: 0.5rem;
        font-size: 0.9rem;
        align-items: baseline;
    }
    .info strong {
        min-width: 120px;
    }
    code {
        font-family: ui-monospace, monospace;
        font-size: 0.8rem;
        color: #666;
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
