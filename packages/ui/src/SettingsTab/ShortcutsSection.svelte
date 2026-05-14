<script lang="ts">
    import type { LyriCueSettings } from "@lyricue/core"

    export let settings: LyriCueSettings
    export let onChange: (next: LyriCueSettings) => void
    export let onReset: () => void

    type ShortcutKey = keyof LyriCueSettings["shortcuts"]
    const fields: { key: ShortcutKey; label: string }[] = [
        { key: "startSync", label: "Start sync" },
        { key: "nextSection", label: "Next section" },
        { key: "prevSection", label: "Previous section" },
        { key: "toggleManual", label: "Toggle manual mode" },
        { key: "reEngageSync", label: "Re-engage sync" }
    ]

    let recording: ShortcutKey | null = null

    function startRecord(key: ShortcutKey): void {
        recording = key
    }

    function onKeyDown(e: KeyboardEvent): void {
        if (!recording) return
        e.preventDefault()
        const code = e.code
        // Detect conflicts.
        const conflict = fields.find(
            (f) => f.key !== recording && settings.shortcuts[f.key] === code
        )
        if (conflict) {
            // Surface inline; user can either accept and re-bind the conflict or pick a different key.
            const ok = confirm(
                `"${code}" is already bound to "${conflict.label}". Re-bind it anyway?`
            )
            if (!ok) {
                recording = null
                return
            }
        }
        onChange({
            ...settings,
            shortcuts: { ...settings.shortcuts, [recording]: code }
        })
        recording = null
    }
</script>

<svelte:window on:keydown={onKeyDown} />

<section>
    <header>
        <h2>Keyboard shortcuts</h2>
        <button class="link" on:click={onReset}>Reset to defaults</button>
    </header>

    {#each fields as f}
        <div class="row">
            <span>{f.label}</span>
            <button on:click={() => startRecord(f.key)} class:recording={recording === f.key}>
                {recording === f.key ? "press a key…" : settings.shortcuts[f.key]}
            </button>
        </div>
    {/each}

    <p class="hint">
        Shortcut routing is wired up in EP-10 STORY-10.3 (it integrates with FreeShow's existing
        handler in fork mode and with our own in sister mode).
    </p>
</section>

<style>
    section {
        display: flex;
        flex-direction: column;
        gap: 0.8rem;
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
    .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        font-size: 0.9rem;
    }
    button {
        font: ui-monospace, monospace;
        font-size: 0.85rem;
        padding: 0.4rem 0.75rem;
        border: 1px solid #ccc;
        border-radius: 6px;
        background: #f7f7f7;
        cursor: pointer;
    }
    button:hover {
        background: #eaeaea;
    }
    button.recording {
        background: #fff7d6;
        border-color: #d4a900;
        color: #765a00;
    }
    .hint {
        color: #666;
        font-size: 0.85rem;
        margin: 0.5rem 0 0;
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
