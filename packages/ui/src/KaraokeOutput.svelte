<!--
    KaraokeOutput.svelte — the karaoke rendering surface for both deployment modes.

    Per architecture.md §4.9 and ADR-16. This component is *adapter-agnostic*:
      - In **fork mode**, FreeShow's MainOutput.svelte mounts this when the output's
        karaokeMode flag is true. SyncFrames arrive via FreeShow's OUTPUT IPC channel
        on the LC_SYNC_FRAME sub-channel.
      - In **sister mode**, LyriCue's own BrowserWindow mounts this directly. SyncFrames
        arrive via Electron IPC inside LyriCue's process tree.

    Either way, the component sees the same input: a SyncFrame store updated at up to 60 Hz.

    STORY-02.2 / STORY-02.3 scope:
      Show "Hello, LyriCue" with the current SyncFrame's wordProgress driving a simple
      visual cue. The full per-word sweep, line transitions, and held-note pulse land in
      EP-06 (Karaoke Renderer). This file is the walking-skeleton stub that proves the
      OutputAdapter abstraction reaches a rendering surface in both modes.
-->
<script lang="ts">
    import { onMount, onDestroy } from "svelte"

    /**
     * Identifier for this output window. The adapter (Fork or OwnWindow) tags every
     * SyncFrame with the outputId so a multi-output setup can route correctly.
     * In single-output deployments this is unused but reserved for future use.
     */
    export let outputId: string

    /**
     * Optional callback the adapter can wire to receive a stream of SyncFrames.
     * In fork mode, the adapter passes a subscriber that listens on FreeShow's OUTPUT
     * IPC. In sister mode, the adapter passes one that listens on LyriCue's internal IPC.
     * Both paths use the same shape so this component never sees the difference.
     *
     * If undefined (as in unit tests), the component renders a static placeholder.
     */
    export let subscribe: ((handler: (frame: SyncFrameLike) => void) => () => void) | undefined =
        undefined

    /** Minimal SyncFrame shape — kept here for typing; canonical type lives in @lyricue/core/output. */
    interface SyncFrameLike {
        outputId: string
        slideIndex: number
        wordIndex: number
        wordProgress: number
        tier: "auto" | "timer" | "manual"
        vad: "active" | "silent"
    }

    let currentFrame: SyncFrameLike | null = null
    let unsubscribe: (() => void) | null = null

    onMount(() => {
        if (subscribe) {
            unsubscribe = subscribe((frame) => {
                // Only accept frames addressed to us. The adapter may broadcast multi-output frames.
                if (frame.outputId === outputId) currentFrame = frame
            })
        }
    })

    onDestroy(() => {
        if (unsubscribe) unsubscribe()
    })

    // Visualise wordProgress as a sweep on a single placeholder word. EP-06 replaces this
    // with the real per-word rendering driven by the loaded TimingMap.
    $: progress = currentFrame ? Math.max(0, Math.min(1, currentFrame.wordProgress)) : 0
    $: tier = currentFrame?.tier ?? "auto"
    $: vad = currentFrame?.vad ?? "active"
</script>

<div class="karaoke-output" data-output-id={outputId} data-tier={tier} data-vad={vad}>
    <div class="word" style="--progress: {progress}">
        Hello, LyriCue
    </div>
    <div class="meta">
        <span class="tier">tier: {tier}</span>
        <span class="vad">vad: {vad}</span>
        {#if currentFrame}
            <span class="cursor">slide {currentFrame.slideIndex} · word {currentFrame.wordIndex}</span>
        {:else}
            <span class="cursor">waiting for sync…</span>
        {/if}
    </div>
</div>

<style>
    .karaoke-output {
        height: 100%;
        width: 100%;
        background: black;
        color: white;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-family: system-ui, sans-serif;
        gap: 1rem;
    }

    .word {
        font-size: clamp(2rem, 12vmin, 12rem);
        font-weight: 700;
        background: linear-gradient(
            to right,
            #ffcc00 calc(var(--progress, 0) * 100%),
            #666666 calc(var(--progress, 0) * 100%)
        );
        background-clip: text;
        -webkit-background-clip: text;
        color: transparent;
    }

    .meta {
        display: flex;
        gap: 1.5rem;
        font-size: 0.85rem;
        color: rgba(255, 255, 255, 0.5);
        font-family: ui-monospace, monospace;
    }
</style>
