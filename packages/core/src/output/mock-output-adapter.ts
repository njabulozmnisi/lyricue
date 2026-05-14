/**
 * MockOutputAdapter — a no-op OutputAdapter that records every call.
 *
 * Per epics.md STORY-02.1 AC4. Used by:
 *   - Unit tests of SE (EP-09) — verify SE pushes the right frames without spinning up
 *     a real BrowserWindow.
 *   - Walking-skeleton smoke tests — confirm the SE → OutputAdapter handshake works
 *     before we wire up real rendering surfaces.
 *   - Adapter-conformance tests — every real adapter (Fork, OwnWindow, CaptionInjection)
 *     can be compared against MockOutputAdapter's behaviour for the same input sequence.
 *
 * This is a test-utility, not production code. It is exported from
 * `@lyricue/core/output/test-utils` so accidental imports from production code surface
 * as a deep-path import that's easy to spot in PR review.
 */

import type { Arrangement, ParallelLyricsTrack, TimingMap } from "../types/timing-map.js"
import type {
    AdapterHealth,
    OutputAdapter,
    OutputAdapterMode,
    OutputAdapterStartOptions
} from "./output-adapter.js"
import type { SyncFrame } from "./sync-frame.js"

export interface MockAdapterCall {
    method: "start" | "stop" | "pushSyncFrame" | "loadTimingMap"
    /** performance.now() at the call. Useful for asserting frame cadence in tests. */
    atMs: number
    args: unknown
}

export interface MockOutputAdapterOptions {
    /** Discriminator returned from `mode`. Defaults to "own-window". */
    mode?: OutputAdapterMode
    /**
     * If set, the adapter pretends the renderer is saturated: every push is dropped and
     * counted in `health.framesDropped`. Used to test SE's behaviour when frames can't
     * be delivered.
     */
    dropEveryFrame?: boolean
}

/**
 * Internal mutable record kept alongside the AdapterHealth interface — externally the
 * interface is read-only, but the mock needs to mutate it.
 */
interface MutableHealth {
    running: boolean
    lastFrameAtMs: number | null
    framesDelivered: number
    framesDropped: number
    lastError: { at: number; message: string } | null
}

export class MockOutputAdapter implements OutputAdapter {
    readonly mode: OutputAdapterMode
    readonly calls: MockAdapterCall[] = []

    #health: MutableHealth = {
        running: false,
        lastFrameAtMs: null,
        framesDelivered: 0,
        framesDropped: 0,
        lastError: null
    }
    #drop: boolean

    constructor(opts: MockOutputAdapterOptions = {}) {
        this.mode = opts.mode ?? "own-window"
        this.#drop = Boolean(opts.dropEveryFrame)
    }

    get health(): AdapterHealth {
        // Return a frozen snapshot so callers can't mutate internal state.
        return Object.freeze({ ...this.#health })
    }

    async start(opts: OutputAdapterStartOptions): Promise<void> {
        this.#record("start", opts)
        this.#health.running = true
    }

    async stop(): Promise<void> {
        this.#record("stop", undefined)
        this.#health.running = false
    }

    pushSyncFrame(frame: SyncFrame): void {
        this.#record("pushSyncFrame", frame)
        if (!this.#health.running) {
            // Frames pushed before start() are dropped silently — matches the real-adapter
            // contract (a window that hasn't been opened yet can't render anything).
            this.#health.framesDropped++
            return
        }
        if (this.#drop) {
            this.#health.framesDropped++
            return
        }
        this.#health.framesDelivered++
        this.#health.lastFrameAtMs = performance.now()
        this.#health.lastError = null
    }

    loadTimingMap(
        map: TimingMap,
        arrangement: Arrangement | null,
        parallelLyrics?: ParallelLyricsTrack[]
    ): void {
        this.#record("loadTimingMap", { map, arrangement, parallelLyrics })
    }

    /** Test helper: clear the recorded call log. */
    reset(): void {
        this.calls.length = 0
        this.#health = {
            running: this.#health.running,
            lastFrameAtMs: null,
            framesDelivered: 0,
            framesDropped: 0,
            lastError: null
        }
    }

    /** Test helper: simulate an error from the underlying transport. */
    injectError(message: string): void {
        this.#health.lastError = { at: performance.now(), message }
    }

    #record(method: MockAdapterCall["method"], args: unknown): void {
        this.calls.push({ method, atMs: performance.now(), args })
    }
}
