/**
 * Sister-mode operator-window renderer bootstrap.
 *
 * Mounts:
 *   - SetlistPanel (the primary live-operator UI)
 *   - TierChangeBanner (transient surface for tier transitions)
 *   - keyboard handler routing through `createShortcutHandler` from
 *     @lyricue/core/sync
 *
 * Subscribes to a single `OperatorState` envelope from the preload bridge — main
 * process broadcasts these on every SyncEngine state change. Dispatches `Command`
 * envelopes upstream when the operator interacts (select song / start sync / etc.).
 *
 * Vite builds this as an IIFE bundle at public/build/operator-window.bundle.js,
 * loaded by public/operator-window.html via classic `<script>`.
 *
 * Security: never touches ipcRenderer directly — only the preload's contextBridge.
 */

import SetlistPanel from "@lyricue/ui/SetlistPanel.svelte"
import TierChangeBanner from "@lyricue/ui/TierChangeBanner.svelte"
import LearnSongWizard from "@lyricue/ui/LearnSongWizard.svelte"
import ArrangementBuilder from "@lyricue/ui/ArrangementBuilder.svelte"
import TranslationEditor from "@lyricue/ui/TranslationEditor.svelte"
import RehearsalModePanel from "@lyricue/ui/RehearsalModePanel.svelte"
import RehearsalSummary from "@lyricue/ui/RehearsalSummary.svelte"
import RehearsalReviewPanel from "@lyricue/ui/RehearsalReviewPanel.svelte"
import { createShortcutHandler } from "@lyricue/core/sync"
import type { Arrangement, TimingMap } from "@lyricue/core/types"
import { shouldBypassOperatorShortcutTarget } from "./operator-shortcuts.js"

/**
 * Envelope shape mirroring the main-process broadcast. Mirrored loosely so adding
 * a new field on the main-process side doesn't break the renderer.
 */
interface OperatorState {
    projectTitle: string
    tier: "auto" | "timer" | "manual"
    syncActive: boolean
    activeSongId: string | null
    nextSongTitle: string | null
    activeTimingMapVariant: "studio" | "rehearsal"
    availableTimingMapVariants: Array<"studio" | "rehearsal">
    setlist: Array<{
        id: string
        title: string
        syncStatus: "learned" | "partial" | "not-learned"
        bpm: number | null
        artist?: string
    }>
    activeTimingMap: TimingMap | null
    activeArrangements: Arrangement[]
    activeArrangementId: string | null
    selectedDeviceId: string | null
    audioDevices: Array<{ deviceId: string; label: string; kind: "audioinput"; groupId: string }>
    lastTransition: {
        from: "auto" | "timer" | "manual"
        to: "auto" | "timer" | "manual"
        reason: string
        atWallMs: number
    } | null
    /** Per-shortcut bindings — sourced from SettingsStore. */
    shortcuts: {
        startSync: string
        nextSection: string
        prevSection: string
        toggleManual: string
        reEngageSync: string
    }
}

interface LearnSongDraftForHost {
    title: string
    sections: unknown[]
    audioFileName: string | null
    audioPath: string | null
}

interface RehearsalSegmentForUi {
    index: number
    showId?: string | null
    title?: string | null
    status: "matched" | "review" | "failed"
    confidence?: number
    startSec?: number
    endSec?: number
    sourceAudioPath?: string | null
}

interface RehearsalApprovalForUi {
    segment: RehearsalSegmentForUi
    skippedWordKeys: string[]
}

const DEFAULT_STATE: OperatorState = {
    projectTitle: "Walking-Skeleton Demo",
    tier: "auto",
    syncActive: false,
    activeSongId: null,
    nextSongTitle: null,
    activeTimingMapVariant: "studio",
    availableTimingMapVariants: ["studio"],
    setlist: [],
    activeTimingMap: null,
    activeArrangements: [],
    activeArrangementId: null,
    selectedDeviceId: null,
    audioDevices: [],
    lastTransition: null,
    shortcuts: {
        startSync: "Space",
        nextSection: "ArrowRight",
        prevSection: "ArrowLeft",
        toggleManual: "Escape",
        reEngageSync: "Enter"
    }
}

const root = document.getElementById("root")
if (!root) {
    document.body.innerText = "[lyricue] FATAL: #root element not found in operator-window.html"
    throw new Error("[lyricue] #root missing")
}

const bridgeCandidate = (
    window as unknown as {
        lyricueOperator?: {
            subscribeState: (handler: (state: unknown) => void) => () => void
            sendCommand: (command: unknown) => void
            learnSong: (request: unknown) => Promise<unknown>
            startRehearsalCapture: (request: unknown) => Promise<unknown>
            writeRehearsalChunk: (request: unknown) => Promise<unknown>
            stopRehearsalCapture: () => Promise<unknown>
            discardRehearsalCapture: () => Promise<unknown>
            signalReady: () => void
        }
    }
).lyricueOperator

if (!bridgeCandidate) {
    const msg =
        "[lyricue:operator-renderer] FATAL: window.lyricueOperator is not exposed. " +
        "Preload script failed or contextIsolation is misconfigured."
    console.error(msg)
    root.textContent = msg
    throw new Error(msg)
}
const bridge = bridgeCandidate

// ── Component composition ────────────────────────────────────────────────────

// TierChangeBanner gets its own slot at the top of the window — sits above SetlistPanel.
const bannerSlot = document.createElement("div")
bannerSlot.className = "banner-slot"
root.appendChild(bannerSlot)

const panelSlot = document.createElement("div")
panelSlot.style.flex = "1"
root.appendChild(panelSlot)

let currentState: OperatorState = DEFAULT_STATE
let panel: SetlistPanel | null = null
let learnSongWizard: LearnSongWizard | null = null
let arrangementBuilder: ArrangementBuilder | null = null
let arrangementOverlay: HTMLElement | null = null
let translationEditor: TranslationEditor | null = null
let translationOverlay: HTMLElement | null = null
let rehearsalPanel: RehearsalModePanel | null = null
let rehearsalSummary: RehearsalSummary | null = null
let rehearsalReviewPanel: RehearsalReviewPanel | null = null
let rehearsalOverlay: HTMLElement | null = null
let pendingRehearsalReview: { segment: RehearsalSegmentForUi; target: HTMLElement } | null = null
let rehearsalTimer: number | null = null
let rehearsalStartedAt = 0
let rehearsalAudioContext: AudioContext | null = null
let rehearsalSource: MediaStreamAudioSourceNode | null = null
let rehearsalProcessor: ScriptProcessorNode | null = null
let rehearsalSink: GainNode | null = null
let rehearsalStream: MediaStream | null = null
let rehearsalChunkChain: Promise<unknown> = Promise.resolve()
let rehearsalCaptureFilePath: string | null = null
let rehearsalCaptureRunning = false
let learnSongDraft: unknown = null

const banner = new TierChangeBanner({
    target: bannerSlot,
    props: { transition: null }
})

function mountPanel(): SetlistPanel {
    if (panel) return panel
    panel = new SetlistPanel({
        target: panelSlot,
        props: {
            projectTitle: currentState.projectTitle,
            tier: currentState.tier,
            lastTransition: currentState.lastTransition,
            setlist: currentState.setlist,
            activeSongId: currentState.activeSongId,
            nextSongTitle: currentState.nextSongTitle,
            activeTimingMapVariant: currentState.activeTimingMapVariant,
            availableTimingMapVariants: currentState.availableTimingMapVariants,
            syncActive: currentState.syncActive,
            selectedDeviceId: currentState.selectedDeviceId,
            enumerateDevices: async () => currentState.audioDevices
        }
    })

    panel.$on("start-sync", () => bridge.sendCommand({ kind: "engageSync" }))
    panel.$on("learn-song", () => openLearnSongWizard())
    panel.$on("select-song", (e: CustomEvent<{ songId: string }>) =>
        bridge.sendCommand({ kind: "selectSong", songId: e.detail.songId })
    )
    panel.$on("change-device", (e: CustomEvent<{ deviceId: string }>) =>
        bridge.sendCommand({ kind: "changeDevice", deviceId: e.detail.deviceId })
    )
    panel.$on("force-tier", (e: CustomEvent<{ tier: "auto" | "timer" | "manual" }>) =>
        bridge.sendCommand({ kind: "forceTier", tier: e.detail.tier })
    )
    panel.$on("edit-arrangement", () => openArrangementBuilder())
    panel.$on("translate-song", () => openTranslationEditor())
    panel.$on("publish-song", (e: CustomEvent<{ songId: string }>) =>
        bridge.sendCommand({ kind: "publishSong", songId: e.detail.songId })
    )
    panel.$on("toggle-rehearsal", () => openRehearsalPanel())
    panel.$on("select-timing-map-variant", (e: CustomEvent<{ variant: "studio" | "rehearsal" }>) =>
        bridge.sendCommand({ kind: "selectTimingMapVariant", variant: e.detail.variant })
    )
    return panel
}

function openArrangementBuilder(): void {
    if (arrangementBuilder) return
    if (!currentState.activeTimingMap) {
        window.alert("Select a learned song before editing an arrangement.")
        return
    }

    const { overlay, body } = openToolOverlay("Arrangement")
    arrangementOverlay = overlay
    arrangementBuilder = new ArrangementBuilder({
        target: body,
        props: {
            timingMap: currentState.activeTimingMap,
            arrangements: currentState.activeArrangements,
            activeArrangementId: currentState.activeArrangementId,
            onSave: (arrangement: Arrangement) => bridge.sendCommand({ kind: "saveArrangement", arrangement }),
            onSelectArrangement: (arrangement: Arrangement | null) =>
                bridge.sendCommand({
                    kind: "selectArrangement",
                    showId: currentState.activeTimingMap?.showId ?? null,
                    arrangementId: arrangement?.id ?? null
                })
        }
    })
}

function openTranslationEditor(): void {
    if (translationEditor) return
    if (!currentState.activeTimingMap) {
        window.alert("Select a learned song before editing translations.")
        return
    }

    const { overlay, body } = openToolOverlay("Translation")
    translationOverlay = overlay
    translationEditor = new TranslationEditor({
        target: body,
        props: {
            timingMap: currentState.activeTimingMap,
            language: "zu-ZA",
            onSave: (timingMap: TimingMap) => bridge.sendCommand({ kind: "saveTranslation", timingMap })
        }
    })
}

function openRehearsalPanel(): void {
    if (rehearsalPanel) return
    const { overlay, body } = openToolOverlay("Rehearsal")
    rehearsalOverlay = overlay
    const summarySlot = document.createElement("div")
    summarySlot.style.marginTop = "1rem"

    rehearsalPanel = new RehearsalModePanel({
        target: body,
        props: {
            elapsedMs: 0,
            level: 0,
            recording: false,
            onStart: () => void startRehearsalCapture(),
            onStop: () => void stopRehearsalCapture(summarySlot)
        }
    })
    body.appendChild(summarySlot)
}

async function startRehearsalCapture(): Promise<void> {
    if (rehearsalStream) return
    if (!navigator.mediaDevices?.getUserMedia) {
        window.alert("Audio capture is unavailable in this renderer.")
        return
    }
    rehearsalStartedAt = Date.now()
    rehearsalCaptureFilePath = null
    rehearsalPanel?.$set({ recording: true, elapsedMs: 0, level: 0 })
    if (rehearsalTimer !== null) window.clearInterval(rehearsalTimer)
    rehearsalTimer = window.setInterval(() => {
        const elapsedMs = Date.now() - rehearsalStartedAt
        rehearsalPanel?.$set({ elapsedMs, recording: true })
    }, 250)

    try {
        const deviceId = currentState.selectedDeviceId === "synthetic-120bpm" ? null : currentState.selectedDeviceId
        rehearsalStream = await navigator.mediaDevices.getUserMedia(
            deviceId ? { audio: { deviceId: { exact: deviceId } } } : { audio: true }
        )
        rehearsalAudioContext = new AudioContext({ sampleRate: 48_000 })
        rehearsalSource = rehearsalAudioContext.createMediaStreamSource(rehearsalStream)
        rehearsalProcessor = rehearsalAudioContext.createScriptProcessor(4096, 1, 1)
        rehearsalSink = rehearsalAudioContext.createGain()
        rehearsalSink.gain.value = 0
        const startResult = (await bridge.startRehearsalCapture({
            sampleRate: rehearsalAudioContext.sampleRate,
            channels: 1,
            deviceId
        })) as { filePath?: unknown }
        rehearsalCaptureFilePath = typeof startResult.filePath === "string" ? startResult.filePath : null
        rehearsalCaptureRunning = true
        rehearsalChunkChain = Promise.resolve()
        rehearsalProcessor.onaudioprocess = (event) => {
            const input = event.inputBuffer.getChannelData(0)
            let squareSum = 0
            const pcm = new Int16Array(input.length)
            for (let i = 0; i < input.length; i += 1) {
                const clamped = Math.max(-1, Math.min(1, input[i] ?? 0))
                squareSum += clamped * clamped
                pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
            }
            const rms = Math.sqrt(squareSum / Math.max(1, input.length))
            rehearsalPanel?.$set({
                level: Math.min(1, rms * 8),
                elapsedMs: Date.now() - rehearsalStartedAt,
                recording: true
            })
            const bytes = new Uint8Array(pcm.buffer.slice(0))
            rehearsalChunkChain = rehearsalChunkChain.then(() => bridge.writeRehearsalChunk({ chunk: bytes }))
        }
        rehearsalSource.connect(rehearsalProcessor)
        rehearsalProcessor.connect(rehearsalSink)
        rehearsalSink.connect(rehearsalAudioContext.destination)
    } catch (err) {
        await cleanupRehearsalAudio()
        if (rehearsalCaptureRunning) await bridge.discardRehearsalCapture().catch(() => undefined)
        rehearsalCaptureRunning = false
        rehearsalPanel?.$set({ recording: false, level: 0, elapsedMs: 0 })
        window.alert((err as Error).message || "Rehearsal capture failed to start.")
    }
}

async function stopRehearsalCapture(summarySlot: HTMLElement): Promise<void> {
    if (rehearsalTimer !== null) {
        window.clearInterval(rehearsalTimer)
        rehearsalTimer = null
    }
    const elapsedMs = rehearsalStartedAt ? Date.now() - rehearsalStartedAt : 0
    await cleanupRehearsalAudio()
    try {
        await rehearsalChunkChain
    } catch (err) {
        await bridge.discardRehearsalCapture().catch(() => undefined)
        rehearsalCaptureRunning = false
        rehearsalPanel?.$set({ recording: false, elapsedMs, level: 0 })
        window.alert((err as Error).message || "Rehearsal capture failed while writing audio chunks.")
        return
    }
    const result = (await bridge.stopRehearsalCapture()) as {
        filePath?: unknown
        bytesWritten?: unknown
        elapsedMs?: unknown
        segmentation?: unknown
    }
    rehearsalCaptureRunning = false
    const filePath = typeof result.filePath === "string" ? result.filePath : rehearsalCaptureFilePath
    const bytesWritten = typeof result.bytesWritten === "number" ? result.bytesWritten : 0
    const segments = normalizeRehearsalSegments(result.segmentation, filePath)
    rehearsalPanel?.$set({ recording: false, elapsedMs, level: 0 })
    rehearsalSummary?.$destroy()
    rehearsalSummary = new RehearsalSummary({
        target: summarySlot,
        props: {
            segments: [
                ...(segments.length > 0
                    ? segments
                    : [
                          {
                              index: 0,
                              title: `${formatBytes(bytesWritten)} WAV saved${filePath ? ` to ${filePath}` : ""}; segmentation needs review`,
                              status: "review" as const,
                              confidence: 0
                          }
                      ])
            ],
            onReview: (segment: RehearsalSegmentForUi) => openRehearsalReview(segment, summarySlot)
        }
    })
}

function normalizeRehearsalSegments(value: unknown, sourceAudioPath: string | null): RehearsalSegmentForUi[] {
    if (!value || typeof value !== "object") return []
    const maybeSegments = (value as { segments?: unknown }).segments
    if (!Array.isArray(maybeSegments)) return []
    return maybeSegments.map((segment, fallbackIndex): RehearsalSegmentForUi => {
        const row = segment && typeof segment === "object" ? (segment as Record<string, unknown>) : {}
        const status = row.status === "matched" || row.status === "review" ? row.status : "failed"
        return {
            index: typeof row.index === "number" ? row.index : fallbackIndex,
            showId: typeof row.showId === "string" ? row.showId : null,
            title: typeof row.title === "string" ? row.title : `Segment ${fallbackIndex + 1}`,
            status,
            ...(typeof row.startSec === "number" ? { startSec: row.startSec } : {}),
            ...(typeof row.endSec === "number" ? { endSec: row.endSec } : {}),
            ...(sourceAudioPath ? { sourceAudioPath } : {}),
            ...(typeof row.confidence === "number" ? { confidence: row.confidence } : {})
        }
    })
}

function openRehearsalReview(segment: RehearsalSegmentForUi, target: HTMLElement): void {
    if (!segment.showId) {
        window.alert("This rehearsal segment needs a song match before it can be approved.")
        return
    }
    if (!currentState.activeTimingMap || currentState.activeTimingMap.showId !== segment.showId) {
        pendingRehearsalReview = { segment, target }
        bridge.sendCommand({ kind: "selectSong", songId: segment.showId })
        return
    }
    const timingMap =
        currentState.activeTimingMap && currentState.activeTimingMap.showId === segment.showId
            ? currentState.activeTimingMap
            : null
    if (!timingMap) {
        window.alert("Select the matched song before approving this rehearsal segment.")
        return
    }
    rehearsalSummary?.$destroy()
    rehearsalSummary = null
    rehearsalReviewPanel?.$destroy()
    rehearsalReviewPanel = new RehearsalReviewPanel({
        target,
        props: {
            timingMap,
            segment,
            onCancel: () => {
                rehearsalReviewPanel?.$destroy()
                rehearsalReviewPanel = null
            },
            onApprove: (payload: RehearsalApprovalForUi) => {
                bridge.sendCommand({ kind: "approveRehearsalSegment", ...payload })
                rehearsalReviewPanel?.$destroy()
                rehearsalReviewPanel = null
                window.alert("Rehearsal timing map approved.")
            }
        }
    })
}

async function cleanupRehearsalAudio(): Promise<void> {
    if (rehearsalProcessor) {
        rehearsalProcessor.onaudioprocess = null
        rehearsalProcessor.disconnect()
        rehearsalProcessor = null
    }
    if (rehearsalSink) {
        rehearsalSink.disconnect()
        rehearsalSink = null
    }
    if (rehearsalSource) {
        rehearsalSource.disconnect()
        rehearsalSource = null
    }
    if (rehearsalStream) {
        for (const track of rehearsalStream.getTracks()) track.stop()
        rehearsalStream = null
    }
    if (rehearsalAudioContext) {
        await rehearsalAudioContext.close().catch(() => undefined)
        rehearsalAudioContext = null
    }
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function openToolOverlay(title: string): { overlay: HTMLElement; body: HTMLElement } {
    const overlay = document.createElement("div")
    overlay.className = "operator-tool-overlay"
    overlay.style.position = "fixed"
    overlay.style.inset = "0"
    overlay.style.zIndex = "110"
    overlay.style.overflow = "auto"
    overlay.style.background = "rgba(0, 0, 0, 0.76)"
    overlay.style.padding = "1rem"

    const shell = document.createElement("section")
    shell.className = "operator-tool-shell"
    shell.style.margin = "0 auto"
    shell.style.maxWidth = "980px"
    shell.style.borderRadius = "8px"
    shell.style.background = "#f8fafc"
    shell.style.color = "#0f172a"
    shell.style.padding = "1rem"
    shell.style.boxShadow = "0 20px 60px rgba(0, 0, 0, 0.45)"

    const header = document.createElement("header")
    header.style.display = "flex"
    header.style.alignItems = "center"
    header.style.justifyContent = "space-between"
    header.style.gap = "1rem"
    header.style.marginBottom = "1rem"

    const heading = document.createElement("h2")
    heading.textContent = title
    heading.style.margin = "0"
    heading.style.fontSize = "1rem"

    const close = document.createElement("button")
    close.type = "button"
    close.textContent = "Close"
    close.style.font = "inherit"
    close.style.padding = "0.45rem 0.7rem"
    close.style.border = "1px solid #94a3b8"
    close.style.borderRadius = "6px"
    close.style.background = "#fff"
    close.addEventListener("click", () => closeToolOverlays())

    const body = document.createElement("div")
    header.append(heading, close)
    shell.append(header, body)
    overlay.appendChild(shell)
    document.body.appendChild(overlay)
    return { overlay, body }
}

function closeToolOverlays(): void {
    try {
        arrangementBuilder?.$destroy()
    } catch {
        // already destroyed
    }
    arrangementBuilder = null
    arrangementOverlay?.remove()
    arrangementOverlay = null

    try {
        translationEditor?.$destroy()
    } catch {
        // already destroyed
    }
    translationEditor = null
    translationOverlay?.remove()
    translationOverlay = null

    if (rehearsalTimer !== null) {
        window.clearInterval(rehearsalTimer)
        rehearsalTimer = null
    }
    void cleanupRehearsalAudio()
    if (rehearsalCaptureRunning) {
        rehearsalCaptureRunning = false
        void bridge.discardRehearsalCapture().catch(() => undefined)
    }
    try {
        rehearsalReviewPanel?.$destroy()
    } catch {
        // already destroyed
    }
    rehearsalReviewPanel = null
    pendingRehearsalReview = null
    try {
        rehearsalSummary?.$destroy()
    } catch {
        // already destroyed
    }
    rehearsalSummary = null
    try {
        rehearsalPanel?.$destroy()
    } catch {
        // already destroyed
    }
    rehearsalPanel = null
    rehearsalOverlay?.remove()
    rehearsalOverlay = null
}

function openLearnSongWizard(): void {
    if (learnSongWizard) return

    const overlay = document.createElement("div")
    overlay.className = "learn-song-overlay"
    overlay.style.position = "fixed"
    overlay.style.inset = "0"
    overlay.style.zIndex = "100"
    overlay.style.overflow = "auto"
    overlay.style.background = "rgba(0, 0, 0, 0.72)"
    overlay.style.padding = "1rem"
    document.body.appendChild(overlay)

    learnSongWizard = new LearnSongWizard({
        target: overlay,
        props: {
            initialDraft: learnSongDraft && typeof learnSongDraft === "object" ? learnSongDraft : undefined,
            confirmCancel: () => window.confirm("Discard the current song-learning draft?"),
            learnSong: async (draft: LearnSongDraftForHost) => learnSongFromSidecar(draft)
        }
    })
    learnSongWizard.$on("draft-change", (e: CustomEvent<{ draft: unknown }>) => {
        learnSongDraft = e.detail.draft
    })
    learnSongWizard.$on("cancel", closeLearnSongWizard)
    learnSongWizard.$on("complete", (e: CustomEvent<{ draft: unknown }>) => {
        learnSongDraft = e.detail.draft
        closeLearnSongWizard()
    })
}

async function learnSongFromSidecar(draft: LearnSongDraftForHost): Promise<{ progressLabel: string; timingMap?: unknown }> {
    if (!draft.audioPath) return { progressLabel: "Manual preview ready" }
    const result = await bridge.learnSong({
        jobId: `operator-${Date.now()}`,
        showId: slugShowId(draft.title || draft.audioFileName || "learned-song"),
        title: draft.title,
        audioPath: draft.audioPath,
        lyrics: draft.sections,
        options: {
            language: "en",
            detectSections: true
        }
    })
    if (!result || typeof result !== "object") {
        throw new Error("Song learning returned an invalid response.")
    }
    const payload = result as { timingMap?: unknown; diagnostics?: { alignmentMode?: string } }
    return {
        progressLabel:
            payload.diagnostics?.alignmentMode === "deterministic"
                ? "Timing map ready for review (deterministic alignment)"
                : "Timing map ready for review",
        timingMap: payload.timingMap
    }
}

function slugShowId(input: string): string {
    return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "learned-song"
}

function closeLearnSongWizard(): void {
    const overlay = document.querySelector(".learn-song-overlay")
    try {
        learnSongWizard?.$destroy()
    } catch {
        // already destroyed
    }
    learnSongWizard = null
    overlay?.remove()
}

// ── Keyboard shortcuts ───────────────────────────────────────────────────────

const handleKey = createShortcutHandler({
    getBindings: () => currentState.shortcuts,
    callbacks: {
        onStartSync: () => bridge.sendCommand({ kind: "engageSync" }),
        onNextSection: () => bridge.sendCommand({ kind: "nextSection" }),
        onPrevSection: () => bridge.sendCommand({ kind: "prevSection" }),
        onToggleManual: () => bridge.sendCommand({ kind: "toggleManual" }),
        onReEngageSync: () => bridge.sendCommand({ kind: "reEngageSync" })
    },
    // Always enabled in the operator window — the operator never expects a key to
    // fall through to something else here (unlike the sleeve-guard in fork mode).
    getEnabled: () => true
})

function onKeyDown(event: KeyboardEvent): void {
    if (shouldBypassOperatorShortcutTarget(event.target)) return
    const action = handleKey({
        code: event.code,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey
    })
    if (action) {
        // Prevent default behaviour for matched keys — Space shouldn't scroll the page.
        event.preventDefault()
    }
}
window.addEventListener("keydown", onKeyDown)

// ── State subscription ──────────────────────────────────────────────────────

const stateUnsub = bridge.subscribeState((raw) => {
    if (!raw || typeof raw !== "object") return
    const incoming = raw as Partial<OperatorState>
    // Merge into the current state with defensive defaults — a partial push from
    // main shouldn't blank existing fields.
    const next: OperatorState = {
        ...currentState,
        ...incoming,
        // Nested objects need merging rather than replacement when they're undefined.
        shortcuts: incoming.shortcuts ? { ...currentState.shortcuts, ...incoming.shortcuts } : currentState.shortcuts
    }

    const tierChanged = next.tier !== currentState.tier
    const transitionChanged = next.lastTransition !== currentState.lastTransition
    currentState = next

    const mountedPanel = mountPanel()
    mountedPanel.$set({
        projectTitle: next.projectTitle,
        tier: next.tier,
        lastTransition: next.lastTransition,
        setlist: next.setlist,
        activeSongId: next.activeSongId,
        nextSongTitle: next.nextSongTitle,
        activeTimingMapVariant: next.activeTimingMapVariant,
        availableTimingMapVariants: next.availableTimingMapVariants,
        syncActive: next.syncActive,
        selectedDeviceId: next.selectedDeviceId
    })
    if (next.activeTimingMap) {
        arrangementBuilder?.$set({
            timingMap: next.activeTimingMap,
            arrangements: next.activeArrangements,
            activeArrangementId: next.activeArrangementId
        })
        translationEditor?.$set({ timingMap: next.activeTimingMap })
    }
    if (pendingRehearsalReview?.segment.showId && next.activeTimingMap?.showId === pendingRehearsalReview.segment.showId) {
        const pending = pendingRehearsalReview
        pendingRehearsalReview = null
        openRehearsalReview(pending.segment, pending.target)
    }

    // Fire the banner only when the transition actually changed identity AND it's
    // not the very first state push (boot doesn't count as a transition).
    if (transitionChanged && tierChanged) {
        banner.$set({ transition: next.lastTransition })
    }
})

// Tell main we're ready. The main process flushes any buffered initial state.
bridge.signalReady()

// Hot-reload cleanup.
window.addEventListener("beforeunload", () => {
    try {
        stateUnsub()
    } catch {
        // already detached
    }
    window.removeEventListener("keydown", onKeyDown)
    try {
        panel?.$destroy()
    } catch {
        // already destroyed
    }
    closeLearnSongWizard()
    closeToolOverlays()
    try {
        banner.$destroy()
    } catch {
        // already destroyed
    }
})
