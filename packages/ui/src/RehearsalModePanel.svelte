<script lang="ts">
    export let elapsedMs = 0
    export let level = 0
    export let recording = false
    export let onStart: () => void
    export let onStop: () => void

    $: elapsed = new Date(elapsedMs).toISOString().slice(11, 19)
    $: meter = `${Math.max(0, Math.min(1, level)) * 100}%`
</script>

<section class="rehearsal" aria-label="Rehearsal Mode">
    <header>
        <h2>Rehearsal Mode</h2>
        <span class:recording>{recording ? "Recording" : "Ready"}</span>
    </header>
    <div class="meter" aria-label="Input level"><span style={`width: ${meter}`}></span></div>
    <div class="elapsed">{elapsed}</div>
    <div class="actions">
        <button disabled={recording} on:click={onStart}>Start</button>
        <button disabled={!recording} on:click={onStop}>Stop</button>
    </div>
</section>

<style>
    .rehearsal {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }
    header {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    .recording {
        color: #b42318;
        font-weight: 700;
    }
    .meter {
        height: 12px;
        background: #e5e7eb;
    }
    .meter span {
        display: block;
        height: 100%;
        background: #16a34a;
    }
    .elapsed {
        font-family: ui-monospace, monospace;
    }
    button {
        font: inherit;
        padding: 0.45rem 0.75rem;
    }
</style>
