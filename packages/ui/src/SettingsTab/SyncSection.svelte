<script lang="ts">
    import type { LyriCueSettings } from "@lyricue/core"

    export let settings: LyriCueSettings
    export let onChange: (next: LyriCueSettings) => void
    export let onReset: () => void

    function patch(partial: Partial<LyriCueSettings["sync"]>): void {
        onChange({ ...settings, sync: { ...settings.sync, ...partial } })
    }
    function readNumber(e: Event): number {
        return Number((e.currentTarget as HTMLInputElement).value)
    }
    function readChecked(e: Event): boolean {
        return (e.currentTarget as HTMLInputElement).checked
    }
</script>

<section>
    <header>
        <h2>Sync</h2>
        <button class="link" on:click={onReset}>Reset to defaults</button>
    </header>

    <label>
        Audio input device
        <input type="text" disabled value={settings.sync.audioInputDeviceId ?? "(none — configure in EP-07)"} />
        <span class="hint">Real device picker lands in EP-07 STORY-07.1.</span>
    </label>

    <label>
        <input
            type="checkbox"
            checked={settings.sync.sttEnabled}
            on:change={(e) => patch({ sttEnabled: readChecked(e) })}
        />
        Enable STT position correction
    </label>

    <label>
        Minimum consecutive STT words for a correction
        <input
            type="number"
            min="1"
            max="10"
            value={settings.sync.positionCorrectionMinWords}
            on:input={(e) => patch({ positionCorrectionMinWords: readNumber(e) })}
        />
    </label>

    <label>
        Manual-override debounce (seconds)
        <input
            type="number"
            min="0"
            max="30"
            step="0.5"
            value={settings.sync.manualOverrideDebounceSeconds}
            on:input={(e) => patch({ manualOverrideDebounceSeconds: readNumber(e) })}
        />
    </label>

    <label>
        Beat-confidence failover (seconds before Auto → Timer)
        <input
            type="number"
            min="1"
            max="60"
            value={settings.sync.confidenceFailoverSeconds}
            on:input={(e) => patch({ confidenceFailoverSeconds: readNumber(e) })}
        />
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
        font-size: 0.8rem;
    }
    input {
        font: inherit;
        padding: 0.4rem;
        border: 1px solid #ccc;
        border-radius: 6px;
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
