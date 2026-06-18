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
 *   - We expose a narrow host API:
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
const OPERATOR_CANCEL_LEARN_SONG_CHANNEL = "lyricue:operator:cancel-learn-song"
const OPERATOR_LEARN_SONG_PROGRESS_CHANNEL = "lyricue:operator:learn-song-progress"
const OPERATOR_REHEARSAL_START_CHANNEL = "lyricue:operator:rehearsal-start"
const OPERATOR_REHEARSAL_CHUNK_CHANNEL = "lyricue:operator:rehearsal-chunk"
const OPERATOR_REHEARSAL_STOP_CHANNEL = "lyricue:operator:rehearsal-stop"
const OPERATOR_REHEARSAL_DISCARD_CHANNEL = "lyricue:operator:rehearsal-discard"
const OPERATOR_SETTINGS_GET_CHANNEL = "lyricue:operator:settings:get"
const OPERATOR_SETTINGS_SAVE_CHANNEL = "lyricue:operator:settings:save"
const OPERATOR_IDENTITY_GET_CHANNEL = "lyricue:operator:identity:get"
const OPERATOR_IDENTITY_SAVE_CHANNEL = "lyricue:operator:identity:save"
const OPERATOR_LIBRARY_CONFIG_GET_CHANNEL = "lyricue:operator:library-config:get"
const OPERATOR_LIBRARY_CONFIG_SAVE_CHANNEL = "lyricue:operator:library-config:save"
const OPERATOR_LIBRARY_PUBLISH_CHANNEL = "lyricue:operator:library:publish"
const OPERATOR_LIBRARY_CREDENTIAL_CONFIGURE_CHANNEL = "lyricue:operator:library-credential:configure"
const OPERATOR_LIBRARY_CREDENTIAL_CLEAR_CHANNEL = "lyricue:operator:library-credential:clear"
const OPERATOR_PROJECT_SOURCES_CHANNEL = "lyricue:operator:project:sources"
const OPERATOR_PROJECT_SELECT_LOCAL_CHANNEL = "lyricue:operator:project:select-local"
const OPERATOR_PROJECT_LOAD_CENTRAL_CHANNEL = "lyricue:operator:project:load-central"

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

    cancelLearnSong(request: unknown): Promise<unknown> {
        return ipcRenderer.invoke(OPERATOR_CANCEL_LEARN_SONG_CHANNEL, request)
    },

    subscribeLearnSongProgress(handler: (progress: unknown) => void): () => void {
        const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
            try {
                handler(payload)
            } catch (err) {
                console.error("[lyricue:operator:preload] learn-song progress handler threw:", err)
            }
        }
        ipcRenderer.on(OPERATOR_LEARN_SONG_PROGRESS_CHANNEL, wrapped)
        return () => ipcRenderer.off(OPERATOR_LEARN_SONG_PROGRESS_CHANNEL, wrapped)
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

    getSettings(): Promise<unknown> {
        return ipcRenderer.invoke(OPERATOR_SETTINGS_GET_CHANNEL)
    },

    saveSettings(settings: unknown): Promise<void> {
        return ipcRenderer.invoke(OPERATOR_SETTINGS_SAVE_CHANNEL, settings)
    },

    getIdentity(): Promise<unknown> {
        return ipcRenderer.invoke(OPERATOR_IDENTITY_GET_CHANNEL)
    },

    saveIdentity(identity: unknown): Promise<void> {
        return ipcRenderer.invoke(OPERATOR_IDENTITY_SAVE_CHANNEL, identity)
    },

    getLibraryConfig(): Promise<unknown> {
        return ipcRenderer.invoke(OPERATOR_LIBRARY_CONFIG_GET_CHANNEL)
    },

    saveLibraryConfig(config: unknown): Promise<void> {
        return ipcRenderer.invoke(OPERATOR_LIBRARY_CONFIG_SAVE_CHANNEL, config)
    },

    publishToLibrary(payload: unknown): Promise<unknown> {
        return ipcRenderer.invoke(OPERATOR_LIBRARY_PUBLISH_CHANNEL, payload)
    },

    configurePublishCredential(payload: unknown): Promise<unknown> {
        return ipcRenderer.invoke(OPERATOR_LIBRARY_CREDENTIAL_CONFIGURE_CHANNEL, payload)
    },

    clearPublishCredential(): Promise<unknown> {
        return ipcRenderer.invoke(OPERATOR_LIBRARY_CREDENTIAL_CLEAR_CHANNEL)
    },

    getProjectSources(): Promise<unknown> {
        return ipcRenderer.invoke(OPERATOR_PROJECT_SOURCES_CHANNEL)
    },

    selectLocalProject(project: unknown): Promise<unknown> {
        return ipcRenderer.invoke(OPERATOR_PROJECT_SELECT_LOCAL_CHANNEL, project)
    },

    loadCentralProjectPlan(plan: unknown): Promise<unknown> {
        return ipcRenderer.invoke(OPERATOR_PROJECT_LOAD_CENTRAL_CHANNEL, plan)
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
            cancelLearnSong: (request: unknown) => Promise<unknown>
            subscribeLearnSongProgress: (handler: (progress: unknown) => void) => () => void
            startRehearsalCapture: (request: unknown) => Promise<unknown>
            writeRehearsalChunk: (request: unknown) => Promise<unknown>
            stopRehearsalCapture: () => Promise<unknown>
            discardRehearsalCapture: () => Promise<unknown>
            getSettings: () => Promise<unknown>
            saveSettings: (settings: unknown) => Promise<void>
            getIdentity: () => Promise<unknown>
            saveIdentity: (identity: unknown) => Promise<void>
            getLibraryConfig: () => Promise<unknown>
            saveLibraryConfig: (config: unknown) => Promise<void>
            publishToLibrary: (payload: unknown) => Promise<unknown>
            configurePublishCredential: (payload: unknown) => Promise<unknown>
            clearPublishCredential: () => Promise<unknown>
            getProjectSources: () => Promise<unknown>
            selectLocalProject: (project: unknown) => Promise<unknown>
            loadCentralProjectPlan: (plan: unknown) => Promise<unknown>
            signalReady: () => void
        }
    }
}

export {}
