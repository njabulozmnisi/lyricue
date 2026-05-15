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

import { app, BrowserWindow } from "electron"
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
import { createSyncEngine, type SyncEngine } from "@lyricue/core/sync"
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

const OUTPUT_ID = "lyricue-sister-output"

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
let syntheticAudio: SyntheticAudioDriver | null = null
let diagnostics: DiagnosticsObserverState | null = null
let diagnosticsUnsub: (() => void) | null = null

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

    // 5. Boot the SyncEngine's tick loop. From here, every 16ms tick advances the
    //    cursor, emits a SyncFrame, and the OutputAdapter ships it to the renderer.
    syncEngine.start()
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
    // When invoked from E2E mode, write to the EP-09 evidence dir so EP-06 evidence
    // (captured from the DemoSyncEngine path) stays intact and reviewers can A/B the
    // two engines. When invoked from DEMO mode, use the original EP-06 dir.
    const subDir = E2E_MODE
        ? "ep09-e2e-2026-05-15"
        : "ep06-karaoke-renderer-2026-05-15"
    const evidenceDir = resolve("docs", "qa-reports", "evidence", subDir)
    mkdirSync(evidenceDir, { recursive: true })

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
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
        if (!win) {
            log(`[capture] no window for step ${step.label}; aborting`)
            return
        }
        try {
            const image = await win.webContents.capturePage()
            const path = join(evidenceDir, `${step.label}.png`)
            writeFileSync(path, image.toPNG())
            log(`[capture] wrote ${path}`)
        } catch (err) {
            log(`[capture] step ${step.label} failed: ${(err as Error).message}`)
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
    }
})
