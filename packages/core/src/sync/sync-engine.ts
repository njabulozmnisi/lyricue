/**
 * SyncEngine — the orchestrator that wires state + tick + events into a running engine.
 *
 * Per EP-09 STORY-09.1 through 09.7, architecture.md §4.8.
 *
 * Architecture:
 *   - State lives in a Svelte-store-compatible writable. The store is the public read API.
 *   - Events come in via `dispatch(event)`. Each event runs through `applyEvent` (pure).
 *   - The rAF loop calls `tick(state, now)` once per frame and atomically swaps the new
 *     state into the store.
 *   - Audio inputs (tempoRatio, beatConfidence, vadState) are wired by the host as
 *     event sources. SE doesn't import @lyricue/core/audio directly — it accepts the
 *     events. EP-10 wires the renderer-side composition.
 *
 * Output:
 *   - `state` — read-only Svelte store the operator UI and SyncFrame pipeline subscribe to.
 *   - `onSyncFrame(handler)` — fires per tick with a SyncFrame ready for the
 *     OutputAdapter. Replaces the DemoSyncEngine in production.
 *   - `onSongComplete(handler)` — fires when the cursor crosses the song boundary
 *     (STORY-09.7), so the host (Setlist Panel / EP-12) can auto-advance.
 *
 * Frame source injection:
 *   The host provides `requestFrame(cb): cancel` so production wires it to
 *   `window.requestAnimationFrame` and tests wire a deterministic clock-driven runner.
 *   This keeps SE's hot loop testable in plain Node.
 */

import { writable, type Readable } from "../settings/observable.js"
import type { SyncFrame } from "../output/sync-frame.js"
import type { Arrangement, TimingMap } from "../types/timing-map.js"
import {
    applyEvent,
    makeInitialState,
    type SyncEngineState,
    type SyncEvent,
    type SyncTier
} from "./sync-engine-state.js"
import { tick, type TickOptions } from "./tick.js"

/**
 * Frame scheduler. Production: a wrapper over requestAnimationFrame returning a cancel
 * function. Tests: a manual stepper.
 */
export type FrameScheduler = (callback: (nowMs: number) => void) => () => void

export interface SyncEngineOptions extends TickOptions {
    /**
     * Required. Production wires `(cb) => { const id = requestAnimationFrame(cb); return () => cancelAnimationFrame(id); }`.
     * Tests inject a deterministic stepper.
     */
    requestFrame: FrameScheduler
    /** Optional clock override; defaults to performance.now(). */
    now?: () => number
}

export interface SyncEngine {
    /** Public read-only state stream. Subscribers see every tick. */
    readonly state: Readable<SyncEngineState>

    /** Snapshot of the current state without subscribing. */
    snapshot(): SyncEngineState

    /** Dispatch an event. Pure transition + immediate store update. */
    dispatch(event: SyncEvent): void

    /** Subscribe to per-tick SyncFrames ready for the OutputAdapter. */
    onSyncFrame(handler: (frame: SyncFrame) => void): () => void

    /** Subscribe to song-complete events (cursor crossed totalDurationMs). */
    onSongComplete(handler: () => void): () => void

    /** Start the rAF loop. Idempotent. */
    start(): void

    /** Stop the rAF loop. Idempotent. Does NOT clear state — just pauses ticks. */
    stop(): void

    /** True iff the rAF loop is running. */
    isRunning(): boolean

    // ── Convenience event dispatchers used by EP-10 keyboard handlers ──
    loadSong(opts: { map: TimingMap; arrangement: Arrangement | null; showId: string }): void
    clearSong(): void
    engageSync(): void
    toggleManual(): void
    reEngageSync(): void
    forceTier(t: SyncTier): void
}

/**
 * The `outputId` SE tags every SyncFrame with. EP-09 doesn't yet support multi-output
 * (one SE, one karaoke window). EP-10/11 may evolve this; for now a single id is fine.
 */
const SE_OUTPUT_ID = "lyricue-sync-engine"

export function createSyncEngine(opts: SyncEngineOptions): SyncEngine {
    const now = opts.now ?? (() => performance.now())
    const stateStore = writable<SyncEngineState>(makeInitialState())

    const syncFrameHandlers = new Set<(frame: SyncFrame) => void>()
    const songCompleteHandlers = new Set<() => void>()

    let cancelFrame: (() => void) | null = null
    let running = false
    /** Cache of the last runState so we fire songComplete only on the transition edge. */
    let lastRunState: SyncEngineState["runState"] = "idle"

    function snapshot(): SyncEngineState {
        let s = makeInitialState()
        stateStore.subscribe((v) => (s = v))()
        return s
    }

    function dispatch(event: SyncEvent): void {
        const before = snapshot()
        const after = applyEvent(before, event)
        if (after === before) return
        stateStore.set(after)
    }

    function emitSyncFrame(s: SyncEngineState): void {
        if (!s.activeTimingMap) return
        const frame: SyncFrame = {
            outputId: SE_OUTPUT_ID,
            slideIndex: s.currentSlideIndex,
            wordIndex: s.currentWordIndex,
            wordProgress: s.wordProgress,
            tier: s.tier,
            vad: s.vadState
        }
        for (const h of [...syncFrameHandlers]) {
            try {
                h(frame)
            } catch (err) {
                // A SyncFrame subscriber MUST NOT take down the engine. Live worship
                // tolerates a bad listener; it does not tolerate a broken cursor.
                // eslint-disable-next-line no-console
                console.error("[lyricue:sync-engine] onSyncFrame handler threw:", err)
            }
        }
    }

    function emitSongComplete(): void {
        for (const h of [...songCompleteHandlers]) {
            try {
                h()
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error("[lyricue:sync-engine] onSongComplete handler threw:", err)
            }
        }
    }

    function loop(): void {
        cancelFrame = opts.requestFrame((nowMs) => {
            if (!running) return
            const before = snapshot()
            const after = tick(before, nowMs, opts)
            if (after !== before) stateStore.set(after)
            emitSyncFrame(after)
            if (after.runState === "finished" && lastRunState !== "finished") {
                emitSongComplete()
            }
            lastRunState = after.runState
            loop()
        })
    }

    return {
        state: { subscribe: (run) => stateStore.subscribe(run) },
        snapshot,
        dispatch,
        onSyncFrame(handler) {
            syncFrameHandlers.add(handler)
            return () => {
                syncFrameHandlers.delete(handler)
            }
        },
        onSongComplete(handler) {
            songCompleteHandlers.add(handler)
            return () => {
                songCompleteHandlers.delete(handler)
            }
        },
        start() {
            if (running) return
            running = true
            lastRunState = snapshot().runState
            loop()
        },
        stop() {
            if (!running) return
            running = false
            cancelFrame?.()
            cancelFrame = null
        },
        isRunning() {
            return running
        },

        // ── Convenience event dispatchers ─────────────────────────────────────
        loadSong({ map, arrangement, showId }) {
            dispatch({ kind: "loadSong", map, arrangement, showId })
        },
        clearSong() {
            dispatch({ kind: "clearSong" })
        },
        engageSync() {
            dispatch({ kind: "engageSync", wallTime: now() })
        },
        toggleManual() {
            dispatch({ kind: "toggleManual", wallTime: now() })
        },
        reEngageSync() {
            dispatch({ kind: "reEngageSync", wallTime: now() })
        },
        forceTier(t) {
            dispatch({ kind: "forceTier", tier: t, wallTime: now() })
        }
    }
}
