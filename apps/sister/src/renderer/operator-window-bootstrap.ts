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

const DEFAULT_STATE: OperatorState = {
    projectTitle: "Walking-Skeleton Demo",
    tier: "auto",
    syncActive: false,
    activeSongId: null,
    nextSongTitle: null,
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
    panel.$on("toggle-rehearsal", () => bridge.sendCommand({ kind: "toggleRehearsal" }))
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
