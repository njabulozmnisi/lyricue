/**
 * LyriCue sister-mode Electron main entry.
 *
 * Per architecture.md ADR-16 and EP-02 STORY-02.3 / STORY-02.4.
 *
 * Sister mode is a standalone Electron app — no FreeShow embedding. The app's job is to:
 *   1. Open one or more karaoke output BrowserWindows via OwnWindowOutputAdapter.
 *   2. Run the LyriCue sync engine in the main process (when present — EP-09).
 *   3. Drive FreeShow externally via its public APIs (REST + WebSocket) for non-karaoke
 *      content (post-MVP; not in STORY-02.3).
 *
 * STORY-02.3 / STORY-02.4 scope:
 *   - Wire up the Electron app lifecycle.
 *   - Open one karaoke output window using the production BrowserWindowFactory.
 *   - When LC_DEMO_MODE=1, drive the adapter with the DemoSyncEngine + DEMO_TIMING_MAP
 *     (the walking-skeleton runner) so STORY-02.4 AC1+AC3 can be observed visually.
 *   - When LC_DEMO_MODE is unset, the adapter starts idle. EP-09 will eventually push
 *     real frames here once the Sync Engine is wired up.
 *
 * Out of scope here:
 *   - Real audio capture, sync engine, library manager — EP-04..EP-13.
 *   - First-run wizard / settings tab — those land in the operator's main control
 *     window which is a separate Electron window (EP-04 STORY-04.x onwards).
 *
 * Env-var gates:
 *   - LC_DEPLOYMENT_MODE — must be "sister" or the app refuses to start.
 *   - LC_DEMO_MODE       — when "1", drives the karaoke window with DemoSyncEngine.
 *                          Default is no demo stream (operator must start sync explicitly).
 *   - LC_VERBOSE         — forwards renderer console + lifecycle events to stderr.
 *   - LC_OPEN_DEVTOOLS   — opens the karaoke output's DevTools at startup.
 *
 * Diagnostic logging: every startup-relevant action writes a single-line probe to
 * stderr (Electron's `console.info` is swallowed in many shells). Once STORY-02.5
 * builds the in-app diagnostics panel, these stderr probes become redundant for the
 * operator but stay useful for headless verification and CI.
 */

import { app, BrowserWindow, ipcMain } from "electron"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { basename, dirname, resolve, join } from "node:path"
import { DEPLOYMENT_MODE, validateTimingMap, type Arrangement, type TimingMap } from "@lyricue/core/types"
import { resolveLyriCuePaths } from "@lyricue/core/settings"
import { TimingMapStorage, type TimingMapStorageVariant } from "@lyricue/core/timing"
import { DEMO_TIMING_MAP, DemoSyncEngine, generateFrameSequence } from "@lyricue/core/output/test-utils"
import {
    createDiagnosticsObserver,
    type DiagnosticsObserverState,
    type DiagnosticsSnapshot
} from "@lyricue/core/diagnostics"
import {
    createSyncEngine,
    findNextSlideStart,
    findPrevSlideStart,
    type SyncEngine,
    type SyncEngineState,
    type SyncTier
} from "@lyricue/core/sync"
import {
    createSetlistController,
    ProjectStorage,
    type Project,
    type SetlistController,
    type TimingMapVariant
} from "@lyricue/core/setlist"
import { buildRehearsalTimingMapVariant, createRehearsalCaptureSession, createWavChunkWriter, type RehearsalCaptureSession } from "@lyricue/core/rehearsal"
import {
    SidecarController,
    loadModelManifestFile,
    nodePythonResolver,
    nodeSidecarSpawner,
    resolveSidecarLaunch,
    type ModelManifest,
    type SidecarControllerOptions
} from "@lyricue/core/sidecar"
import { OwnWindowOutputAdapter } from "./output/OwnWindowOutputAdapter.js"
import { createElectronBrowserWindowFactory } from "./output/electron-browser-window-factory.js"
import { createSyntheticAudioDriver, type SyntheticAudioDriver } from "./audio/synthetic-audio-driver.js"
import { withRequiredModelSpecs } from "./model-manifest.js"
import { resolveOperatorModelManifestStatus } from "./model-manifest-status.js"
import { learnSongTimeoutMs, resolveSourceSidecarPythonOverride } from "./learn-song-sidecar-options.js"
import { sidecarResolverNodeEnv } from "./sidecar-runtime.js"
import { prepareOperatorArrangementSave } from "./operator-arrangements.js"
import { prepareOperatorTranslationSave } from "./operator-translations.js"

// Fail fast if launched with the wrong mode. The fork-mode entry has the same guard;
// this prevents a misconfigured build from silently doing the wrong thing.
if (DEPLOYMENT_MODE !== "sister") {
    console.error(
        `[lyricue:sister] Refusing to start: LC_DEPLOYMENT_MODE is "${DEPLOYMENT_MODE}", expected "sister". ` +
            `Build with LC_DEPLOYMENT_MODE=sister, or use the fork-mode entry instead.`
    )
    process.exit(1)
}

const DEMO_MODE = process.env.LC_DEMO_MODE === "1"
const RENDERER_PERF_MODE = process.env.LC_RENDERER_PERF_MODE === "1"
const MODEL_MANIFEST_PATH = process.env.LC_MODEL_MANIFEST_PATH
const MODEL_MIRROR_URL = process.env.LC_MODEL_MIRROR_URL
const REQUIRE_MODEL_MANIFEST = process.env.LC_REQUIRE_MODEL_MANIFEST === "1"
const SOURCE_SIDECAR_PYTHON = process.env.LC_SIDECAR_PYTHON
const SMOKE_TEST_MODE = process.env.LC_SMOKE_TEST === "1"
/**
 * End-to-end mode (LC_E2E_MODE=1). Replaces DemoSyncEngine with the real composition:
 *   SyntheticAudioDriver (BpmEstimator + VadDetector) → SyncEngine → OutputAdapter.
 *
 * This proves the full EP-07 + EP-08.1 + EP-09 + EP-06 + EP-02 stack composes correctly
 * end-to-end. The renderer sees frames produced by the real Sync Engine (not the demo
 * walker), driven by synthetic 120-BPM features.
 *
 * Mutually exclusive with LC_DEMO_MODE for clarity. If both are set, e2e takes priority.
 */
const E2E_MODE = process.env.LC_E2E_MODE === "1"

/**
 * Single-line stderr logger. Electron's main-process `console.info` is unreliable across
 * shells / packaged builds, but stderr is always observable via `electron > log.txt 2>&1`.
 * Standardising on this for STORY-02.3 verification keeps the probe surface tight.
 */
function log(line: string): void {
    process.stderr.write(`[lyricue:sister] ${line}\n`)
}

function recordSmokeFailure(label: string, err?: unknown): void {
    const message = err instanceof Error ? `${label}: ${err.message}` : err ? `${label}: ${String(err)}` : label
    smokeFailures.push(message)
    log(`[smoke] FAIL ${message}`)
}

/**
 * Resolve the renderer HTML + preload paths relative to this compiled module.
 *
 * Layout when built:
 *   apps/sister/dist-electron/main.js                                    (this file)
 *   apps/sister/dist-electron/preload/karaoke-output-preload.cjs         (CJS preload)
 *   apps/sister/public/karaoke-output.html                               (HTML shell)
 *   apps/sister/public/build/karaoke-output.bundle.{js,css}              (Vite output)
 *
 * From main.js we go up one level for `public/` and into our own dir for `preload/`.
 * The preload is emitted as `.cjs` (from `.cts` source) so Electron's preload loader
 * treats it as CommonJS regardless of the workspace's "type": "module".
 */
const here = dirname(fileURLToPath(import.meta.url))
const RENDERER_HTML_PATH = resolve(here, "..", "public", "karaoke-output.html")
const PRELOAD_PATH = resolve(here, "preload", "karaoke-output-preload.cjs")
const OPERATOR_HTML_PATH = resolve(here, "..", "public", "operator-window.html")
const OPERATOR_PRELOAD_PATH = resolve(here, "preload", "operator-window-preload.cjs")

const OUTPUT_ID = "lyricue-sister-output"

/**
 * IPC channel names — must match the operator-window preload constants exactly.
 * Duplicated as string literals on both sides to avoid pulling Electron into the
 * preload bundle unexpectedly.
 */
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
const OPERATOR_STATE_BROADCAST_INTERVAL_MS = 200

const DEMO_REPRISE_TIMING_MAP = {
    ...DEMO_TIMING_MAP,
    showId: "demo-show-reprise",
    metadata: {
        ...DEMO_TIMING_MAP.metadata,
        sourceAudioHash: "demo-show-reprise"
    }
}

const DEMO_PROJECT: Project = {
    id: "walking-skeleton-project",
    title: "Walking-Skeleton Demo",
    shows: [
        { id: DEMO_TIMING_MAP.showId, title: "Walking-Skeleton Demo", artist: "LyriCue" },
        { id: DEMO_REPRISE_TIMING_MAP.showId, title: "Walking-Skeleton Reprise", artist: "LyriCue" }
    ]
}

const DEMO_TIMING_MAPS = new Map([
    [DEMO_TIMING_MAP.showId, DEMO_TIMING_MAP],
    [DEMO_REPRISE_TIMING_MAP.showId, DEMO_REPRISE_TIMING_MAP]
])
const DEMO_TIMING_MAP_VARIANTS = new Map<string, TimingMap>()
const DEMO_ARRANGEMENTS = new Map<string, Arrangement[]>()
const DEMO_ACTIVE_ARRANGEMENT_IDS = new Map<string, string | null>()

/**
 * The karaoke output adapter and the demo engine that drives it (when demo mode is on).
 * STORY-02.3 opened one window; STORY-02.5 (diagnostics) and EP-06 (renderer polish)
 * build on this; EP-09 (sync engine) replaces the demo engine with the real Sync Engine.
 */
let adapter: OwnWindowOutputAdapter | null = null
let demoEngine: DemoSyncEngine | null = null
let syncEngine: SyncEngine | null = null
let syncEngineSyncFrameUnsub: (() => void) | null = null
let syncEngineStateUnsub: (() => void) | null = null
let setlistController: SetlistController | null = null
let setlistControllerUnsub: (() => void) | null = null
let syntheticAudio: SyntheticAudioDriver | null = null
let diagnostics: DiagnosticsObserverState | null = null
let diagnosticsUnsub: (() => void) | null = null
let timingMapStorage: TimingMapStorage | null = null
let projectStorage: ProjectStorage | null = null

/** Operator window state. */
let operatorWindow: BrowserWindow | null = null
let operatorReady = false
let operatorSelectedDeviceId: string | null = E2E_MODE ? "synthetic-120bpm" : null
let lastTierForTransition: SyncTier = "auto"
let lastTransition: {
    from: SyncTier
    to: SyncTier
    reason: string
    atWallMs: number
} | null = null
/**
 * Buffered state envelope emitted before the operator renderer was ready. Like the
 * OwnWindowOutputAdapter's pre-ready buffer (D11): we hold the latest snapshot so the
 * operator window doesn't render with empty defaults the first time it mounts.
 */
let pendingOperatorState: Record<string, unknown> | null = null
let operatorStateBroadcastTimer: ReturnType<typeof setTimeout> | null = null
let lastOperatorStateBroadcastAt = 0
let ipcCommandHandler: ((event: Electron.IpcMainEvent, command: unknown) => void) | null = null
let ipcReadyHandler: ((event: Electron.IpcMainEvent) => void) | null = null
let sidecarController: SidecarController | null = null
let modelManifestCache: ModelManifest | null | undefined
let rehearsalCaptureSession: RehearsalCaptureSession | null = null
let smokeFailures: string[] = []

async function startSisterMode(): Promise<void> {
    adapter = new OwnWindowOutputAdapter({
        factory: createElectronBrowserWindowFactory(),
        rendererHtmlPath: RENDERER_HTML_PATH,
        preloadPath: PRELOAD_PATH,
        onWindowClosed: () => {
            log("karaoke output window closed by user")
        }
    })

    // The adapter emits `adapterClosed` when the OS closes the window. For the walking
    // skeleton we treat that as a request to quit on non-macOS platforms; EP-09 will
    // respawn for resilience and on macOS we let `app.activate` reopen.
    adapter.on("adapterClosed", () => {
        if (process.platform !== "darwin") app.quit()
    })

    await adapter.start({
        outputId: OUTPUT_ID,
        bounds: { x: 100, y: 100, width: 1280, height: 720 }
    })

    const startError = adapter.health.lastError
    if (startError) {
        log(`adapter.start() error: ${startError.message}`)
        return
    }
    log(`adapter.start() OK; running=${adapter.health.running}`)
    await hydrateDemoStorage()

    if (RENDERER_PERF_MODE) {
        startRendererPerfMode()
        log("renderer perf mode: frame pump started")
    } else if (E2E_MODE) {
        // End-to-end mode: real SyncEngine driven by synthetic 120 BPM audio features.
        // Composition proves EP-07 + EP-08.1 + EP-09 + EP-06 + EP-02 compose end-to-end.
        startE2EMode()
        log("E2E mode: SyncEngine + synthetic audio pipeline started")

        // EP-10 operator window: hosts SetlistPanel + TierChangeBanner. Available in
        // both E2E and DEMO mode, but only E2E mode has a live SyncEngine to receive
        // commands. In DEMO mode the panel is decorative (commands log and no-op).
        void startOperatorWindow()

        if (process.env.LC_CAPTURE_EVIDENCE === "1") {
            void captureEp06Evidence()
        }
    } else if (DEMO_MODE) {
        // Walking-skeleton demo (preserved for backwards compat with EP-06 evidence flow):
        // the DemoSyncEngine in @lyricue/core/output/test-utils walks DEMO_TIMING_MAP at
        // 1x tempo and pushes SyncFrames directly to the adapter. Same map and same engine
        // are used by the fork-mode demo (apps/fork/scripts/demo.ts) so the two modes are
        // guaranteed to receive identical frame streams — proving the OutputAdapter
        // abstraction (STORY-02.4 AC4).
        demoEngine = new DemoSyncEngine({
            adapter,
            map: DEMO_TIMING_MAP,
            outputId: OUTPUT_ID,
            fps: 60
        })
        demoEngine.start()
        log("DEMO mode: walking-skeleton demo engine started")

        if (process.env.LC_CAPTURE_EVIDENCE === "1") {
            void captureEp06Evidence()
        }
    } else {
        log("non-demo mode: adapter idle, awaiting operator engagement")
    }

    // STORY-02.5 diagnostics observer: derives fps/dps/msSinceLastFrame + system memory
    // from the raw adapter.health snapshots. We poll at 1Hz (the observer's default) but
    // only log every 5 seconds to keep stderr quiet — the observer's store is also the
    // single source of truth for the future in-renderer DiagnosticsPanel.
    diagnostics = createDiagnosticsObserver({ adapter, intervalMs: 1000 })
    diagnostics.start()

    let logTickCount = 0
    diagnosticsUnsub = diagnostics.snapshots.subscribe((snapshot) => {
        if (snapshot === null) return
        // Log every 5th tick (5s) to match the original cadence + the structured form below.
        logTickCount = (logTickCount + 1) % 5
        if (logTickCount !== 1) return
        log(formatDiagnostics(snapshot))
    })
}

/**
 * Compose the real Sync Engine end-to-end:
 *
 *   SyntheticAudioDriver (BpmEstimator + VadDetector)
 *       ↓ onTempoUpdate / onVadUpdate
 *   SyncEngine.dispatch(...)
 *       ↓ onSyncFrame
 *   OutputAdapter.pushSyncFrame(...)
 *
 * The SyncEngine's frame scheduler in Electron main can't use rAF (renderer-only),
 * so we drive it with setInterval at 16ms (~60 Hz) — the same cadence the renderer
 * would request. This matches the prior DemoSyncEngine pacing and keeps the OutputAdapter
 * happy.
 */
function startE2EMode(): void {
    if (!adapter) return

    // 1. Build a setInterval-based FrameScheduler. Each scheduled callback fires once
    //    per requestFrame call (the SyncEngine re-requests after each tick).
    const TICK_INTERVAL_MS = 16
    syncEngine = createSyncEngine({
        requestFrame: (cb) => {
            const id = setTimeout(() => cb(performance.now()), TICK_INTERVAL_MS)
            return () => clearTimeout(id)
        },
        now: () => performance.now()
    })

    // 2. Wire SyncEngine.onSyncFrame → adapter.pushSyncFrame.
    //    Note: the SyncEngine emits SyncFrames tagged with its own internal outputId,
    //    NOT the adapter's. The renderer filters by outputId, so we rewrite the tag
    //    here so frames match the adapter's outputId. Multi-output routing (EP-10+)
    //    will replace this with per-output engines.
    syncEngineSyncFrameUnsub = syncEngine.onSyncFrame((frame) => {
        const nextSongTitle = nextSongHintForFrame(frame.slideIndex)
        adapter?.pushSyncFrame({ ...frame, outputId: OUTPUT_ID, nextSongTitle })
    })
    // 3. Load the demo project through the EP-12 setlist controller. It owns active
    //    song loading, songComplete → next-song advance, and waitingForStart → VAD
    //    active engagement. The adapter buffers LC_LOAD_MAP if the renderer isn't
    //    ready yet (D11 fix).
    setlistController = createSetlistController({
        syncEngine,
        outputAdapter: adapter,
        timingMaps: {
            exists: async (showId) => DEMO_TIMING_MAPS.has(showId) || getTimingMapStorage().exists(showId),
            load: async (showId) => loadDemoTimingMap(showId, "studio"),
            existsVariant: async (showId, variant) => demoTimingMapVariantExists(showId, variant),
            loadVariant: async (showId, variant) => loadDemoTimingMap(showId, variant),
            loadArrangement: async (showId) => activeDemoArrangement(showId)
        }
    })
    setlistControllerUnsub = setlistController.state.subscribe(() => broadcastOperatorState())
    void loadOperatorProject().then(async (project) => {
        await setlistController?.loadProject(project)
        const firstShowId = project.shows[0]?.id
        if (firstShowId) await setlistController?.jumpToSong(firstShowId)
        syncEngine?.engageSync()
        broadcastOperatorState()
    })

    // 4. Build the synthetic audio driver. The 120 BPM target matches DEMO_TIMING_MAP's
    //    reference BPM, so tempoRatio should converge near 1.0.
    syntheticAudio = createSyntheticAudioDriver(
        {
            targetBPM: DEMO_TIMING_MAP.bpm,
            referenceBPM: DEMO_TIMING_MAP.bpm,
            sampleIntervalMs: 11
        },
        {
            onTempoUpdate: ({ tempoRatio, beatConfidence }) => {
                syncEngine?.dispatch({ kind: "tempoUpdate", tempoRatio, beatConfidence })
            },
            onVadUpdate: (vadState) => {
                syncEngine?.dispatch({ kind: "vadUpdate", vadState })
            }
        }
    )
    syntheticAudio.start()

    // 5. Subscribe the operator window to SyncEngine state changes. The SyncEngine
    //    store updates at frame cadence; the operator UI only needs a low-frequency
    //    control-plane snapshot, so throttle separately from the karaoke frame path.
    //
    //    The subscriber MUST be installed before `start()` so the first tick's state
    //    reaches the operator window without lag.
    syncEngineStateUnsub = syncEngine.state.subscribe(() => scheduleOperatorStateBroadcast())

    // 6. Boot the SyncEngine's tick loop. From here, every 16ms tick advances the
    //    cursor, emits a SyncFrame, and the OutputAdapter ships it to the renderer.
    syncEngine.start()
}

function startRendererPerfMode(): void {
    if (!adapter) return

    const totalFrames = 1000
    const targetFps = 60
    const thresholdFps = 30
    const frameIntervalMs = 1000 / targetFps
    const frames = generateFrameSequence({
        outputId: OUTPUT_ID,
        wordCount: DEMO_TIMING_MAP.sections[0]?.words.length ?? 1,
        msPerWord: 500,
        fps: targetFps
    })
    const sequence = Array.from({ length: totalFrames }, (_value, index) => frames[index % frames.length]!)

    adapter.loadTimingMap(DEMO_TIMING_MAP, null)

    setTimeout(() => {
        if (!adapter) return
        const startDelivered = adapter.health.framesDelivered
        const startDropped = adapter.health.framesDropped
        const startedAt = performance.now()
        let frameIndex = 0

        const timer = setInterval(() => {
            const frame = sequence[frameIndex]
            if (frame) adapter?.pushSyncFrame(frame)
            frameIndex += 1

            if (frameIndex < totalFrames) return
            clearInterval(timer)

            setTimeout(() => {
                const elapsedMs = performance.now() - startedAt
                const delivered = (adapter?.health.framesDelivered ?? 0) - startDelivered
                const dropped = (adapter?.health.framesDropped ?? 0) - startDropped
                const fps = delivered / (elapsedMs / 1000)
                const passed = delivered >= totalFrames && dropped === 0 && fps >= thresholdFps
                log(
                    `renderer-perf frames=${totalFrames} delivered=${delivered} dropped=${dropped} elapsedMs=${elapsedMs.toFixed(1)} fps=${fps.toFixed(1)} threshold=${thresholdFps} result=${passed ? "pass" : "fail"}`
                )
                if (!passed) process.exitCode = 1
                app.quit()
            }, 250)
        }, frameIntervalMs)
    }, 500)
}

/**
 * Spawn the operator BrowserWindow. Mounts SetlistPanel + TierChangeBanner; receives
 * commands from the operator and dispatches them to SyncEngine. Wired in both E2E
 * mode (live SyncEngine) and DEMO mode (no engine — commands are logged but no-op).
 *
 * Lifecycle:
 *   - Window opens visible + focusable (different from the karaoke output's
 *     transparent + frameless + alwaysOnTop config).
 *   - Operator receives state via the `lyricue:operator:state` IPC channel.
 *   - Operator sends commands via `lyricue:operator:command`. Main maps them to
 *     SyncEngine.dispatch (when E2E mode is active).
 */
async function startOperatorWindow(): Promise<void> {
    if (operatorWindow && !operatorWindow.isDestroyed()) {
        operatorWindow.focus()
        broadcastOperatorState()
        return
    }

    removeOperatorIpcHandlers()
    operatorReady = false
    pendingOperatorState = null

    operatorWindow = new BrowserWindow({
        x: 1450,
        y: 100,
        width: 520,
        height: 720,
        title: "LyriCue · Operator",
        backgroundColor: "#0a0a0a",
        show: false,
        webPreferences: {
            contextIsolation: true,
            backgroundThrottling: false,
            preload: OPERATOR_PRELOAD_PATH
        }
    })

    operatorWindow.once("ready-to-show", () => {
        if (!operatorWindow?.isDestroyed()) operatorWindow?.show()
    })

    if (process.env.LC_OPEN_DEVTOOLS === "1") {
        operatorWindow.webContents.openDevTools({ mode: "detach" })
    }

    if (process.env.LC_VERBOSE === "1") {
        operatorWindow.webContents.on(
            "console-message",
            (event: Electron.WebContentsConsoleMessageEventParams) => {
                const levelName = event.level ?? "log"
                const where = event.sourceId ? ` (${event.sourceId}:${event.lineNumber})` : ""
                process.stderr.write(
                    `[lyricue:sister:operator:${levelName}] ${event.message}${where}\n`
                )
            }
        )
    }

    operatorWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
        process.stderr.write(
            `[lyricue:sister:operator:preload-error] ${preloadPath}: ${error.message}\n`
        )
    })
    operatorWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
        if (errorCode === -3) return
        process.stderr.write(
            `[lyricue:sister:operator:did-fail-load] code=${errorCode} url=${validatedURL} msg=${errorDescription}\n`
        )
    })

    operatorWindow.on("closed", () => {
        operatorWindow = null
        operatorReady = false
        pendingOperatorState = null
        removeOperatorIpcHandlers()
        // The karaoke output window may still be open. Don't quit on operator close
        // unless this was the last window (handled by `window-all-closed` upstream).
    })

    // Install the IPC handlers. These persist for the app's lifetime; we remove them
    // on shutdown to keep `before-quit` deterministic.
    ipcReadyHandler = (event) => {
        if (event.sender !== operatorWindow?.webContents) return
        operatorReady = true
        log("operator window: renderer signalled ready")
        // Flush the buffered snapshot if one was emitted before the renderer mounted.
        if (pendingOperatorState !== null) {
            const buffered = pendingOperatorState
            pendingOperatorState = null
            operatorWindow.webContents.send(OPERATOR_STATE_CHANNEL, buffered)
        }
    }
    ipcCommandHandler = (event, command) => {
        if (event.sender !== operatorWindow?.webContents) return
        handleOperatorCommand(command)
    }
    ipcMain.on(OPERATOR_READY_EVENT, ipcReadyHandler)
    ipcMain.on(OPERATOR_COMMAND_CHANNEL, ipcCommandHandler)
    ipcMain.removeHandler(OPERATOR_LEARN_SONG_CHANNEL)
    ipcMain.handle(OPERATOR_LEARN_SONG_CHANNEL, async (event, request: unknown) => {
        if (event.sender !== operatorWindow?.webContents) {
            throw new Error("Rejected learn_song request from unknown sender.")
        }
        return handleOperatorLearnSong(request)
    })
    ipcMain.removeHandler(OPERATOR_CANCEL_LEARN_SONG_CHANNEL)
    ipcMain.handle(OPERATOR_CANCEL_LEARN_SONG_CHANNEL, async (event, request: unknown) => {
        if (event.sender !== operatorWindow?.webContents) {
            throw new Error("Rejected cancel-learn-song request from unknown sender.")
        }
        return handleOperatorCancelLearnSong(request)
    })
    ipcMain.removeHandler(OPERATOR_REHEARSAL_START_CHANNEL)
    ipcMain.handle(OPERATOR_REHEARSAL_START_CHANNEL, async (event, request: unknown) => {
        if (event.sender !== operatorWindow?.webContents) {
            throw new Error("Rejected rehearsal-start request from unknown sender.")
        }
        return handleRehearsalStart(request)
    })
    ipcMain.removeHandler(OPERATOR_REHEARSAL_CHUNK_CHANNEL)
    ipcMain.handle(OPERATOR_REHEARSAL_CHUNK_CHANNEL, async (event, request: unknown) => {
        if (event.sender !== operatorWindow?.webContents) {
            throw new Error("Rejected rehearsal-chunk request from unknown sender.")
        }
        return handleRehearsalChunk(request)
    })
    ipcMain.removeHandler(OPERATOR_REHEARSAL_STOP_CHANNEL)
    ipcMain.handle(OPERATOR_REHEARSAL_STOP_CHANNEL, async (event) => {
        if (event.sender !== operatorWindow?.webContents) {
            throw new Error("Rejected rehearsal-stop request from unknown sender.")
        }
        return handleRehearsalStop()
    })
    ipcMain.removeHandler(OPERATOR_REHEARSAL_DISCARD_CHANNEL)
    ipcMain.handle(OPERATOR_REHEARSAL_DISCARD_CHANNEL, async (event) => {
        if (event.sender !== operatorWindow?.webContents) {
            throw new Error("Rejected rehearsal-discard request from unknown sender.")
        }
        return handleRehearsalDiscard()
    })

    try {
        await operatorWindow.loadFile(OPERATOR_HTML_PATH)
    } catch (err) {
        log(`operator window: failed to load HTML: ${(err as Error).message}`)
    }

    // Push the initial state snapshot — synchronous so the renderer has data on its
    // very first paint (if the renderer signalled ready before this, the snapshot
    // delivers directly; otherwise it's buffered for the ready event).
    broadcastOperatorState()
}

/**
 * Translate operator commands into SyncEngine event dispatches. Commands that don't
 * require an engine (e.g., `changeDevice` updating a setting) are handled here.
 */
function handleOperatorCommand(command: unknown): void {
    if (!command || typeof command !== "object" || typeof (command as { kind?: unknown }).kind !== "string") {
        log(`operator command: malformed payload, ignoring`)
        return
    }
    const c = command as { kind: string } & Record<string, unknown>
    log(`operator command: ${c.kind}`)

    // For now, broadcasting state back happens implicitly via SyncEngine.state's
    // subscriber wired in startE2EMode(). For DEMO_MODE / no-engine paths, we log
    // and no-op.

    switch (c.kind) {
        case "engageSync":
            syncEngine?.engageSync()
            break
        case "selectSong":
            if (typeof c.songId === "string") {
                void setlistController?.jumpToSong(c.songId).then(() => broadcastOperatorState())
            }
            break
        case "selectTimingMapVariant":
            if (c.variant === "studio" || c.variant === "rehearsal") {
                void setlistController?.selectTimingMapVariant(c.variant).then(() => broadcastOperatorState())
            }
            break
        case "changeDevice":
            // Device-selection plumbing lands in EP-07 STORY-07.2 wiring. For now,
            // just record the change in the state so the picker shows it persistently.
            operatorSelectedDeviceId = typeof c.deviceId === "string" ? c.deviceId : null
            broadcastOperatorState()
            break
        case "forceTier": {
            const tier = c.tier
            if (tier === "auto" || tier === "timer" || tier === "manual") {
                syncEngine?.forceTier(tier)
            }
            break
        }
        case "toggleManual":
            syncEngine?.toggleManual()
            break
        case "reEngageSync":
            syncEngine?.reEngageSync()
            break
        case "nextSection":
            handleNextSection()
            break
        case "prevSection":
            handlePrevSection()
            break
        case "editArrangement":
        case "publishSong":
        case "toggleRehearsal":
            log(`operator command: ${c.kind} acknowledged; host service wiring pending`)
            broadcastOperatorState()
            break
        case "saveArrangement":
            void saveDemoArrangement(c.arrangement)
            break
        case "selectArrangement":
            selectDemoArrangement(c.showId, c.arrangementId)
            break
        case "saveTranslation":
            void saveDemoTranslation(c.timingMap)
            break
        case "saveTimingMap":
            void saveOperatorTimingMap(c.timingMap)
            break
        case "approveRehearsalSegment":
            void approveRehearsalSegment(c.segment, c.skippedWordKeys)
            break
        default:
            log(`operator command: unknown kind=${c.kind}`)
    }
}

function activeDemoArrangement(showId: string): Arrangement | null {
    const arrangements = DEMO_ARRANGEMENTS.get(showId) ?? []
    const activeId = DEMO_ACTIVE_ARRANGEMENT_IDS.get(showId)
    if (activeId) return arrangements.find((arrangement) => arrangement.id === activeId) ?? null
    return arrangements.find((arrangement) => arrangement.isDefault) ?? arrangements[0] ?? null
}

function demoVariantKey(showId: string, variant: TimingMapVariant): string {
    return `${showId}:${variant}`
}

async function demoTimingMapVariantExists(showId: string, variant: TimingMapVariant): Promise<boolean> {
    if (variant === "studio") return DEMO_TIMING_MAPS.has(showId) || getTimingMapStorage().exists(showId)
    if (DEMO_TIMING_MAP_VARIANTS.has(demoVariantKey(showId, variant))) return true
    return getTimingMapStorage().existsVariant(showId, variant as TimingMapStorageVariant)
}

async function loadDemoTimingMap(showId: string, variant: TimingMapVariant): Promise<TimingMap | null> {
    if (variant === "studio") {
        const cached = DEMO_TIMING_MAPS.get(showId)
        if (cached) return cached
        const stored = await getTimingMapStorage().load(showId)
        if (stored) DEMO_TIMING_MAPS.set(showId, stored)
        return stored
    }
    const key = demoVariantKey(showId, variant)
    const cached = DEMO_TIMING_MAP_VARIANTS.get(key)
    if (cached) return cached
    const stored = await getTimingMapStorage().loadVariant(showId, variant as TimingMapStorageVariant)
    if (stored) DEMO_TIMING_MAP_VARIANTS.set(key, stored)
    return stored
}

function activeDemoTimingMap(showId: string, variant: TimingMapVariant): TimingMap | null {
    return variant === "studio"
        ? DEMO_TIMING_MAPS.get(showId) ?? null
        : DEMO_TIMING_MAP_VARIANTS.get(demoVariantKey(showId, variant)) ?? null
}

function getTimingMapStorage(): TimingMapStorage {
    if (timingMapStorage) return timingMapStorage
    timingMapStorage = new TimingMapStorage({
        paths: getLyriCuePaths()
    })
    return timingMapStorage
}

function getProjectStorage(): ProjectStorage {
    if (projectStorage) return projectStorage
    projectStorage = new ProjectStorage({ paths: getLyriCuePaths() })
    return projectStorage
}

function getLyriCuePaths(): ReturnType<typeof resolveLyriCuePaths> {
    return resolveLyriCuePaths(process.env.LC_USER_DATA_DIR || app.getPath("userData"))
}

async function hydrateDemoStorage(): Promise<void> {
    const storage = getTimingMapStorage()
    for (const showId of DEMO_TIMING_MAPS.keys()) {
        try {
            const storedMap = await storage.load(showId)
            if (storedMap) DEMO_TIMING_MAPS.set(showId, storedMap)
        } catch (err) {
            log(`timing storage load failed for ${showId}: ${(err as Error).message}`)
        }

        try {
            const rehearsalMap = await storage.loadVariant(showId, "rehearsal")
            if (rehearsalMap) DEMO_TIMING_MAP_VARIANTS.set(demoVariantKey(showId, "rehearsal"), rehearsalMap)
        } catch (err) {
            log(`rehearsal timing-map variant load failed for ${showId}: ${(err as Error).message}`)
        }

        try {
            const storedArrangements = await storage.loadArrangements(showId)
            if (storedArrangements.length > 0) DEMO_ARRANGEMENTS.set(showId, storedArrangements)
        } catch (err) {
            log(`arrangement storage load failed for ${showId}: ${(err as Error).message}`)
        }
    }
}

async function loadOperatorProject(): Promise<Project> {
    try {
        const stored = await getProjectStorage().loadActiveProject()
        if (stored) return stored
    } catch (err) {
        log(`active project load failed: ${(err as Error).message}`)
    }
    try {
        await getProjectStorage().saveActiveProject(DEMO_PROJECT)
    } catch (err) {
        log(`default project save failed: ${(err as Error).message}`)
    }
    return DEMO_PROJECT
}

async function saveOperatorProject(project: Project): Promise<void> {
    try {
        await getProjectStorage().saveActiveProject(project)
    } catch (err) {
        log(`active project save failed: ${(err as Error).message}`)
    }
}

async function saveDemoArrangement(input: unknown): Promise<void> {
    const result = prepareOperatorArrangementSave(input, (showId) => DEMO_TIMING_MAPS.get(showId) ?? null)
    if (!result.ok) {
        log(`operator arrangement save rejected: ${result.message}`)
        return
    }
    const arrangement = result.arrangement

    const current = DEMO_ARRANGEMENTS.get(arrangement.showId) ?? []
    const next = current.some((candidate) => candidate.id === arrangement.id)
        ? current.map((candidate) => (candidate.id === arrangement.id ? arrangement : candidate))
        : [...current, arrangement]
    DEMO_ARRANGEMENTS.set(arrangement.showId, next)
    DEMO_ACTIVE_ARRANGEMENT_IDS.set(arrangement.showId, arrangement.id)
    try {
        await getTimingMapStorage().saveArrangements(arrangement.showId, next)
    } catch (err) {
        log(`operator arrangement save failed: ${(err as Error).message}`)
        return
    }
    reloadActiveDemoSong(arrangement.showId)
    broadcastOperatorState()
}

function selectDemoArrangement(showId: unknown, arrangementId: unknown): void {
    if (typeof showId !== "string" || !DEMO_TIMING_MAPS.has(showId)) return
    if (arrangementId !== null && typeof arrangementId !== "string") return
    DEMO_ACTIVE_ARRANGEMENT_IDS.set(showId, arrangementId)
    reloadActiveDemoSong(showId)
    broadcastOperatorState()
}

async function saveDemoTranslation(input: unknown): Promise<void> {
    const result = prepareOperatorTranslationSave(input, (showId, variant) => activeDemoTimingMap(showId, variant))
    if (!result.ok) {
        log(`operator translation save rejected: ${result.message}`)
        return
    }
    const { map, variant } = result.value
    try {
        if (variant === "rehearsal") {
            DEMO_TIMING_MAP_VARIANTS.set(demoVariantKey(map.showId, "rehearsal"), map)
            await getTimingMapStorage().saveVariant(map.showId, "rehearsal", map)
        } else {
            DEMO_TIMING_MAPS.set(map.showId, map)
            await getTimingMapStorage().save(map.showId, map)
        }
    } catch (err) {
        log(`operator translation save failed: ${(err as Error).message}`)
        return
    }
    reloadActiveDemoSong(map.showId)
    broadcastOperatorState()
}

async function saveOperatorTimingMap(input: unknown): Promise<void> {
    const result = validateTimingMap(input)
    if (!result.ok) {
        log(`operator timing-map save rejected: ${result.errors[0]?.message ?? "invalid timing map"}`)
        return
    }
    const map = result.value
    try {
        DEMO_TIMING_MAPS.set(map.showId, map)
        await getTimingMapStorage().save(map.showId, map)
    } catch (err) {
        log(`operator timing-map save failed: ${(err as Error).message}`)
        return
    }
    const currentProject = setlistController?.snapshot().project ?? (await loadOperatorProject())
    if (!currentProject.shows.some((show) => show.id === map.showId)) {
        const nextProject: Project = {
            ...currentProject,
            shows: [
                ...currentProject.shows,
                {
                    id: map.showId,
                    title: map.showId
                }
            ]
        }
        await saveOperatorProject(nextProject)
        await setlistController?.loadProject(nextProject)
    }
    reloadActiveDemoSong(map.showId)
    broadcastOperatorState()
}

async function approveRehearsalSegment(segmentInput: unknown, skippedInput: unknown): Promise<void> {
    const segment = parseRehearsalReviewSegment(segmentInput)
    if (!segment) {
        log("operator rehearsal approval rejected: invalid segment")
        return
    }
    const baseMap = DEMO_TIMING_MAPS.get(segment.showId)
    if (!baseMap) {
        log(`operator rehearsal approval rejected: unknown showId=${segment.showId}`)
        return
    }
    const skippedWordKeys = Array.isArray(skippedInput)
        ? skippedInput.filter((value): value is string => typeof value === "string")
        : []
    const map = buildRehearsalTimingMapVariant({
        baseMap,
        segment,
        skippedWordKeys,
        ...(segment.sourceAudioPath ? { sourceFilename: basename(segment.sourceAudioPath) } : {})
    })
    try {
        DEMO_TIMING_MAP_VARIANTS.set(demoVariantKey(segment.showId, "rehearsal"), map)
        await getTimingMapStorage().saveVariant(segment.showId, "rehearsal", map)
    } catch (err) {
        log(`operator rehearsal approval failed: ${(err as Error).message}`)
        return
    }
    await setlistController?.selectTimingMapVariant("rehearsal")
    broadcastOperatorState()
}

function parseRehearsalReviewSegment(input: unknown): { showId: string; startSec: number; endSec: number; sourceAudioPath?: string } | null {
    if (!input || typeof input !== "object") return null
    const row = input as Record<string, unknown>
    if (typeof row.showId !== "string" || row.showId.trim() === "") return null
    const startSec = typeof row.startSec === "number" && Number.isFinite(row.startSec) ? row.startSec : 0
    const endSec = typeof row.endSec === "number" && Number.isFinite(row.endSec) ? row.endSec : 0
    if (endSec <= startSec) return null
    return {
        showId: row.showId,
        startSec,
        endSec,
        ...(typeof row.sourceAudioPath === "string" ? { sourceAudioPath: row.sourceAudioPath } : {})
    }
}

function reloadActiveDemoSong(showId: string): void {
    const setlistState = setlistController?.snapshot() ?? null
    if (setlistState?.activeShowId !== showId) return
    const map = activeDemoTimingMap(showId, setlistState.activeTimingMapVariant)
    if (!map) return
    const arrangement = activeDemoArrangement(showId)
    syncEngine?.loadSong({ map, arrangement, showId })
    adapter?.loadTimingMap(map, arrangement, map.parallel)
}

function handleNextSection(): void {
    if (!syncEngine) return
    const state = syncEngine.snapshot()
    if (!state.activeTimingMap) return
    const target = findNextSlideStart(
        state.activeTimingMap,
        state.activeArrangement,
        state.cursorRefTime
    )
    if (target === null) return
    syncEngine.dispatch({ kind: "nextSection", targetRefMs: target, wallTime: performance.now() })
}

function handlePrevSection(): void {
    if (!syncEngine) return
    const state = syncEngine.snapshot()
    if (!state.activeTimingMap) return
    const target = findPrevSlideStart(
        state.activeTimingMap,
        state.activeArrangement,
        state.cursorRefTime
    )
    if (target === null) return
    syncEngine.dispatch({ kind: "prevSection", targetRefMs: target, wallTime: performance.now() })
}

function nextSongHintForFrame(slideIndex: number): string | null {
    const seState = syncEngine?.snapshot() ?? null
    const setlistState = setlistController?.snapshot() ?? null
    if (!seState?.activeTimingMap || !setlistState?.nextSongTitle) return null
    const sectionCount = seState.activeArrangement?.sequence.length ?? seState.activeTimingMap.sections.length
    if (sectionCount === 0) return null
    return slideIndex === sectionCount - 1 ? setlistState.nextSongTitle : null
}

/**
 * Build + send a full state snapshot to the operator renderer. When the renderer
 * hasn't signalled ready yet, the snapshot is buffered (D11-style pre-ready buffer).
 * EP-12's Setlist module will replace the hard-coded demo setlist with real state.
 */
function broadcastOperatorState(): void {
    lastOperatorStateBroadcastAt = performance.now()
    const seState = syncEngine?.snapshot() ?? null
    const setlistState = setlistController?.snapshot() ?? null
    const activeShowId = setlistState?.activeShowId ?? seState?.activeShowId ?? null
    const activeTimingMapVariant = setlistState?.activeTimingMapVariant ?? "studio"
    const activeTimingMap = activeShowId ? activeDemoTimingMap(activeShowId, activeTimingMapVariant) : null
    const activeArrangements = activeShowId ? DEMO_ARRANGEMENTS.get(activeShowId) ?? [] : []
    const activeArrangement = activeShowId ? activeDemoArrangement(activeShowId) : null
    detectTierTransition(seState)
    const setlist =
        setlistState?.songs.map((song) => ({
            ...song,
            bpm: DEMO_TIMING_MAPS.get(song.id)?.bpm ?? song.bpm
        })) ?? []

    const payload: Record<string, unknown> = {
        projectTitle: setlistState?.project?.title ?? "Walking-Skeleton Demo",
        tier: seState?.tier ?? "auto",
        syncActive: seState?.runState === "running",
        activeSongId: activeShowId,
        nextSongTitle: setlistState?.nextSongTitle ?? null,
        activeTimingMapVariant,
        availableTimingMapVariants: setlistState?.availableTimingMapVariants ?? ["studio"],
        setlist,
        activeTimingMap,
        activeArrangements,
        activeArrangementId: activeArrangement?.id ?? null,
        selectedDeviceId: operatorSelectedDeviceId,
        audioDevices: [
            // Synthetic placeholder; EP-07 wiring will replace with enumerated devices.
            { deviceId: "synthetic-120bpm", label: "Synthetic 120 BPM (E2E demo)", kind: "audioinput", groupId: "demo" }
        ],
        lastTransition,
        modelManifestStatus: resolveOperatorModelManifestStatus({
            manifestPath: MODEL_MANIFEST_PATH,
            requireManifest: REQUIRE_MODEL_MANIFEST,
            pathExists: existsSync
        }),
        shortcuts: {
            startSync: "Space",
            nextSection: "ArrowRight",
            prevSection: "ArrowLeft",
            toggleManual: "Escape",
            reEngageSync: "Enter"
        }
    }

    if (operatorWindow !== null && !operatorWindow.isDestroyed() && operatorReady) {
        operatorWindow.webContents.send(OPERATOR_STATE_CHANNEL, payload)
    } else {
        // Pre-ready buffer — last-write-wins.
        pendingOperatorState = payload
    }
}

function scheduleOperatorStateBroadcast(): void {
    if (!operatorWindow || operatorWindow.isDestroyed()) return
    if (operatorStateBroadcastTimer !== null) return

    const now = performance.now()
    const elapsed = now - lastOperatorStateBroadcastAt
    if (elapsed >= OPERATOR_STATE_BROADCAST_INTERVAL_MS) {
        broadcastOperatorState()
        return
    }

    operatorStateBroadcastTimer = setTimeout(() => {
        operatorStateBroadcastTimer = null
        broadcastOperatorState()
    }, OPERATOR_STATE_BROADCAST_INTERVAL_MS - elapsed)
}

function removeOperatorIpcHandlers(): void {
    if (ipcReadyHandler) {
        ipcMain.off(OPERATOR_READY_EVENT, ipcReadyHandler)
        ipcReadyHandler = null
    }
    if (ipcCommandHandler) {
        ipcMain.off(OPERATOR_COMMAND_CHANNEL, ipcCommandHandler)
        ipcCommandHandler = null
    }
    ipcMain.removeHandler(OPERATOR_LEARN_SONG_CHANNEL)
    ipcMain.removeHandler(OPERATOR_CANCEL_LEARN_SONG_CHANNEL)
    ipcMain.removeHandler(OPERATOR_REHEARSAL_START_CHANNEL)
    ipcMain.removeHandler(OPERATOR_REHEARSAL_CHUNK_CHANNEL)
    ipcMain.removeHandler(OPERATOR_REHEARSAL_STOP_CHANNEL)
    ipcMain.removeHandler(OPERATOR_REHEARSAL_DISCARD_CHANNEL)
}

async function handleOperatorCancelLearnSong(request: unknown): Promise<unknown> {
    if (!request || typeof request !== "object") {
        throw new Error("cancel learn_song request must be an object.")
    }
    const payload = request as Record<string, unknown>
    if (typeof payload.jobId !== "string" || payload.jobId.trim() === "") {
        throw new Error("cancel learn_song requires a jobId.")
    }
    const controller = sidecarController
    if (!controller) return { jobId: payload.jobId, cancelled: false, strategy: "sidecar-not-running" }
    const cancelled = controller.terminate("SIGTERM")
    return { jobId: payload.jobId, cancelled, strategy: "terminate-sidecar" }
}

async function handleOperatorLearnSong(request: unknown): Promise<unknown> {
    if (!request || typeof request !== "object") {
        throw new Error("learn_song request must be an object.")
    }
    const payload = request as Record<string, unknown>
    if (typeof payload.audioPath !== "string" || payload.audioPath.trim() === "") {
        throw new Error("Choose a reference audio file before starting learning.")
    }
    if (!Array.isArray(payload.lyrics) || payload.lyrics.length === 0) {
        throw new Error("Add at least one lyric section before starting learning.")
    }
    if (typeof payload.showId !== "string" || payload.showId.trim() === "") {
        throw new Error("Song learning requires a showId.")
    }

    const productionMode = isProductionLearnSongPayload(payload)
    const learnSongPayload = withRequiredModelSpecs(payload, {
        manifest: productionMode ? getConfiguredModelManifest() : null,
        ...(MODEL_MIRROR_URL ? { modelMirrorUrl: MODEL_MIRROR_URL } : {}),
        requireManifest: productionMode && REQUIRE_MODEL_MANIFEST
    })
    const controller = getSidecarController()
    await controller.ensureRunning()
    return controller.request("learn_song", learnSongPayload, {
        timeoutMs: learnSongTimeoutMs(productionMode ? "production" : "deterministic"),
        onProgress: (notification) => {
            if (!operatorWindow || operatorWindow.isDestroyed()) return
            operatorWindow.webContents.send(OPERATOR_LEARN_SONG_PROGRESS_CHANNEL, notification.params ?? {})
        }
    })
}

function isProductionLearnSongPayload(payload: Record<string, unknown>): boolean {
    const options = payload.options
    return !!options && typeof options === "object" && !Array.isArray(options) && (options as Record<string, unknown>).alignmentMode === "production"
}

function getConfiguredModelManifest(): ModelManifest | null {
    if (modelManifestCache !== undefined) return modelManifestCache
    if (!MODEL_MANIFEST_PATH || MODEL_MANIFEST_PATH.trim() === "") {
        modelManifestCache = null
        return modelManifestCache
    }
    modelManifestCache = loadModelManifestFile(MODEL_MANIFEST_PATH)
    log(`loaded model manifest from ${MODEL_MANIFEST_PATH}`)
    return modelManifestCache
}

async function handleRehearsalStart(request: unknown): Promise<unknown> {
    if (rehearsalCaptureSession) {
        throw new Error("A rehearsal capture session is already running.")
    }
    if (!request || typeof request !== "object") {
        throw new Error("rehearsal-start request must be an object.")
    }
    const payload = request as Record<string, unknown>
    const sampleRate = typeof payload.sampleRate === "number" ? Math.round(payload.sampleRate) : 48_000
    const channels = typeof payload.channels === "number" ? Math.round(payload.channels) : 1
    const startedAt = new Date()
    const filePath = join(
        getLyriCuePaths().rehearsalsDir,
        `${startedAt.toISOString().replace(/[:.]/g, "-")}.wav`
    )
    const writer = await createWavChunkWriter({ filePath, sampleRate, channels })
    rehearsalCaptureSession = createRehearsalCaptureSession({
        filePath,
        writer,
        startedAt: startedAt.toISOString(),
        now: () => performance.now()
    })
    log(`rehearsal capture started: ${filePath}`)
    return {
        filePath,
        startedAt: rehearsalCaptureSession.startedAt,
        sampleRate,
        channels
    }
}

async function handleRehearsalChunk(request: unknown): Promise<unknown> {
    if (!rehearsalCaptureSession) {
        throw new Error("No rehearsal capture session is running.")
    }
    if (!request || typeof request !== "object") {
        throw new Error("rehearsal-chunk request must be an object.")
    }
    const chunk = (request as Record<string, unknown>).chunk
    const bytes =
        chunk instanceof Uint8Array
            ? chunk
            : chunk instanceof ArrayBuffer
              ? new Uint8Array(chunk)
              : ArrayBuffer.isView(chunk)
                ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
                : null
    if (!bytes || bytes.byteLength === 0) {
        throw new Error("rehearsal-chunk request must include non-empty bytes.")
    }
    await rehearsalCaptureSession.writeChunk(bytes)
    return {
        bytesWritten: rehearsalCaptureSession.bytesWritten,
        elapsedMs: rehearsalCaptureSession.elapsedMs
    }
}

async function handleRehearsalStop(): Promise<unknown> {
    if (!rehearsalCaptureSession) {
        throw new Error("No rehearsal capture session is running.")
    }
    const session = rehearsalCaptureSession
    rehearsalCaptureSession = null
    const result = await session.stop()
    log(`rehearsal capture stopped: ${result.filePath} bytes=${result.bytesWritten}`)
    const segmentation = await segmentSavedRehearsal(result.filePath).catch((err) => ({
        error: (err as Error).message,
        segments: []
    }))
    return { ...result, segmentation }
}

async function handleRehearsalDiscard(): Promise<unknown> {
    if (!rehearsalCaptureSession) return { discarded: false }
    const session = rehearsalCaptureSession
    rehearsalCaptureSession = null
    await session.discard()
    log(`rehearsal capture discarded: ${session.filePath}`)
    return { discarded: true, filePath: session.filePath }
}

async function segmentSavedRehearsal(audioPath: string): Promise<unknown> {
    const setlistState = setlistController?.snapshot() ?? null
    const songs = setlistState
        ? await Promise.all(
              setlistState.songs.map(async (song) => {
                  const map = await loadDemoTimingMap(song.id, "studio")
                  return {
                      showId: song.id,
                      title: song.title,
                      lyrics: map ? lyricsTextForTimingMap(map) : ""
                  }
              })
          )
        : []
    if (songs.length === 0) return { segments: [] }

    const controller = getSidecarController()
    await controller.ensureRunning()
    return controller.request(
        "segment_rehearsal",
        {
            jobId: `rehearsal-${Date.now()}`,
            audioPath,
            setlist: songs,
            options: {
                silenceThreshold: 0.02,
                minSegmentSeconds: 1
            }
        },
        { timeoutMs: 120_000 }
    )
}

function lyricsTextForTimingMap(map: TimingMap): string {
    return map.sections
        .flatMap((section) => section.words.map((word) => word.text))
        .join(" ")
}

function getSidecarController(): SidecarController {
    if (sidecarController) return sidecarController
    const repoRoot = resolve(here, "..", "..", "..")
    const launch = resolveSidecarLaunch({
        appPath: repoRoot,
        resourcesPath: process.resourcesPath,
        nodeEnv: sidecarResolverNodeEnv({ isPackaged: app.isPackaged, nodeEnv: process.env.NODE_ENV })
    })
    const sidecarRoot = launch.mode === "source" ? launch.sourceDir : dirname(launch.binaryPath)
    const opts: SidecarControllerOptions = {
        spawn: nodeSidecarSpawner,
        resolvePython:
            launch.mode === "bundled"
                ? async () => ({ pythonPath: launch.binaryPath, version: "bundled" })
                : nodePythonResolver,
        pythonOverride:
            launch.mode === "source"
                ? resolveSourceSidecarPythonOverride({
                      sidecarRoot,
                      envOverride: SOURCE_SIDECAR_PYTHON,
                      exists: existsSync
                  })
                : null,
        moduleArgs: launch.mode === "bundled" ? [] : ["-m", "lyricue_sidecar"],
        readyTimeoutMs: launch.mode === "bundled" ? 180_000 : 30_000,
        cwd: sidecarRoot,
        onStderrLine: (line) => log(`sidecar: ${line}`)
    }
    sidecarController = new SidecarController(opts)
    return sidecarController
}

/**
 * Detect tier transitions for the TierChangeBanner. SE doesn't emit a dedicated
 * "transition" event — we derive it by watching `state.tier` and synthesising a
 * `{ from, to, reason }` record whenever the value changes.
 */
function detectTierTransition(seState: SyncEngineState | null): void {
    if (seState === null) return
    if (seState.tier === lastTierForTransition) return
    const reason = explainTransition(lastTierForTransition, seState.tier, seState)
    lastTransition = {
        from: lastTierForTransition,
        to: seState.tier,
        reason,
        atWallMs: performance.now()
    }
    lastTierForTransition = seState.tier
}

function explainTransition(from: SyncTier, to: SyncTier, _seState: SyncEngineState): string {
    if (from === "auto" && to === "timer") return "Beat confidence dropped — switched to timer mode."
    if (from === "timer" && to === "auto") return "Sync re-engaged — back to auto."
    if (to === "manual") return "Manual mode engaged — auto-advance paused."
    if (from === "manual" && to === "auto") return "Re-engaging auto sync."
    return `Tier changed from ${from} to ${to}.`
}

function formatDiagnostics(s: DiagnosticsSnapshot): string {
    const fps = s.instantaneousFps === null ? "—" : s.instantaneousFps.toFixed(1)
    const dps = s.instantaneousDps === null ? "—" : s.instantaneousDps.toFixed(1)
    const since =
        s.msSinceLastFrame === null
            ? "—"
            : s.msSinceLastFrame < 1000
              ? `${Math.round(s.msSinceLastFrame)}ms`
              : `${(s.msSinceLastFrame / 1000).toFixed(1)}s`
    const rssMb = (s.memory.rss / 1024 / 1024).toFixed(1)
    const heapMb = (s.memory.heapUsed / 1024 / 1024).toFixed(1)
    return (
        `diag mode=${s.adapterMode} running=${s.adapter.running} ` +
        `delivered=${s.adapter.framesDelivered} dropped=${s.adapter.framesDropped} ` +
        `fps=${fps} dps=${dps} since-frame=${since} ` +
        `rss=${rssMb}MB heap=${heapMb}MB uptime=${s.uptimeSeconds.toFixed(0)}s ` +
        `lastError=${s.adapter.lastError?.message ?? "none"}`
    )
}

async function captureEp06Evidence(): Promise<void> {
    // When invoked from E2E mode, write the karaoke captures to ep09-e2e/ and the
    // operator-window captures to ep10-operator-window/. DEMO mode writes karaoke to
    // ep06-karaoke-renderer/ and skips operator (no operator window in DEMO).
    const karaokeSubDir = E2E_MODE
        ? "ep09-e2e-2026-05-15"
        : "ep06-karaoke-renderer-2026-05-15"
    const karaokeDir = resolve("docs", "qa-reports", "evidence", karaokeSubDir)
    const operatorDir = resolve(
        "docs",
        "qa-reports",
        "evidence",
        "ep10-operator-window-2026-05-15"
    )
    mkdirSync(karaokeDir, { recursive: true })
    if (E2E_MODE) mkdirSync(operatorDir, { recursive: true })

    /** Cursor offsets selected so each screenshot captures a distinct rendered state.
     *  DEMO_TIMING_MAP plays at 500ms per word × 12 words = 6s total before looping.
     *  We sample at four offsets that exercise: first-word sweep, mid-section words,
     *  late-section words, and the post-loop restart. */
    const steps: { label: string; waitMs: number }[] = [
        { label: "01-first-word-active", waitMs: 600 },
        { label: "02-mid-section", waitMs: 1000 },
        { label: "03-late-section", waitMs: 2500 },
        { label: "04-post-loop-restart", waitMs: E2E_MODE ? 2200 : 1500 }
    ]

    for (const step of steps) {
        await new Promise<void>((r) => setTimeout(r, step.waitMs))
        // The karaoke output window is opened by the adapter — its title is
        // "Electron" by default since we don't override it. We identify it as the
        // window that is NOT the operatorWindow handle.
        const allWindows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
        const karaokeWindow = allWindows.find((w) => w !== operatorWindow)
        const opWindow = operatorWindow && !operatorWindow.isDestroyed() ? operatorWindow : null

        if (karaokeWindow) {
            try {
                const image = await karaokeWindow.webContents.capturePage()
                const path = join(karaokeDir, `${step.label}.png`)
                writeFileSync(path, image.toPNG())
                log(`[capture] wrote ${path}`)
            } catch (err) {
                log(`[capture] karaoke ${step.label} failed: ${(err as Error).message}`)
                if (SMOKE_TEST_MODE) recordSmokeFailure(`karaoke capture ${step.label}`, err)
            }
        } else {
            log(`[capture] no karaoke window for step ${step.label}`)
            if (SMOKE_TEST_MODE) recordSmokeFailure(`missing karaoke window for ${step.label}`)
        }

        if (E2E_MODE && opWindow) {
            try {
                const image = await opWindow.webContents.capturePage()
                const path = join(operatorDir, `${step.label}-operator.png`)
                writeFileSync(path, image.toPNG())
                log(`[capture] wrote ${path}`)
            } catch (err) {
                log(`[capture] operator ${step.label} failed: ${(err as Error).message}`)
                if (SMOKE_TEST_MODE) recordSmokeFailure(`operator capture ${step.label}`, err)
            }
        } else if (SMOKE_TEST_MODE && E2E_MODE) {
            recordSmokeFailure(`missing operator window for ${step.label}`)
        }
    }
    if (E2E_MODE && (process.env.LC_CAPTURE_OPERATOR_TOOLS === "1" || SMOKE_TEST_MODE)) {
        const opWindow = operatorWindow && !operatorWindow.isDestroyed() ? operatorWindow : null
        if (opWindow) {
            await captureOperatorTool(opWindow, operatorDir, "05-arrangement-builder-operator", "[data-testid=\"edit-arrangement\"]")
            await captureOperatorTool(opWindow, operatorDir, "06-translation-editor-operator", "[data-testid=\"translate-song\"]")
            await captureOperatorTool(opWindow, operatorDir, "07-rehearsal-mode-operator", "[data-testid=\"toggle-rehearsal\"]")
            if (SMOKE_TEST_MODE) {
                await exerciseLearnSongWizard(opWindow)
            }
            if (process.env.LC_CAPTURE_OPERATOR_PERSISTENCE === "1" || SMOKE_TEST_MODE) {
                await exerciseOperatorPersistence(opWindow)
            }
            if (SMOKE_TEST_MODE) {
                await exerciseStaleOperatorPayloadGuards(opWindow)
            }
            if (process.env.LC_CAPTURE_REHEARSAL_CAPTURE === "1" || SMOKE_TEST_MODE) {
                await exerciseRehearsalCapture(opWindow)
            }
            if (process.env.LC_CAPTURE_PRODUCTION_LEARN_SONG === "1") {
                const productionDir = resolve(
                    "docs",
                    "qa-reports",
                    "evidence",
                    "ep05-operator-production-learn-song-2026-06-06"
                )
                mkdirSync(productionDir, { recursive: true })
                await exerciseProductionLearnSong(opWindow, productionDir)
            }
            if (process.env.LC_CAPTURE_PRODUCTION_LEARN_SONG_CANCEL === "1") {
                const productionDir = resolve(
                    "docs",
                    "qa-reports",
                    "evidence",
                    "ep05-operator-production-learn-song-2026-06-06"
                )
                mkdirSync(productionDir, { recursive: true })
                await exerciseProductionLearnSongCancellation(opWindow, productionDir)
            }
        } else {
            log("[capture] operator tool capture skipped: operator window missing")
            if (SMOKE_TEST_MODE) recordSmokeFailure("operator tool capture skipped: operator window missing")
        }
    }
    if (SMOKE_TEST_MODE && smokeFailures.length > 0) {
        process.exitCode = 1
        log(`[smoke] complete with ${smokeFailures.length} failure(s): ${smokeFailures.join(" | ")}`)
    } else if (SMOKE_TEST_MODE) {
        log("[smoke] complete: pass")
    }
    log("[capture] evidence run complete; quitting")
    setTimeout(() => app.quit(), 500)
}

async function captureOperatorTool(
    opWindow: BrowserWindow,
    operatorDir: string,
    label: string,
    selector: string
): Promise<void> {
    try {
        const opened = await opWindow.webContents.executeJavaScript(`
            (() => {
                const button = document.querySelector(${JSON.stringify(selector)});
                if (!(button instanceof HTMLButtonElement)) return "missing-button";
                button.click();
                return document.querySelector(".operator-tool-overlay") ? "opened" : "missing-overlay";
            })()
        `)
        if (opened !== "opened") {
            log(`[capture] ${label} failed to open: ${opened}`)
            if (SMOKE_TEST_MODE) recordSmokeFailure(`${label} failed to open`, opened)
            return
        }
        await new Promise<void>((r) => setTimeout(r, 500))
        const image = await opWindow.webContents.capturePage()
        const path = join(operatorDir, `${label}.png`)
        writeFileSync(path, image.toPNG())
        log(`[capture] wrote ${path}`)
        await opWindow.webContents.executeJavaScript(`
            (() => {
                const close = document.querySelector(".operator-tool-shell header button");
                if (close instanceof HTMLButtonElement) close.click();
            })()
        `)
        await new Promise<void>((r) => setTimeout(r, 250))
    } catch (err) {
        log(`[capture] ${label} failed: ${(err as Error).message}`)
        if (SMOKE_TEST_MODE) recordSmokeFailure(label, err)
    }
}

async function exerciseOperatorPersistence(opWindow: BrowserWindow): Promise<void> {
    try {
        const result = await opWindow.webContents.executeJavaScript(`
            (async () => {
                const click = (selector) => {
                    const element = document.querySelector(selector);
                    if (!(element instanceof HTMLButtonElement)) return false;
                    element.click();
                    return true;
                };
                const input = (selector, value) => {
                    const element = document.querySelector(selector);
                    if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) return false;
                    element.value = value;
                    element.dispatchEvent(new Event("input", { bubbles: true }));
                    return true;
                };
                const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

                if (!click("[data-testid='edit-arrangement']")) return "missing-arrange-button";
                await sleep(100);
                if (!input("[aria-label='Arrangement name']", "QA Persistence Arrangement")) return "missing-arrangement-name";
                if (!click("[aria-label='Available sections'] button")) return "missing-section-button";
                await sleep(50);
                const saveArrangement = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Save Arrangement"));
                if (!(saveArrangement instanceof HTMLButtonElement)) return "missing-save-arrangement";
                saveArrangement.click();
                await sleep(250);
                click(".operator-tool-shell header button");
                await sleep(100);

                if (!click("[data-testid='translate-song']")) return "missing-translate-button";
                await sleep(100);
                if (!input("textarea[aria-label^='Translation for']", "Sawubona mhlaba lokhu kuyi LyriCue")) return "missing-translation-textarea";
                const saveTranslation = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Save Translation"));
                if (!(saveTranslation instanceof HTMLButtonElement)) return "missing-save-translation";
                saveTranslation.click();
                await sleep(250);
                click(".operator-tool-shell header button");
                return "persisted";
            })()
        `)
        log(`[capture] operator persistence exercise result=${result}`)
        if (SMOKE_TEST_MODE && result !== "persisted") recordSmokeFailure("operator persistence exercise", result)
    } catch (err) {
        log(`[capture] operator persistence exercise failed: ${(err as Error).message}`)
        if (SMOKE_TEST_MODE) recordSmokeFailure("operator persistence exercise", err)
    }
}

async function exerciseStaleOperatorPayloadGuards(opWindow: BrowserWindow): Promise<void> {
    try {
        const result = await opWindow.webContents.executeJavaScript(`
            (async () => {
                const api = window.lyricueOperator;
                if (!api) return { status: "missing-bridge" };
                const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
                let latest = null;
                const unsub = api.subscribeState((state) => {
                    latest = state;
                });
                api.signalReady();
                for (let i = 0; i < 20 && !latest?.activeTimingMap; i += 1) {
                    await sleep(100);
                }
                if (!latest?.activeTimingMap) {
                    unsub();
                    return { status: "missing-active-map" };
                }
                const base = latest.activeTimingMap;
                const validSectionId = base.sections?.[0]?.id;
                if (!validSectionId) {
                    unsub();
                    return { status: "missing-section" };
                }
                const staleArrangement = {
                    id: "smoke-stale-arrangement",
                    name: "Smoke Stale Arrangement",
                    showId: base.showId,
                    isDefault: false,
                    sequence: [{ sectionId: "stale-section" }, { sectionId: validSectionId }],
                    createdAt: "2026-06-07T00:00:00.000Z",
                    updatedAt: "2026-06-07T00:00:00.000Z"
                };
                api.sendCommand({ kind: "saveArrangement", arrangement: staleArrangement });
                for (let i = 0; i < 20; i += 1) {
                    await sleep(100);
                    const saved = latest?.activeArrangements?.find?.((arrangement) => arrangement.id === "smoke-stale-arrangement");
                    if (saved) {
                        if (saved.sequence?.length !== 1 || saved.sequence?.[0]?.sectionId !== validSectionId) {
                            unsub();
                            return { status: "arrangement-stale-section-persisted", saved };
                        }
                        break;
                    }
                    if (i === 19) {
                        unsub();
                        return { status: "arrangement-not-observed" };
                    }
                }
                const staleTranslation = {
                    ...base,
                    bpm: 1,
                    sections: [{ id: "stale-section", type: "verse", label: "Stale", slideIndex: 0, startMs: 0, endMs: 1000, words: [], lines: [] }],
                    parallel: [{ language: "zu-ZA", sections: [{ sectionId: "stale-section", text: "Akufanele kugcinwe" }, { sectionId: validSectionId, text: "Sawubona" }] }]
                };
                api.sendCommand({ kind: "saveTranslation", timingMap: staleTranslation });
                for (let i = 0; i < 20; i += 1) {
                    await sleep(100);
                    const map = latest?.activeTimingMap;
                    const track = map?.parallel?.find?.((candidate) => candidate.language === "zu-ZA");
                    if (!track) continue;
                    unsub();
                    const staleSectionPersisted = map.sections?.some?.((section) => section.id === "stale-section") || track.sections?.some?.((section) => section.sectionId === "stale-section");
                    if (map.bpm === 1 || staleSectionPersisted) return { status: "translation-stale-payload-persisted", map };
                    const translated = track.sections?.find?.((section) => section.sectionId === validSectionId);
                    return translated?.text === "Sawubona" ? { status: "stale-payloads-guarded" } : { status: "translation-not-normalized", track };
                }
                unsub();
                return { status: "translation-not-observed" };
            })()
        `)
        log(`[capture] stale operator payload guard result=${JSON.stringify(result)}`)
        if (result?.status !== "stale-payloads-guarded") {
            recordSmokeFailure("stale operator payload guard", JSON.stringify(result))
        }
    } catch (err) {
        log(`[capture] stale operator payload guard failed: ${(err as Error).message}`)
        recordSmokeFailure("stale operator payload guard", err)
    }
}

async function exerciseProductionLearnSong(opWindow: BrowserWindow, evidenceDir: string): Promise<void> {
    const fixturePath = resolve("python-sidecar", "tests", "fixtures", "ep05-public-domain", "amazing-grace-48s.wav")
    const summaryPath = join(evidenceDir, "production-learn-song-summary.json")
    const startedAt = Date.now()
    let response: unknown = null
    let error: string | null = null

    try {
        const subscribeResult = await opWindow.webContents.executeJavaScript(`
            (() => {
                const host = window;
                const api = host.lyricueOperator;
                if (!api?.subscribeLearnSongProgress) return "missing-bridge";
                if (typeof host.__lyricueQaProgressUnsub === "function") host.__lyricueQaProgressUnsub();
                host.__lyricueQaProgress = [];
                host.__lyricueQaProgressUnsub = api.subscribeLearnSongProgress((progress) => {
                    host.__lyricueQaProgress.push(progress);
                });
                return "subscribed";
            })()
        `)
        if (subscribeResult !== "subscribed") throw new Error(`operator progress subscription failed: ${subscribeResult}`)

        response = await handleOperatorLearnSong({
            jobId: "operator-production-learn-song-qa",
            showId: "amazing-grace-operator-production",
            audioPath: fixturePath,
            lyrics: [
                {
                    id: "verse-1",
                    type: "verse",
                    label: "Verse 1",
                    text: "Amazing grace how sweet the sound that saved a wretch like me I once was lost but now am found was blind but now I see",
                    lines: [
                        "Amazing grace how sweet the sound",
                        "That saved a wretch like me",
                        "I once was lost but now am found",
                        "Was blind but now I see"
                    ]
                }
            ],
            options: {
                alignmentMode: "production",
                language: "en",
                detectSections: true,
                demucsModel: "htdemucs",
                whisperxModel: "small"
            }
        })
    } catch (err) {
        error = (err as Error).message
    }

    const progress = await opWindow.webContents.executeJavaScript(`
        (() => {
            const host = window;
            const progress = Array.isArray(host.__lyricueQaProgress) ? host.__lyricueQaProgress : [];
            if (typeof host.__lyricueQaProgressUnsub === "function") host.__lyricueQaProgressUnsub();
            host.__lyricueQaProgressUnsub = null;
            return progress;
        })()
    `)
    const elapsedMs = Date.now() - startedAt
    const responseRecord = response && typeof response === "object" ? (response as Record<string, unknown>) : null
    const timingMapResult = responseRecord?.timingMap ? validateTimingMap(responseRecord.timingMap) : null
    const timingMap = timingMapResult?.ok ? timingMapResult.value : null
    const words = timingMap ? timingMap.sections.flatMap((section) => section.words) : []
    const confidentWords = words.filter((word) => typeof word.confidence === "number" && word.confidence >= 0.5)
    const confidenceRatio = words.length > 0 ? confidentWords.length / words.length : 0
    const stages = Array.isArray(progress)
        ? progress
              .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>).stage : null))
              .filter((stage): stage is string => typeof stage === "string")
        : []
    const requiredStages = ["decode", "bpm", "demucs", "whisperx", "timing_map", "complete"]
    const missingStages = requiredStages.filter((stage) => !stages.includes(stage))
    const status = !error && timingMapResult?.ok && confidenceRatio >= 0.85 && missingStages.length === 0 ? "pass" : "fail"
    const summary = {
        status,
        elapsedMs,
        audioPath: fixturePath,
        progressStages: stages,
        missingStages,
        wordCount: words.length,
        confidentWordCount: confidentWords.length,
        confidenceRatio,
        error,
        validationErrors: timingMapResult && !timingMapResult.ok ? timingMapResult.errors : []
    }
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
    log(`[capture] production learn song exercise ${status}; wrote ${summaryPath}`)
    if (status !== "pass") recordSmokeFailure("production learn song exercise", error ?? JSON.stringify(summary))
}

async function exerciseProductionLearnSongCancellation(opWindow: BrowserWindow, evidenceDir: string): Promise<void> {
    const fixturePath = resolve("python-sidecar", "tests", "fixtures", "ep05-public-domain", "amazing-grace-48s.wav")
    const summaryPath = join(evidenceDir, "production-learn-song-cancel-summary.json")
    const jobId = "operator-production-learn-song-cancel-qa"
    const startedAt = Date.now()
    let cancelResult: unknown = null
    let error: string | null = null

    await opWindow.webContents.executeJavaScript(`
        (() => {
            const host = window;
            const api = host.lyricueOperator;
            if (typeof host.__lyricueQaProgressUnsub === "function") host.__lyricueQaProgressUnsub();
            host.__lyricueQaProgress = [];
            host.__lyricueQaProgressUnsub = api.subscribeLearnSongProgress((progress) => {
                host.__lyricueQaProgress.push(progress);
            });
        })()
    `)

    const learning = handleOperatorLearnSong({
        jobId,
        showId: "amazing-grace-operator-production-cancel",
        audioPath: fixturePath,
        lyrics: [
            {
                id: "verse-1",
                type: "verse",
                label: "Verse 1",
                text: "Amazing grace how sweet the sound that saved a wretch like me I once was lost but now am found was blind but now I see",
                lines: [
                    "Amazing grace how sweet the sound",
                    "That saved a wretch like me",
                    "I once was lost but now am found",
                    "Was blind but now I see"
                ]
            }
        ],
        options: {
            alignmentMode: "production",
            language: "en",
            detectSections: true,
            demucsModel: "htdemucs",
            whisperxModel: "small"
        }
    }).then(
        () => null,
        (err) => err as Error
    )

    const cancelStage = await waitForLearnSongProgressStage(opWindow, ["demucs", "whisperx"], 45_000)
    try {
        cancelResult = await handleOperatorCancelLearnSong({ jobId })
        const learningError = await learning
        error = learningError?.message ?? null
    } catch (err) {
        error = (err as Error).message
    }

    const progress = await readAndClearLearnSongProgress(opWindow)
    const elapsedMs = Date.now() - startedAt
    const cancelRecord = cancelResult && typeof cancelResult === "object" ? (cancelResult as Record<string, unknown>) : null
    const stages = Array.isArray(progress)
        ? progress
              .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>).stage : null))
              .filter((stage): stage is string => typeof stage === "string")
        : []
    const status = cancelRecord?.cancelled === true && !!error && error.includes("Sidecar exited during request 'learn_song'") ? "pass" : "fail"
    const summary = {
        status,
        elapsedMs,
        audioPath: fixturePath,
        cancelStage,
        cancelResult,
        progressStages: stages,
        error
    }
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
    log(`[capture] production learn song cancellation ${status}; wrote ${summaryPath}`)
    if (status !== "pass") recordSmokeFailure("production learn song cancellation", JSON.stringify(summary))
}

async function waitForLearnSongProgressStage(opWindow: BrowserWindow, stages: string[], timeoutMs: number): Promise<string | null> {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
        const matched = await opWindow.webContents.executeJavaScript(`
            (() => {
                const progress = Array.isArray(window.__lyricueQaProgress) ? window.__lyricueQaProgress : [];
                const wanted = ${JSON.stringify(stages)};
                const hit = progress.find((entry) => entry && typeof entry === "object" && wanted.includes(entry.stage));
                return hit?.stage ?? null;
            })()
        `)
        if (typeof matched === "string") return matched
        await new Promise<void>((resolve) => setTimeout(resolve, 500))
    }
    return null
}

async function readAndClearLearnSongProgress(opWindow: BrowserWindow): Promise<unknown> {
    return opWindow.webContents.executeJavaScript(`
        (() => {
            const host = window;
            const progress = Array.isArray(host.__lyricueQaProgress) ? host.__lyricueQaProgress : [];
            if (typeof host.__lyricueQaProgressUnsub === "function") host.__lyricueQaProgressUnsub();
            host.__lyricueQaProgressUnsub = null;
            return progress;
        })()
    `)
}

async function exerciseLearnSongWizard(opWindow: BrowserWindow): Promise<void> {
    try {
        const result = await opWindow.webContents.executeJavaScript(`
            (async () => {
                const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
                const clickButton = (text) => {
                    const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(text));
                    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
                    button.click();
                    return true;
                };
                const setInput = (selector, value) => {
                    const element = document.querySelector(selector);
                    if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) return false;
                    element.value = value;
                    element.dispatchEvent(new Event("input", { bubbles: true }));
                    return true;
                };

                if (!clickButton("Learn Song")) return "missing-learn-song-button";
                await sleep(150);
                if (!document.querySelector(".learn-song-overlay")) return "missing-learn-song-overlay";
                if (!setInput("input[placeholder='Optional song title']", "Smoke Harness Song")) return "missing-title-input";
                if (!setInput("textarea.lyrics-input", "[Verse 1]\\nSmoke harness line\\n\\n[Chorus]\\nReady for review")) return "missing-lyrics-input";
                await sleep(100);
                if (!clickButton("Next")) return "source-next-disabled";
                await sleep(100);
                if (!clickButton("Next")) return "sections-next-disabled";
                await sleep(100);
                if (!clickButton("Skip audio")) return "missing-skip-audio";
                await sleep(100);
                if (!clickButton("Create manual preview")) return "missing-manual-preview";
                await sleep(250);
                if (!document.body.textContent?.includes("2 sections ready for manual mode")) return "missing-preview-summary";
                if (!clickButton("Finish")) return "missing-finish";
                await sleep(150);
                return document.querySelector(".learn-song-overlay") ? "overlay-still-open" : "learn-song-complete";
            })()
        `)
        log(`[capture] learn song exercise result=${result}`)
        if (SMOKE_TEST_MODE && result !== "learn-song-complete") {
            recordSmokeFailure("learn song exercise", result)
        }
    } catch (err) {
        log(`[capture] learn song exercise failed: ${(err as Error).message}`)
        if (SMOKE_TEST_MODE) recordSmokeFailure("learn song exercise", err)
    }
}

async function exerciseRehearsalCapture(opWindow: BrowserWindow): Promise<void> {
    try {
        const result = await opWindow.webContents.executeJavaScript(`
            (async () => {
                const api = window.lyricueOperator;
                if (!api) return { status: "missing-bridge" };
                const started = await api.startRehearsalCapture({ sampleRate: 48000, channels: 1, deviceId: "qa-synthetic" });
                const sampleCount = 48000 * 2;
                const chunk = new Uint8Array(sampleCount * 2);
                for (let i = 0; i < sampleCount; i += 1) {
                    const sample = Math.round(Math.sin((i / 48000) * Math.PI * 2 * 440) * 12000);
                    chunk[i * 2] = sample & 0xff;
                    chunk[i * 2 + 1] = (sample >> 8) & 0xff;
                }
                await api.writeRehearsalChunk({ chunk });
                const stopped = await api.stopRehearsalCapture();
                if (stopped?.segmentation?.error) return { status: "captured-error", started, stopped };
                const segment = stopped?.segmentation?.segments?.[0];
                if (segment?.showId) {
                    api.sendCommand({
                        kind: "approveRehearsalSegment",
                        segment: { ...segment, sourceAudioPath: stopped.filePath },
                        skippedWordKeys: ["demo-1:1"]
                    });
                    await new Promise((resolve) => setTimeout(resolve, 400));
                    return { status: "captured-approved", started, stopped };
                }
                return { status: "captured-no-match", started, stopped };
            })()
        `)
        log(`[capture] rehearsal capture exercise result=${JSON.stringify(result)}`)
        if (SMOKE_TEST_MODE && result?.status !== "captured-approved" && result?.status !== "captured-no-match") {
            recordSmokeFailure("rehearsal capture exercise", JSON.stringify(result))
        }
    } catch (err) {
        log(`[capture] rehearsal capture exercise failed: ${(err as Error).message}`)
        if (SMOKE_TEST_MODE) recordSmokeFailure("rehearsal capture exercise", err)
    }
}

function stopTimers(): void {
    if (demoEngine) {
        demoEngine.stop()
        demoEngine = null
    }
    if (syntheticAudio) {
        syntheticAudio.stop()
        syntheticAudio = null
    }
    if (syncEngineStateUnsub) {
        syncEngineStateUnsub()
        syncEngineStateUnsub = null
    }
    if (setlistControllerUnsub) {
        setlistControllerUnsub()
        setlistControllerUnsub = null
    }
    if (setlistController) {
        setlistController.destroy()
        setlistController = null
    }
    if (syncEngineSyncFrameUnsub) {
        syncEngineSyncFrameUnsub()
        syncEngineSyncFrameUnsub = null
    }
    if (syncEngine) {
        syncEngine.stop()
        syncEngine = null
    }
    if (diagnosticsUnsub) {
        diagnosticsUnsub()
        diagnosticsUnsub = null
    }
    if (diagnostics) {
        diagnostics.stop()
        diagnostics = null
    }
    projectStorage = null
    timingMapStorage = null
    if (operatorStateBroadcastTimer) {
        clearTimeout(operatorStateBroadcastTimer)
        operatorStateBroadcastTimer = null
    }
    removeOperatorIpcHandlers()
    if (operatorWindow && !operatorWindow.isDestroyed()) {
        try {
            operatorWindow.close()
        } catch {
            // OS-level close races are fine
        }
    }
    operatorWindow = null
    operatorReady = false
    pendingOperatorState = null
    operatorSelectedDeviceId = E2E_MODE ? "synthetic-120bpm" : null
    lastOperatorStateBroadcastAt = 0
    lastTierForTransition = "auto"
    lastTransition = null
}

/**
 * App lifecycle.
 *
 * `app.whenReady()` is the canonical place to open windows. On macOS, the app stays
 * alive after the last window closes (so the user can reopen via the dock); on
 * Windows/Linux we quit on `window-all-closed`. `before-quit` cleans up timers and
 * adapter state so we don't leak listeners across the process boundary on shutdown.
 */
app.whenReady()
    .then(() => startSisterMode())
    .catch((err) => {
        log(`startup failed: ${(err as Error).message}`)
        app.quit()
    })

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", async () => {
    stopTimers()
    if (sidecarController) {
        try {
            await sidecarController.shutdown()
        } catch (err) {
            log(`sidecar shutdown failed: ${(err as Error).message}`)
        }
        sidecarController = null
    }
    if (adapter) {
        try {
            await adapter.stop()
        } catch (err) {
            log(`adapter.stop() failed during shutdown: ${(err as Error).message}`)
        }
        adapter = null
    }
})

// macOS: reopen the karaoke window if the user clicked the dock icon after all windows closed.
app.on("activate", () => {
    if (!adapter || !adapter.health.running) {
        startSisterMode().catch((err) => {
            log(`reopen failed: ${(err as Error).message}`)
        })
    } else if (E2E_MODE && (!operatorWindow || operatorWindow.isDestroyed())) {
        startOperatorWindow().catch((err) => {
            log(`operator reopen failed: ${(err as Error).message}`)
        })
    }
})
