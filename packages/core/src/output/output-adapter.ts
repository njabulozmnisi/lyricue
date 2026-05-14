/**
 * OutputAdapter — the per-frame rendering-surface abstraction.
 *
 * Per architecture.md §4.9 and ADR-16. This is the single point of architectural divergence
 * between fork and sister-service modes:
 *
 *   - `ForkOutputAdapter`     — KR mounts inside a FreeShow output BrowserWindow;
 *                               SyncFrames travel over FreeShow's OUTPUT IPC channel.
 *   - `OwnWindowOutputAdapter` — KR mounts inside a LyriCue-owned Electron BrowserWindow;
 *                                SyncFrames travel over LyriCue's internal IPC.
 *   - `CaptionInjectionOutputAdapter` — drives FreeShow's Captions item via WebSocket;
 *                                       lands post-upstream-PR (EP-20).
 *
 * Every other module (SE, BD, VAD, ST, KR's logic, LM, settings) is adapter-agnostic.
 * Swapping adapters is a configuration choice at runtime, not a code change.
 *
 * Threading: all OutputAdapter implementations live in the Electron main process. The
 * Sync Engine (which also lives in the main process — see architecture.md §3.3) calls
 * pushSyncFrame() from its rAF tick loop. The adapter is responsible for moving each
 * frame to the renderer process; how that happens is mode-specific.
 *
 * Error model: adapters MUST NOT throw from pushSyncFrame(). A frame that can't be
 * delivered (renderer crashed, IPC saturated) is dropped and recorded in `health`.
 * Live worship cannot pause for an exception (NFR2.1 — zero crashes during a live event).
 *
 * Lifecycle:
 *   1. Adapter constructed with mode-specific config.
 *   2. `start(opts)` opens the rendering surface (BrowserWindow, IPC handle, etc.).
 *   3. `loadTimingMap(...)` runs every time the active song changes.
 *   4. `pushSyncFrame(...)` runs every rAF tick.
 *   5. `stop()` tears down the surface. Safe to call repeatedly.
 */

import type { Arrangement, ParallelLyricsTrack, TimingMap } from "../types/timing-map.js"
import type { LoadMapPayload, SyncFrame } from "./sync-frame.js"

export type OutputAdapterMode = "fork" | "own-window" | "caption-injection"

/**
 * Rectangle in screen coordinates. Used to position the output window on a chosen
 * display. Electron's BrowserWindow.setBounds() takes the same shape.
 */
export interface OutputRect {
    x: number
    y: number
    width: number
    height: number
}

export interface OutputAdapterStartOptions {
    /** Stable ID for the output window. Multi-output is supported; each output has its own ID. */
    outputId: string
    /**
     * Initial window bounds in screen coordinates. Optional — adapters that own their window
     * (own-window) use this directly; the fork adapter ignores it because FreeShow owns the
     * BrowserWindow bounds.
     */
    bounds?: OutputRect
}

/**
 * Observable adapter health. Read continuously by the Diagnostics panel (STORY-02.5)
 * and by SE's degradation logic (when frame delivery falls behind for too long, SE
 * surfaces a warning).
 */
export interface AdapterHealth {
    /** True once start() has resolved and the rendering surface is live. */
    readonly running: boolean
    /** performance.now() of the last successful pushSyncFrame call; null before first frame. */
    readonly lastFrameAtMs: number | null
    /** Total frames delivered since start. */
    readonly framesDelivered: number
    /** Frames dropped because the channel was saturated or the renderer wasn't ready. */
    readonly framesDropped: number
    /**
     * Most recent error (if any). Cleared on a subsequent successful frame.
     * Adapters set this rather than throwing — see error model above.
     */
    readonly lastError: { at: number; message: string } | null
}

/**
 * The single contract that all rendering surfaces conform to. Sized at ~50 LOC by design
 * (per ADR-16: "The OutputAdapter abstraction is the entire bet").
 */
export interface OutputAdapter {
    /** Discriminator so downstream code can react to capability differences if needed. */
    readonly mode: OutputAdapterMode

    /**
     * Opens the rendering surface. Idempotent: a second call after a successful start
     * resolves immediately. Throws (synchronously, before any async work) only on
     * configuration errors that the operator must fix — e.g. invalid bounds, no display
     * available. Runtime errors during operation go through `health.lastError`.
     */
    start(opts: OutputAdapterStartOptions): Promise<void>

    /**
     * Closes the rendering surface. Safe to call repeatedly and before start(). After
     * stop() resolves, the adapter must accept no further pushSyncFrame or loadTimingMap
     * calls (or it must drop them silently — implementer's choice, but the latter is
     * preferred for live-worship safety).
     */
    stop(): Promise<void>

    /**
     * Per-frame state push. Must complete in <2 ms on a modern CPU (architecture.md
     * §4.8 budget). Synchronous from the caller's perspective; the adapter may queue
     * the frame on an internal IPC channel.
     *
     * If the underlying transport is saturated, drop the frame and increment
     * `health.framesDropped`. Never throw.
     */
    pushSyncFrame(frame: SyncFrame): void

    /**
     * Called when the active song changes. The adapter caches the map and forwards it
     * to the renderer; subsequent SyncFrames don't carry the map (which would bloat
     * each ~60 Hz message).
     *
     * `arrangement` is null when the operator hasn't selected a custom arrangement —
     * KR walks the timing map's native section order.
     */
    loadTimingMap(
        map: TimingMap,
        arrangement: Arrangement | null,
        parallelLyrics?: ParallelLyricsTrack[]
    ): void

    /**
     * Observable health for the Diagnostics panel (STORY-02.5) and for SE's degradation
     * logic. Read-only from outside the adapter.
     */
    readonly health: AdapterHealth
}

/**
 * Convenience constructor for an empty LoadMapPayload object — useful for tests and
 * for the walking-skeleton demo before EP-03 provides real timing maps.
 *
 * Not exported from the package barrel because real code should always have a real map;
 * this is a development utility.
 */
export function loadMapPayload(
    outputId: string,
    map: TimingMap,
    arrangement: Arrangement | null = null,
    parallelLyrics?: ParallelLyricsTrack[]
): LoadMapPayload {
    // Build conditionally so `parallelLyrics` is omitted (not set to undefined) when absent —
    // exactOptionalPropertyTypes requires this distinction.
    const base: LoadMapPayload = {
        outputId,
        showId: map.showId,
        timingMap: map,
        arrangement
    }
    if (parallelLyrics !== undefined) {
        return { ...base, parallelLyrics }
    }
    return base
}
