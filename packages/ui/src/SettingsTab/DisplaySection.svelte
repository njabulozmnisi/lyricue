<script lang="ts">
    import type { LyriCueSettings } from "@lyricue/core"

    type DisplayMode = LyriCueSettings["display"]["mode"]
    type AnimationType = LyriCueSettings["display"]["animationType"]
    type HeldNoteAnimation = LyriCueSettings["display"]["heldNoteAnimation"]

    export let settings: LyriCueSettings
    export let onChange: (next: LyriCueSettings) => void
    export let onReset: () => void

    function patch(partial: Partial<LyriCueSettings["display"]>): void {
        onChange({ ...settings, display: { ...settings.display, ...partial } })
    }

    function onModeChange(e: Event): void {
        patch({ mode: (e.currentTarget as HTMLSelectElement).value as DisplayMode })
    }
    function onAnimationChange(e: Event): void {
        patch({ animationType: (e.currentTarget as HTMLSelectElement).value as AnimationType })
    }
    function onHeldChange(e: Event): void {
        patch({ heldNoteAnimation: (e.currentTarget as HTMLSelectElement).value as HeldNoteAnimation })
    }
    function readNumber(e: Event): number {
        return Number((e.currentTarget as HTMLInputElement).value)
    }
    function readColor(e: Event): string {
        return (e.currentTarget as HTMLInputElement).value
    }
</script>

<section>
    <header>
        <h2>Display</h2>
        <button class="link" on:click={onReset}>Reset to defaults</button>
    </header>

    <label>
        Mode
        <select value={settings.display.mode} on:change={onModeChange}>
            <option value="karaoke">Karaoke (word-level highlighting)</option>
            <option value="section">Section advance (slide-by-slide auto)</option>
            <option value="traditional">Traditional (manual)</option>
        </select>
    </label>

    <label>
        Lead time (seconds before section change)
        <input
            type="range"
            min="0"
            max="5"
            step="0.5"
            value={settings.display.leadTimeSeconds}
            on:input={(e) => patch({ leadTimeSeconds: readNumber(e) })}
        />
        <span class="value">{settings.display.leadTimeSeconds.toFixed(1)} s</span>
    </label>

    <fieldset>
        <legend>Colors</legend>
        <label class="row">
            Highlight
            <input
                type="color"
                value={settings.display.highlightColor}
                on:input={(e) => patch({ highlightColor: readColor(e) })}
            />
        </label>
        <label class="row">
            Sung
            <input
                type="color"
                value={settings.display.sungColor}
                on:input={(e) => patch({ sungColor: readColor(e) })}
            />
        </label>
        <label class="row">
            Upcoming
            <input
                type="color"
                value={settings.display.upcomingColor}
                on:input={(e) => patch({ upcomingColor: readColor(e) })}
            />
        </label>
    </fieldset>

    <label>
        Animation
        <select value={settings.display.animationType} on:change={onAnimationChange}>
            <option value="sweep">Sweep</option>
            <option value="glow">Glow</option>
            <option value="bold">Bold</option>
        </select>
    </label>

    <label>
        Held-note treatment
        <select value={settings.display.heldNoteAnimation} on:change={onHeldChange}>
            <option value="pulse">Pulse</option>
            <option value="glow">Glow</option>
            <option value="static">Static</option>
        </select>
    </label>

    <label>
        Font size (px, base)
        <input
            type="number"
            min="12"
            max="200"
            step="2"
            value={settings.display.fontSize}
            on:input={(e) => patch({ fontSize: readNumber(e) })}
        />
    </label>

    <p class="hint">
        Live preview pane lands in EP-06 STORY-06.x once the karaoke renderer is wired up to
        respond to live setting changes.
    </p>
</section>

<style>
    section {
        display: flex;
        flex-direction: column;
        gap: 1rem;
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
    label.row {
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
    }
    fieldset {
        border: 1px solid #e3e3e3;
        border-radius: 6px;
        padding: 0.75rem;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }
    legend {
        font-size: 0.85rem;
        color: #666;
        padding: 0 0.25rem;
    }
    input,
    select {
        font: inherit;
        padding: 0.4rem;
        border: 1px solid #ccc;
        border-radius: 6px;
    }
    input[type="color"] {
        padding: 0;
        width: 60px;
        height: 30px;
    }
    .value {
        font-variant-numeric: tabular-nums;
        color: #666;
        font-size: 0.85rem;
    }
    .hint {
        color: #666;
        font-size: 0.85rem;
        margin: 0;
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
