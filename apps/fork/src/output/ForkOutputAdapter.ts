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
    /**
     * The most recent LC_LOAD_MAP envelope buffered when no karaoke window was available.
     *
     * Closes M1-close D11 (the fork-mode side). If `loadTimingMap()` is called before
     * any FreeShow output has been opened with `karaokeMode: true`, we hold the envelope
     * here. `pushSyncFrame` is the next opportunity to detect that a window has appeared;
     * when it does, we flush the load-map BEFORE delivering the frame so the renderer can
     * resolve the cursor against the loaded map.
     *
     * Only the latest payload is retained — earlier maps are superseded by definition.
     */
    #pendingLoadMap: { channel: typeof LC_LOAD_MAP; data: unknown } | null = null

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
        this.#pendingLoadMap = null
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
            // D11 — if a load-map was buffered before any karaoke window existed, flush
            // it now (before the frame) so the renderer can resolve `slideIndex` against
            // the loaded map. Map first, then frame.
            this.#flushPendingLoadMap(windows)
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
        // Build the payload conditionally so `parallelLyrics` is omitted when undefined,
        // matching the LoadMapPayload contract under exactOptionalPropertyTypes.
        const payload = parallelLyrics
            ? { outputId: this.#outputId, showId: map.showId, timingMap: map, arrangement, parallelLyrics }
            : { outputId: this.#outputId, showId: map.showId, timingMap: map, arrangement }
        const envelope = { channel: LC_LOAD_MAP, data: payload }

        try {
            const windows = this.#getKaraokeWindows()
            // D11 — if no karaoke window exists yet (e.g., FreeShow's output hasn't been
            // opened in karaoke mode), buffer the envelope. The next pushSyncFrame call
            // will flush it once a window is available. Without this, the load-map was
            // silently dropped and the renderer would stay on its waiting placeholder.
            if (windows.length === 0) {
                this.#pendingLoadMap = envelope
                return
            }
            for (const w of windows) {
                if (w.isDestroyed()) continue
                w.webContents.send(FREESHOW_OUTPUT_CHANNEL, envelope)
            }
            // A fresh load-map supersedes any earlier buffered one.
            this.#pendingLoadMap = null
        } catch (err) {
            this.#health.lastError = {
                at: performance.now(),
                message: (err as Error).message || String(err)
            }
        }
    }

    #flushPendingLoadMap(windows: BrowserWindow[]): void {
        if (this.#pendingLoadMap === null) return
        const envelope = this.#pendingLoadMap
        this.#pendingLoadMap = null
        for (const w of windows) {
            if (w.isDestroyed()) continue
            try {
                w.webContents.send(FREESHOW_OUTPUT_CHANNEL, envelope)
            } catch (err) {
                // Don't bail the whole flush — record and keep going so other windows
                // (if any) still receive the map.
                this.#health.lastError = {
                    at: performance.now(),
                    message: (err as Error).message || String(err)
                }
            }
        }
    }
}
