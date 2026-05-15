/**
 * Production `BrowserWindowFactory` backed by Electron's real `BrowserWindow`.
 *
 * Kept in a separate module from `OwnWindowOutputAdapter` so the adapter can be tested
 * in plain Node.js Vitest without an Electron runtime. Tests pass a stub factory; only
 * the sister-mode Electron entry imports this file.
 *
 * Visual config matches FreeShow's `outputOptions` so karaoke windows in sister mode
 * look identical to fork-mode windows from the projector's perspective:
 * transparent + frameless + alwaysOnTop, no taskbar entry, no shadow, no auto-show
 * (we `showInactive()` after load to avoid stealing focus from the operator's main window).
 */

import { BrowserWindow, ipcMain, type BrowserWindowConstructorOptions } from "electron"
import { OWN_WINDOW_READY_EVENT, type BrowserWindowFactory, type ManagedWindow } from "./OwnWindowOutputAdapter.js"

/**
 * Create the production factory. Each invocation of the returned factory function
 * constructs a fresh `BrowserWindow` for the given options.
 */
export function createElectronBrowserWindowFactory(): BrowserWindowFactory {
    return async ({ bounds, rendererHtmlPath, preloadPath, outputId }) => {
        const windowOpts: BrowserWindowConstructorOptions = {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            backgroundColor: "#000000",
            transparent: true,
            frame: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            hasShadow: false,
            show: false,
            webPreferences: {
                contextIsolation: true,
                backgroundThrottling: false,
                autoplayPolicy: "no-user-gesture-required",
                // Preload is the only IPC bridge the renderer is allowed; without one,
                // the Svelte component can't subscribe to SyncFrames. See preload.ts.
                ...(preloadPath ? { preload: preloadPath } : {})
            }
        }

        let win: BrowserWindow
        try {
            win = new BrowserWindow(windowOpts)
        } catch (err) {
            // BrowserWindow construction can fail if Electron isn't ready, the bounds are
            // invalid, or the GPU process is unavailable. Surface as a null return so the
            // adapter records lastError rather than throwing.
            console.error("[lyricue:sister] BrowserWindow construction failed:", err)
            return null
        }

        win.setSkipTaskbar(true)
        win.once("ready-to-show", () => {
            // Show without stealing focus from the operator's main app.
            if (!win.isDestroyed()) win.showInactive()
        })

        // Dev-mode affordances. STORY-02.5 (diagnostics panel) will move these behind
        // a settings toggle; until then, env vars gate the noise:
        //   LC_OPEN_DEVTOOLS=1  — open the renderer's DevTools at startup.
        //   LC_VERBOSE=1        — also forward all renderer console messages + lifecycle
        //                         events (dom-ready, did-finish-load) to stderr.
        // Errors (preload-error, did-fail-load) are ALWAYS forwarded since a production
        // failure that's silent is worse than one we can grep for.
        if (process.env.LC_OPEN_DEVTOOLS === "1") {
            win.webContents.openDevTools({ mode: "detach" })
        }

        if (process.env.LC_VERBOSE === "1") {
            // Electron 37 introduced an event-object form for console-message; the older
            // 5-arg form is deprecated. We use the new form here. Older Electron
            // versions (we target ≥28) still pass the legacy args alongside; both work.
            win.webContents.on("console-message", (event: Electron.WebContentsConsoleMessageEventParams) => {
                const levelName = event.level ?? "log"
                const where = event.sourceId ? ` (${event.sourceId}:${event.lineNumber})` : ""
                process.stderr.write(`[lyricue:sister:renderer:${levelName}] ${event.message}${where}\n`)
            })
            win.webContents.on("did-finish-load", () => {
                process.stderr.write("[lyricue:sister:did-finish-load]\n")
            })
            win.webContents.on("dom-ready", () => {
                process.stderr.write("[lyricue:sister:dom-ready]\n")
            })
        }

        // Always-on error surfacing. Preload-load failures and did-fail-load mean the
        // karaoke window is broken; the operator needs to know immediately.
        win.webContents.on("preload-error", (_event, preloadPath, error) => {
            process.stderr.write(
                `[lyricue:sister:preload-error] ${preloadPath}: ${error.message}\n${error.stack ?? ""}\n`
            )
        })
        win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
            // Ignore the spurious "no Internet" code that fires when Electron loads a file://
            // URL with a relative resource; only the meaningful error codes warrant logging.
            if (errorCode === -3) return // ERR_ABORTED is benign during navigation
            process.stderr.write(
                `[lyricue:sister:did-fail-load] code=${errorCode} url=${validatedURL} msg=${errorDescription}\n`
            )
        })

        // Install the renderer-ready latch BEFORE the load starts. The renderer can
        // (and does, under fast hardware) fire its signalReady() call before the
        // `await win.loadFile(...)` below resolves; if we waited until after the load
        // to subscribe, the ready signal would be lost and the adapter would buffer
        // frames forever. The latch records the ready event whenever it arrives and
        // replays it to handlers registered later via `onRendererReady`.
        const readyLatch = makeReadyLatch(win)

        // Load the renderer HTML. We pass the outputId via the URL hash so the renderer
        // bootstrap can resolve it via window.location.hash (D10 carry-forward from the
        // M1-partial QA pass). The hash is the only out-of-band channel that's available
        // before the preload's IPC bridge is wired and the first LC_LOAD_MAP envelope arrives.
        //
        // Failures are surfaced via the ManagedWindow handle — we still return the
        // window so the adapter can record the error and the user sees a clear
        // "blank window" rather than a crash.
        try {
            await win.loadFile(rendererHtmlPath, { hash: `out=${encodeURIComponent(outputId)}` })
        } catch (err) {
            console.error(`[lyricue:sister] Failed to load renderer at ${rendererHtmlPath}:`, err)
            // Don't destroy the window — the adapter expects a handle back. The window
            // is visible but empty, which is the right diagnostic state.
        }

        return wrap(win, readyLatch)
    }
}

/**
 * Per-window ready latch. Installs an `ipcMain` listener that filters by the originating
 * webContents and remembers whether `signalReady` has fired. Consumers register handlers
 * via the returned `subscribe` function; handlers registered before ready get notified
 * when ready arrives, and handlers registered after ready get notified immediately.
 *
 * Cleaned up when the window is destroyed.
 */
interface ReadyLatch {
    subscribe(handler: () => void): () => void
}

function makeReadyLatch(win: BrowserWindow): ReadyLatch {
    let readyReceived = false
    const pendingHandlers: Array<() => void> = []

    const latchListener = (event: Electron.IpcMainEvent) => {
        if (event.sender !== win.webContents) return
        readyReceived = true
        for (const h of pendingHandlers.splice(0)) {
            try {
                h()
            } catch (err) {
                console.error("[lyricue:sister] onRendererReady handler threw:", err)
            }
        }
    }
    ipcMain.on(OWN_WINDOW_READY_EVENT, latchListener)

    win.once("closed", () => {
        ipcMain.off(OWN_WINDOW_READY_EVENT, latchListener)
        pendingHandlers.length = 0
    })

    return {
        subscribe(handler) {
            if (readyReceived) {
                handler()
                return () => undefined
            }
            pendingHandlers.push(handler)
            return () => {
                const idx = pendingHandlers.indexOf(handler)
                if (idx !== -1) pendingHandlers.splice(idx, 1)
            }
        }
    }
}

/**
 * Adapt Electron's BrowserWindow to the `ManagedWindow` shape the adapter expects.
 * Each subscription returns an unsubscribe handle so the adapter can clean up cleanly
 * on stop() without leaking listeners.
 */
function wrap(win: BrowserWindow, readyLatch: ReadyLatch): ManagedWindow {
    return {
        isDestroyed: () => win.isDestroyed(),
        send: (channel, payload) => {
            if (!win.isDestroyed()) win.webContents.send(channel, payload)
        },
        onRendererReady: (handler) => readyLatch.subscribe(handler),
        onClosed: (handler) => {
            win.on("closed", handler)
            return () => {
                // BrowserWindow doesn't expose .off for "closed" reliably in all Electron
                // versions; removeListener is the portable form.
                try {
                    win.removeListener("closed", handler)
                } catch {
                    // Already destroyed — listener is irrelevant.
                }
            }
        },
        close: () => {
            if (!win.isDestroyed()) win.close()
        }
    }
}
