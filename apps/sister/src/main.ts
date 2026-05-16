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
import { mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve, join } from "node:path"
import { DEPLOYMENT_MODE } from "@lyricue/core/types"
import { DEMO_TIMING_MAP, DemoSyncEngine } from "@lyricue/core/output/test-utils"
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
import { OwnWindowOutputAdapter } from "./output/OwnWindowOutputAdapter.js"
import { createElectronBrowserWindowFactory } from "./output/electron-browser-window-factory.js"
import { createSyntheticAudioDriver, type SyntheticAudioDriver } from "./audio/synthetic-audio-driver.js"

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
const OPERATOR_STATE_BROADCAST_INTERVAL_MS = 200

/**
 * The karaoke output adapter and the demo engine that drives it (when demo mode is on).
 * STORY-02.3 opened one window; STORY-02.5 (diagnostics) and EP-06 (renderer polish)
 * build on this; EP-09 (sync engine) replaces the demo engine with the real Sync Engine.
 */
let adapter: OwnWindowOutputAdapter | null = null
let demoEngine: DemoSyncEngine | null = null
let syncEngine: SyncEngine | null = null
let syncEngineSyncFrameUnsub: (() => void) | null = null
let syncEngineSongCompleteUnsub: (() => void) | null = null
let syncEngineStateUnsub: (() => void) | null = null
let syntheticAudio: SyntheticAudioDriver | null = null
let diagnostics: DiagnosticsObserverState | null = null
let diagnosticsUnsub: (() => void) | null = null

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

    if (E2E_MODE) {
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
        adapter?.pushSyncFrame({ ...frame, outputId: OUTPUT_ID })
    })
    syncEngineSongCompleteUnsub = syncEngine.onSongComplete(() => {
        log("E2E: songComplete fired — looping demo by re-engaging at song start")
        // For the headless e2e demo we loop instead of waiting for the next song.
        // engageSync resets cursorRefTime to 0; no need to re-send the map (the
        // adapter has already buffered/flushed it once and the renderer still has it).
        syncEngine?.dispatch({ kind: "engageSync", wallTime: performance.now() })
    })

    // 3. Load the demo map + engage.
    //    The SyncEngine tracks the map for its own cursor lookup; the OutputAdapter
    //    needs LC_LOAD_MAP sent separately so the renderer can hydrate KaraokeOutput.
    //    The adapter buffers the load-map if the renderer isn't ready (D11 fix).
    syncEngine.loadSong({ map: DEMO_TIMING_MAP, arrangement: null, showId: DEMO_TIMING_MAP.showId })
    adapter.loadTimingMap(DEMO_TIMING_MAP, null)
    syncEngine.engageSync()

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
            // The demo currently has a single hard-coded song (DEMO_TIMING_MAP). Real
            // selection lands in EP-12 (Setlist & Continuous Playback). For now, the
            // command's only effect is to push state back so the panel shows the song
            // as 'active' — which the demo bootstrap does already.
            broadcastOperatorState()
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
        default:
            log(`operator command: unknown kind=${c.kind}`)
    }
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

/**
 * Build + send a full state snapshot to the operator renderer. When the renderer
 * hasn't signalled ready yet, the snapshot is buffered (D11-style pre-ready buffer).
 * EP-12's Setlist module will replace the hard-coded demo setlist with real state.
 */
function broadcastOperatorState(): void {
    lastOperatorStateBroadcastAt = performance.now()
    const seState = syncEngine?.snapshot() ?? null
    detectTierTransition(seState)

    // For now the demo always shows the DEMO_TIMING_MAP as the single setlist entry.
    // EP-12 replaces this with a real setlist loaded from disk.
    const setlist = [
        {
            id: DEMO_TIMING_MAP.showId,
            title: "Walking-Skeleton Demo",
            artist: "LyriCue",
            syncStatus: "learned" as const,
            bpm: DEMO_TIMING_MAP.bpm
        }
    ]

    const payload: Record<string, unknown> = {
        projectTitle: "Walking-Skeleton Demo",
        tier: seState?.tier ?? "auto",
        syncActive: seState?.runState === "running",
        activeSongId: seState?.activeShowId ?? null,
        nextSongTitle: null,
        setlist,
        selectedDeviceId: operatorSelectedDeviceId,
        audioDevices: [
            // Synthetic placeholder; EP-07 wiring will replace with enumerated devices.
            { deviceId: "synthetic-120bpm", label: "Synthetic 120 BPM (E2E demo)", kind: "audioinput", groupId: "demo" }
        ],
        lastTransition,
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
        { label: "04-post-loop-restart", waitMs: 1500 }
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
            }
        } else {
            log(`[capture] no karaoke window for step ${step.label}`)
        }

        if (E2E_MODE && opWindow) {
            try {
                const image = await opWindow.webContents.capturePage()
                const path = join(operatorDir, `${step.label}-operator.png`)
                writeFileSync(path, image.toPNG())
                log(`[capture] wrote ${path}`)
            } catch (err) {
                log(`[capture] operator ${step.label} failed: ${(err as Error).message}`)
            }
        }
    }
    log("[capture] evidence run complete; quitting")
    setTimeout(() => app.quit(), 500)
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
    if (syncEngineSyncFrameUnsub) {
        syncEngineSyncFrameUnsub()
        syncEngineSyncFrameUnsub = null
    }
    if (syncEngineSongCompleteUnsub) {
        syncEngineSongCompleteUnsub()
        syncEngineSongCompleteUnsub = null
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
