/**
 * ForkOutputAdapter — the OutputAdapter implementation for fork mode.
 *
 * Per architecture.md §4.9 and §7.2:
 *   - Sends SyncFrames and LoadMapPayloads over FreeShow's existing OUTPUT IPC channel,
 *     namespaced under `LC_SYNC_FRAME` and `LC_LOAD_MAP` sub-channels.
 *   - Renders inside a FreeShow output BrowserWindow that has been marked with
 *     `karaokeMode: true`. The patch in MainOutput.svelte (apps/fork/freeshow/src/frontend/MainOutput.svelte)
 *     mounts our `KaraokeOutput.svelte` component when that flag is set.
 *
 * STORY-02.2 scope:
 *   - Implement the OutputAdapter contract.
 *   - Drop frames safely if no FreeShow output window with `karaokeMode: true` is open.
 *   - Track AdapterHealth.
 *
 * Out of scope (later epics):
 *   - SE → adapter wiring (EP-09 — SE wires this in once it exists).
 *   - Multi-output (more than one karaoke output simultaneously). Currently broadcasts to
 *     whichever karaoke output exists; SE may emit per-outputId frames in EP-09.
 */

import type { BrowserWindow } from "electron"
import { LC_LOAD_MAP, LC_SYNC_FRAME } from "@lyricue/core/output"
import type {
    AdapterHealth,
    OutputAdapter,
    OutputAdapterMode,
    OutputAdapterStartOptions,
    SyncFrame
} from "@lyricue/core/output"
import type { Arrangement, ParallelLyricsTrack, TimingMap } from "@lyricue/core/types"

/**
 * The OUTPUT channel constant from FreeShow's types. Kept as a string literal here so
 * this adapter doesn't import directly from FreeShow's source — that import would
 * create a circular dependency since FreeShow imports from `@lyricue/fork`.
 *
 * If FreeShow ever renames the channel, this constant needs updating; the patches in
 * `apps/fork/freeshow/src/types/Channels.ts` are the single source of truth.
 */
const FREESHOW_OUTPUT_CHANNEL = "OUTPUT"

interface MutableHealth {
    running: boolean
    lastFrameAtMs: number | null
    framesDelivered: number
    framesDropped: number
    lastError: { at: number; message: string } | null
}

export interface ForkOutputAdapterOptions {
    /**
     * Function that returns the current set of FreeShow output BrowserWindows tagged with
     * karaokeMode. Provided by the bootstrap layer (initLyriCueMain) so this adapter
     * stays decoupled from FreeShow's OutputHelper internals.
     */
    getKaraokeWindows: () => BrowserWindow[]
}

export class ForkOutputAdapter implements OutputAdapter {
    readonly mode: OutputAdapterMode = "fork"

    #health: MutableHealth = {
        running: false,
        lastFrameAtMs: null,
        framesDelivered: 0,
        framesDropped: 0,
        lastError: null
    }
    #outputId: string | null = null
    #getKaraokeWindows: () => BrowserWindow[]

    constructor(opts: ForkOutputAdapterOptions) {
        this.#getKaraokeWindows = opts.getKaraokeWindows
    }

    get health(): AdapterHealth {
        return Object.freeze({ ...this.#health })
    }

    async start(opts: OutputAdapterStartOptions): Promise<void> {
        // In fork mode, the BrowserWindow is owned by FreeShow's OutputHelper. We don't
        // create or destroy windows here — we just record which outputId we're driving.
        this.#outputId = opts.outputId
        this.#health.running = true
    }

    async stop(): Promise<void> {
        this.#outputId = null
        this.#health.running = false
    }

    pushSyncFrame(frame: SyncFrame): void {
        if (!this.#health.running) {
            this.#health.framesDropped++
            return
        }
        try {
            const windows = this.#getKaraokeWindows()
            if (windows.length === 0) {
                this.#health.framesDropped++
                return
            }
            for (const w of windows) {
                if (w.isDestroyed()) continue
                w.webContents.send(FREESHOW_OUTPUT_CHANNEL, { channel: LC_SYNC_FRAME, data: frame })
            }
            this.#health.framesDelivered++
            this.#health.lastFrameAtMs = performance.now()
            this.#health.lastError = null
        } catch (err) {
            // Per OutputAdapter contract: never throw from pushSyncFrame. Live worship
            // cannot pause for an exception. Record and drop.
            this.#health.framesDropped++
            this.#health.lastError = {
                at: performance.now(),
                message: (err as Error).message || String(err)
            }
        }
    }

    loadTimingMap(
        map: TimingMap,
        arrangement: Arrangement | null,
        parallelLyrics?: ParallelLyricsTrack[]
    ): void {
        if (!this.#outputId) return
        try {
            const windows = this.#getKaraokeWindows()
            // Build the payload conditionally so `parallelLyrics` is omitted when undefined,
            // matching the LoadMapPayload contract under exactOptionalPropertyTypes.
            const payload = parallelLyrics
                ? { outputId: this.#outputId, showId: map.showId, timingMap: map, arrangement, parallelLyrics }
                : { outputId: this.#outputId, showId: map.showId, timingMap: map, arrangement }
            for (const w of windows) {
                if (w.isDestroyed()) continue
                w.webContents.send(FREESHOW_OUTPUT_CHANNEL, { channel: LC_LOAD_MAP, data: payload })
            }
        } catch (err) {
            this.#health.lastError = {
                at: performance.now(),
                message: (err as Error).message || String(err)
            }
        }
    }
}
