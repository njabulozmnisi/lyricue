/**
 * OwnWindowOutputAdapter — the OutputAdapter implementation for sister-service mode.
 *
 * Per architecture.md §4.9 ("variant 2") and EP-02 STORY-02.3.
 *
 * Owns its own Electron BrowserWindow positioned on the projector. SyncFrames flow via
 * Electron's built-in IPC channel (webContents.send) inside LyriCue's process tree.
 * KaraokeOutput.svelte (the identical component used in fork mode) is mounted inside
 * the window — proving the component is mode-agnostic.
 *
 * Differences vs. ForkOutputAdapter:
 *   - Owns the BrowserWindow lifecycle (create / destroy here, not in FreeShow).
 *   - Renders into a LyriCue-controlled HTML entry, not FreeShow's index.html.
 *   - No multi-mode dispatch — every window is a karaoke window.
 *
 * Same OutputAdapter contract — never throws from pushSyncFrame (NFR2.1 zero-crash).
 *
 * Testability: this class does NOT import directly from `electron`. The Electron-specific
 * BrowserWindow creation is behind a `BrowserWindowFactory` interface that tests can
 * stub. Production code injects the real Electron-backed factory at construction time
 * (see `createElectronBrowserWindowFactory` below).
 */

import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { EventEmitter } from "node:events"
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
 * Internal channel discriminator on the renderer's IPC link. Matches the wire shape used
 * in fork mode: the renderer receives messages on a single channel, then dispatches by
 * the `channel` field on the payload.
 *
 * In sister mode we have only one window per adapter so we *could* use distinct channels.
 * Using the same envelope-style shape lets KaraokeOutput.svelte parse identical payloads
 * regardless of which mode booted it.
 */
export const OWN_WINDOW_CHANNEL = "lyricue:output" as const

/**
 * The sub-event the renderer fires (via contextBridge → ipcRenderer.send) once the
 * Svelte mount is complete and ready to receive frames. The adapter waits for this
 * before forwarding frames; frames pushed before this arrives are buffered.
 */
export const OWN_WINDOW_READY_EVENT = `${OWN_WINDOW_CHANNEL}:ready` as const

/**
 * Buffer cap for frames received before the renderer signals ready. 1 second @ 60 Hz is
 * a sane upper bound — if the renderer takes longer than that to mount we have bigger
 * problems and dropping older frames is the safer behaviour (newer frames are more
 * relevant to where the song actually is).
 */
const PENDING_FRAME_BUFFER_CAP = 60

/**
 * Default visual config — matches FreeShow's `outputOptions` (architecture.md §4.4 ref).
 * Sister-mode windows look identical to fork-mode windows from the projector's perspective.
 */
const DEFAULT_BOUNDS = { x: 0, y: 0, width: 1280, height: 720 }

/**
 * The minimal slice of Electron's BrowserWindow shape that the adapter uses. Extracting
 * this lets tests provide stubs without importing `electron`.
 */
export interface ManagedWindow {
    isDestroyed(): boolean
    send(channel: string, payload: unknown): void
    /** Subscribe to the per-window "renderer ready" event. Returns an unsubscribe handle. */
    onRendererReady(handler: () => void): () => void
    /** Subscribe to the OS-level window-closed event. Returns an unsubscribe handle. */
    onClosed(handler: () => void): () => void
    /** Close the window. Idempotent; should not throw if already closed. */
    close(): void
}

export interface BrowserWindowFactoryOptions {
    outputId: string
    bounds: { x: number; y: number; width: number; height: number }
    /** Absolute path to the HTML file to load in the window. */
    rendererHtmlPath: string
    /** Absolute path to a preload script. Optional. */
    preloadPath?: string
}

/**
 * Factory contract: create a window and synchronously return the management handle.
 * The factory is async because `loadFile()` is async in real Electron.
 *
 * Returns null when the window cannot be created (e.g., the renderer HTML is missing,
 * Electron is not initialised). The adapter treats null as a start() failure and
 * records lastError accordingly.
 */
export type BrowserWindowFactory = (opts: BrowserWindowFactoryOptions) => Promise<ManagedWindow | null>

export interface OwnWindowOutputAdapterOptions {
    /**
     * Factory that creates the underlying window. Production code passes a factory backed
     * by Electron's `BrowserWindow` (see `createElectronBrowserWindowFactory`). Tests pass
     * a stub.
     */
    factory: BrowserWindowFactory

    /**
     * Absolute path to the HTML file the BrowserWindow loads. Defaults to the renderer
     * shipped with apps/sister (resolved relative to this module). Override in tests.
     */
    rendererHtmlPath?: string

    /**
     * Absolute path to the preload script. Optional — when undefined no preload is configured.
     */
    preloadPath?: string

    /**
     * Hook fired when the BrowserWindow is closed by the OS (e.g. user clicked the close
     * button). Upstream code (the sister-mode app shell) can listen and re-spawn or
     * surface a notification.
     */
    onWindowClosed?: () => void
}

interface MutableHealth {
    running: boolean
    lastFrameAtMs: number | null
    framesDelivered: number
    framesDropped: number
    lastError: { at: number; message: string } | null
}

export class OwnWindowOutputAdapter extends EventEmitter implements OutputAdapter {
    readonly mode: OutputAdapterMode = "own-window"

    #health: MutableHealth = {
        running: false,
        lastFrameAtMs: null,
        framesDelivered: 0,
        framesDropped: 0,
        lastError: null
    }
    #window: ManagedWindow | null = null
    #unsubReady: (() => void) | null = null
    #unsubClosed: (() => void) | null = null
    #outputId: string | null = null
    #opts: OwnWindowOutputAdapterOptions
    /** Frames received before the renderer is ready are buffered up to PENDING_FRAME_BUFFER_CAP. */
    #pendingFrames: SyncFrame[] = []
    /**
     * The most recent LC_LOAD_MAP payload received before the renderer signalled ready.
     *
     * Closes M1-close D11. The adapter previously sent LC_LOAD_MAP immediately on every
     * `loadTimingMap()` call, which races with the renderer bootstrap: under slower
     * bundle loads the envelope arrives at the bridge dispatcher before the Svelte
     * component has installed its envelopeHandler, and the load-map is silently dropped.
     *
     * We now hold the latest payload here until the ready event fires, then send it
     * BEFORE flushing buffered frames so the renderer can resolve `slideIndex` correctly
     * against the freshly-loaded map. Only the latest map is retained — earlier maps are
     * superseded by definition (the SE loads one map at a time per show change).
     */
    #pendingLoadMap:
        | { map: TimingMap; arrangement: Arrangement | null; parallelLyrics?: ParallelLyricsTrack[] }
        | null = null
    #rendererReady = false

    constructor(opts: OwnWindowOutputAdapterOptions) {
        super()
        this.#opts = opts
    }

    get health(): AdapterHealth {
        return Object.freeze({ ...this.#health })
    }

    async start(opts: OutputAdapterStartOptions): Promise<void> {
        if (this.#window) return // idempotent

        this.#outputId = opts.outputId
        const bounds = opts.bounds ?? DEFAULT_BOUNDS
        const rendererHtmlPath = this.#opts.rendererHtmlPath ?? defaultRendererHtmlPath()

        let win: ManagedWindow | null
        try {
            win = await this.#opts.factory({
                outputId: opts.outputId,
                bounds,
                rendererHtmlPath,
                ...(this.#opts.preloadPath ? { preloadPath: this.#opts.preloadPath } : {})
            })
        } catch (err) {
            this.#health.lastError = {
                at: performance.now(),
                message: `factory threw: ${(err as Error).message || String(err)}`
            }
            return
        }

        if (!win) {
            this.#health.lastError = {
                at: performance.now(),
                message: "factory returned null"
            }
            return
        }

        this.#window = win
        this.#unsubReady = win.onRendererReady(() => this.#onRendererReady())
        this.#unsubClosed = win.onClosed(() => this.#onWindowClosed())
        this.#health.running = true
    }

    async stop(): Promise<void> {
        if (!this.#window) {
            this.#health.running = false
            return
        }
        const w = this.#window
        // Detach our listeners so close → adapterClosed event doesn't fire from a stop().
        this.#unsubReady?.()
        this.#unsubClosed?.()
        this.#unsubReady = null
        this.#unsubClosed = null
        this.#window = null
        this.#health.running = false
        this.#rendererReady = false
        this.#pendingFrames.length = 0
        this.#pendingLoadMap = null
        if (!w.isDestroyed()) {
            try {
                w.close()
            } catch {
                // Closing a window that's mid-teardown can throw on some platforms;
                // adapter contract is no-throw from stop(), so swallow silently.
            }
        }
    }

    pushSyncFrame(frame: SyncFrame): void {
        if (!this.#health.running || !this.#window || this.#window.isDestroyed()) {
            this.#health.framesDropped++
            return
        }
        try {
            if (!this.#rendererReady) {
                // Buffer up to PENDING_FRAME_BUFFER_CAP. Beyond that, drop the oldest so we
                // preserve the most recent state (the song has moved on; old frames are stale).
                if (this.#pendingFrames.length >= PENDING_FRAME_BUFFER_CAP) {
                    this.#pendingFrames.shift()
                    this.#health.framesDropped++
                }
                this.#pendingFrames.push(frame)
                return
            }
            this.#window.send(OWN_WINDOW_CHANNEL, { channel: LC_SYNC_FRAME, data: frame })
            this.#health.framesDelivered++
            this.#health.lastFrameAtMs = performance.now()
            this.#health.lastError = null
        } catch (err) {
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
        // Always buffer the latest map — even before start() — so callers that wire
        // load-then-start (the natural order during composition / E2E setup) don't
        // silently lose the map. The buffer is flushed at the next #onRendererReady().
        // If the window is gone (post-stop, destroyed externally) we record lastError
        // so the operator can see the misuse via the diagnostics panel.
        if (this.#window && this.#window.isDestroyed()) {
            this.#health.lastError = {
                at: performance.now(),
                message: "loadTimingMap called after the output window was destroyed"
            }
            return
        }

        // D11 — defer the send until the renderer is ready. We buffer the constituents
        // (not the baked envelope) so the flush can rebuild with the live outputId,
        // which is unknown before start().
        if (!this.#window || !this.#rendererReady) {
            this.#pendingLoadMap = parallelLyrics
                ? { map, arrangement, parallelLyrics }
                : { map, arrangement }
            return
        }
        try {
            this.#window.send(OWN_WINDOW_CHANNEL, this.#buildLoadMapEnvelope(map, arrangement, parallelLyrics))
        } catch (err) {
            this.#health.lastError = {
                at: performance.now(),
                message: (err as Error).message || String(err)
            }
        }
    }

    #buildLoadMapEnvelope(
        map: TimingMap,
        arrangement: Arrangement | null,
        parallelLyrics?: ParallelLyricsTrack[]
    ): { channel: typeof LC_LOAD_MAP; data: unknown } {
        const payload = parallelLyrics
            ? { outputId: this.#outputId, showId: map.showId, timingMap: map, arrangement, parallelLyrics }
            : { outputId: this.#outputId, showId: map.showId, timingMap: map, arrangement }
        return { channel: LC_LOAD_MAP, data: payload }
    }

    /**
     * Called when the renderer fires the ready event. Flushes any buffered frames in the
     * order they were received. Safe to call multiple times (re-mount scenarios in the
     * future); subsequent calls are no-ops because the buffer is drained.
     */
    #onRendererReady(): void {
        this.#rendererReady = true
        if (!this.#window) return

        // D11 — flush the pending LC_LOAD_MAP first. Frames are meaningless without the
        // map (cursor can't resolve a section), so the order matters: map → frames.
        if (this.#pendingLoadMap !== null) {
            const pending = this.#pendingLoadMap
            this.#pendingLoadMap = null
            try {
                this.#window.send(
                    OWN_WINDOW_CHANNEL,
                    this.#buildLoadMapEnvelope(pending.map, pending.arrangement, pending.parallelLyrics)
                )
            } catch (err) {
                this.#health.lastError = {
                    at: performance.now(),
                    message: (err as Error).message || String(err)
                }
                // Don't bail — buffered frames still flush below. The renderer will get
                // the frames but stay on its placeholder until the next loadTimingMap retries.
            }
        }

        if (this.#pendingFrames.length === 0) return
        const buffered = this.#pendingFrames
        this.#pendingFrames = []
        for (const frame of buffered) {
            try {
                this.#window.send(OWN_WINDOW_CHANNEL, { channel: LC_SYNC_FRAME, data: frame })
                this.#health.framesDelivered++
                this.#health.lastFrameAtMs = performance.now()
            } catch (err) {
                // A single failure during flush shouldn't lose every remaining buffered frame.
                // Count it, record the last error, but keep going.
                this.#health.framesDropped++
                this.#health.lastError = {
                    at: performance.now(),
                    message: (err as Error).message || String(err)
                }
            }
        }
    }

    /**
     * Called when the OS-level window-closed event fires (user closed the window, OS
     * destroyed it, etc.). Resets internal state and emits the `adapterClosed` event so
     * upstream code can re-spawn or warn the operator.
     *
     * Idempotent: some Electron versions re-fire 'closed' during app-shutdown teardown.
     * The first call performs the reset and emits; subsequent calls return early so the
     * operator's onClosed observer doesn't double-fire (which previously caused
     * upstream re-spawn logic to attempt a second re-spawn).
     */
    #onWindowClosed(): void {
        if (this.#window === null && !this.#health.running) return // already torn down
        this.#window = null
        this.#unsubReady = null
        this.#unsubClosed = null
        this.#health.running = false
        this.#rendererReady = false
        this.#pendingFrames.length = 0
        this.#pendingLoadMap = null
        this.emit("adapterClosed")
        this.#opts.onWindowClosed?.()
    }
}

/**
 * Default HTML location: <package-root>/public/karaoke-output.html, resolved relative
 * to this compiled module. We use import.meta.url so the path is correct regardless
 * of whether the code is run from source or from dist.
 */
function defaultRendererHtmlPath(): string {
    const here = dirname(fileURLToPath(import.meta.url))
    // dist-electron/output/ → ../../public/karaoke-output.html
    return join(here, "..", "..", "public", "karaoke-output.html")
}
