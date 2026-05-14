<script lang="ts">
    import type { LibraryConfig } from "@lyricue/core"

    export let libraryConfig: LibraryConfig
    export let onChange: (next: LibraryConfig) => void

    function patch(partial: Partial<LibraryConfig>): void {
        onChange({ ...libraryConfig, ...partial })
    }
    function readChecked(e: Event): boolean {
        return (e.currentTarget as HTMLInputElement).checked
    }
    function readUrlOrNull(e: Event): string | null {
        const v = (e.currentTarget as HTMLInputElement).value
        return v || null
    }
</script>

<section>
    <header>
        <h2>Library</h2>
    </header>

    <label>
        <input
            type="checkbox"
            checked={libraryConfig.enabled}
            on:change={(e) => patch({ enabled: readChecked(e) })}
        />
        Use a shared LyriCue library
    </label>

    {#if libraryConfig.enabled}
        <label>
            Primary library URL
            <input
                type="url"
                placeholder="https://library.example.org"
                value={libraryConfig.primaryUrl ?? ""}
                on:input={(e) => patch({ primaryUrl: readUrlOrNull(e) })}
            />
        </label>

        <label>
            Mirror URL (optional)
            <input
                type="url"
                placeholder="https://raw.githubusercontent.com/org/library-mirror/main"
                value={libraryConfig.mirrorUrl ?? ""}
                on:input={(e) => patch({ mirrorUrl: readUrlOrNull(e) })}
            />
        </label>

        <div class="info">
            <strong>Publish credential</strong>
            {#if libraryConfig.publishCredential}
                <span class="value">Configured ({libraryConfig.publishCredential.keyId ?? "unnamed"})</span>
                <button>Manage</button>
            {:else}
                <span class="value">Not configured</span>
                <button>Add</button>
            {/if}
            <p class="hint">
                Publish credential management lands in EP-15 STORY-15.3 (paste + Test, stored via OS keychain).
            </p>
        </div>

        <div class="info">
            <strong>Trust list</strong>
            <span class="value">
                {libraryConfig.trustedPublicKeys.length} public
                key{libraryConfig.trustedPublicKeys.length === 1 ? "" : "s"} trusted
            </span>
            <p class="hint">
                Signing key import / rotation lands in EP-15 STORY-15.6.
            </p>
        </div>
    {/if}
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
    .info {
        display: grid;
        grid-template-columns: 160px 1fr auto;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.9rem;
    }
    .info p.hint {
        grid-column: 1 / -1;
        color: #666;
        font-size: 0.8rem;
        margin: 0;
    }
    .value {
        color: #444;
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
    button:hover {
        background: #eaeaea;
    }
</style>
