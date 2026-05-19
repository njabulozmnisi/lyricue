/**
 * Operator-window preload script.
 *
 * Per EP-10 operator UI infrastructure. Mirrors the contextIsolation pattern from
 * `karaoke-output-preload.cts` but with a bidirectional contract:
 *
 *   Main → renderer:  state envelopes (`lyricue:operator:state`) — SyncEngine state
 *                     updates the renderer subscribes to for live UI.
 *   Renderer → main:  command envelopes (`lyricue:operator:command`) — operator
 *                     actions the main process forwards to SyncEngine.dispatch.
 *
 * Security model (per Electron's contextIsolation best practices + NFR2.1):
 *   - The renderer NEVER touches ipcRenderer directly.
 *   - We expose exactly three functions:
 *       subscribeState(handler)  — install a state listener; returns unsubscribe
 *       sendCommand(command)     — fire-and-forget command upstream
 *       signalReady()            — tell main we've mounted (flushes any state buffer)
 *
 * Module format: CJS (.cts → .cjs) so Electron's preload loader accepts it under any
 * "type" setting in the workspace package.json.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports -- preload is CJS by design
const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron")

const OPERATOR_STATE_CHANNEL = "lyricue:operator:state"
const OPERATOR_COMMAND_CHANNEL = "lyricue:operator:command"
const OPERATOR_READY_EVENT = "lyricue:operator:ready"
const OPERATOR_LEARN_SONG_CHANNEL = "lyricue:operator:learn-song"
const OPERATOR_REHEARSAL_START_CHANNEL = "lyricue:operator:rehearsal-start"
const OPERATOR_REHEARSAL_CHUNK_CHANNEL = "lyricue:operator:rehearsal-chunk"
const OPERATOR_REHEARSAL_STOP_CHANNEL = "lyricue:operator:rehearsal-stop"
const OPERATOR_REHEARSAL_DISCARD_CHANNEL = "lyricue:operator:rehearsal-discard"

type StateHandler = (payload: unknown) => void

contextBridge.exposeInMainWorld("lyricueOperator", {
    /**
     * Subscribe to state updates from main. Returns an unsubscribe function — call it
     * on teardown to detach the listener. Defensive: a handler-thrown error doesn't
     * break the IPC bridge.
     */
    subscribeState(handler: StateHandler): () => void {
        const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
            try {
                handler(payload)
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error("[lyricue:operator:preload] state handler threw:", err)
            }
        }
        ipcRenderer.on(OPERATOR_STATE_CHANNEL, wrapped)
        return () => {
            ipcRenderer.off(OPERATOR_STATE_CHANNEL, wrapped)
        }
    },

    /**
     * Fire-and-forget command upstream to the main process. The main process maps
     * commands to SyncEngine.dispatch / settings updates / etc.
     *
     * Command shape (documented in apps/sister/src/main.ts):
     *   { kind: "engageSync" }
     *   { kind: "selectSong"; songId: string }
     *   { kind: "forceTier"; tier: "auto" | "timer" | "manual" }
     *   { kind: "toggleManual" }
     *   { kind: "reEngageSync" }
     *   { kind: "nextSection" }
     *   { kind: "prevSection" }
     *   { kind: "changeDevice"; deviceId: string }
     */
    sendCommand(command: unknown): void {
        ipcRenderer.send(OPERATOR_COMMAND_CHANNEL, command)
    },

    learnSong(request: unknown): Promise<unknown> {
        return ipcRenderer.invoke(OPERATOR_LEARN_SONG_CHANNEL, request)
    },

    startRehearsalCapture(request: unknown): Promise<unknown> {
        return ipcRenderer.invoke(OPERATOR_REHEARSAL_START_CHANNEL, request)
    },

    writeRehearsalChunk(request: unknown): Promise<unknown> {
        return ipcRenderer.invoke(OPERATOR_REHEARSAL_CHUNK_CHANNEL, request)
    },

    stopRehearsalCapture(): Promise<unknown> {
        return ipcRenderer.invoke(OPERATOR_REHEARSAL_STOP_CHANNEL)
    },

    discardRehearsalCapture(): Promise<unknown> {
        return ipcRenderer.invoke(OPERATOR_REHEARSAL_DISCARD_CHANNEL)
    },

    /**
     * Tell main the renderer has mounted. The main process uses this to flush any
     * buffered state envelopes (states emitted before the renderer was ready).
     */
    signalReady(): void {
        ipcRenderer.send(OPERATOR_READY_EVENT)
    }
})

declare global {
    interface Window {
        lyricueOperator: {
            subscribeState: (handler: StateHandler) => () => void
            sendCommand: (command: unknown) => void
            learnSong: (request: unknown) => Promise<unknown>
            startRehearsalCapture: (request: unknown) => Promise<unknown>
            writeRehearsalChunk: (request: unknown) => Promise<unknown>
            stopRehearsalCapture: () => Promise<unknown>
            discardRehearsalCapture: () => Promise<unknown>
            signalReady: () => void
        }
    }
}

export {}
