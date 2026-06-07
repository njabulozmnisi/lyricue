<script lang="ts">
    import type { LyriCueSettings } from "@lyricue/core"

    type DemucsModel = LyriCueSettings["sidecar"]["demucsModel"]
    type WhisperxModel = LyriCueSettings["sidecar"]["whisperxModel"]

    export let settings: LyriCueSettings
    export let onChange: (next: LyriCueSettings) => void
    export let onReset: () => void

    function patch(partial: Partial<LyriCueSettings["sidecar"]>): void {
        onChange({ ...settings, sidecar: { ...settings.sidecar, ...partial } })
    }
    function onPythonPathChange(e: Event): void {
        const value = (e.currentTarget as HTMLInputElement).value
        patch({ pythonPath: value || null })
    }
    function onManifestPathChange(e: Event): void {
        const value = (e.currentTarget as HTMLInputElement).value
        patch({ modelManifestPath: value || null })
    }
    function onMirrorUrlChange(e: Event): void {
        const value = (e.currentTarget as HTMLInputElement).value
        patch({ modelMirrorUrl: value || null })
    }
    function onRequireManifestChange(e: Event): void {
        patch({ requireModelManifest: (e.currentTarget as HTMLInputElement).checked })
    }
    function onDemucsChange(e: Event): void {
        patch({ demucsModel: (e.currentTarget as HTMLSelectElement).value as DemucsModel })
    }
    function onWhisperxChange(e: Event): void {
        patch({ whisperxModel: (e.currentTarget as HTMLSelectElement).value as WhisperxModel })
    }
</script>

<section>
    <header>
        <h2>Sidecar (advanced)</h2>
        <button class="link" on:click={onReset}>Reset to defaults</button>
    </header>

    <p class="hint">
        These settings control the Python ML sidecar. The default (bundled binary) works for
        everyone — only change them if you're developing against a local venv or testing models.
    </p>

    <label>
        Python interpreter override (development only)
        <input
            type="text"
            placeholder="(uses bundled sidecar)"
            value={settings.sidecar.pythonPath ?? ""}
            on:input={onPythonPathChange}
        />
    </label>

    <label>
        Model manifest path
        <input
            type="text"
            placeholder="(uses installer/env configuration)"
            value={settings.sidecar.modelManifestPath ?? ""}
            on:input={onManifestPathChange}
        />
    </label>

    <label>
        Model mirror URL
        <input
            type="url"
            placeholder="https://models.example.org/lyricue/"
            value={settings.sidecar.modelMirrorUrl ?? ""}
            on:input={onMirrorUrlChange}
        />
    </label>

    <label class="check">
        <input
            type="checkbox"
            checked={settings.sidecar.requireModelManifest}
            on:change={onRequireManifestChange}
        />
        Require a manifest for production learning
    </label>

    <label>
        Demucs model
        <select value={settings.sidecar.demucsModel} on:change={onDemucsChange}>
            <option value="htdemucs">htdemucs (default — best quality)</option>
            <option value="htdemucs_ft">htdemucs_ft (fine-tuned)</option>
            <option value="mdx_extra">mdx_extra (smaller, faster)</option>
        </select>
    </label>

    <label>
        WhisperX model
        <select value={settings.sidecar.whisperxModel} on:change={onWhisperxChange}>
            <option value="tiny">tiny (~75 MB)</option>
            <option value="base">base (~150 MB)</option>
            <option value="small">small (~500 MB — default)</option>
            <option value="medium">medium (~1.5 GB)</option>
        </select>
    </label>
</section>

<style>
    section {
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
    }
    header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
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
    .hint {
        color: #666;
        font-size: 0.85rem;
        margin: 0;
    }
    input,
    select {
        font: inherit;
        padding: 0.4rem;
        border: 1px solid #ccc;
        border-radius: 6px;
    }
    label.check {
        flex-direction: row;
        align-items: center;
        gap: 0.5rem;
    }
    label.check input {
        width: auto;
    }
    button.link {
        background: none;
        border: none;
        color: #1f6feb;
        cursor: pointer;
        text-decoration: underline;
        font: inherit;
    }
</style>
