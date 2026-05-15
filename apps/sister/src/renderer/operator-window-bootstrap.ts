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
import { createShortcutHandler } from "@lyricue/core/sync"

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

const DEFAULT_STATE: OperatorState = {
    projectTitle: "Walking-Skeleton Demo",
    tier: "auto",
    syncActive: false,
    activeSongId: null,
    nextSongTitle: null,
    setlist: [],
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

const bridge = (
    window as unknown as {
        lyricueOperator?: {
            subscribeState: (handler: (state: unknown) => void) => () => void
            sendCommand: (command: unknown) => void
            signalReady: () => void
        }
    }
).lyricueOperator

if (!bridge) {
    const msg =
        "[lyricue:operator-renderer] FATAL: window.lyricueOperator is not exposed. " +
        "Preload script failed or contextIsolation is misconfigured."
    console.error(msg)
    root.textContent = msg
    throw new Error(msg)
}

// ── Component composition ────────────────────────────────────────────────────

// TierChangeBanner gets its own slot at the top of the window — sits above SetlistPanel.
const bannerSlot = document.createElement("div")
bannerSlot.className = "banner-slot"
root.appendChild(bannerSlot)

const panelSlot = document.createElement("div")
panelSlot.style.flex = "1"
root.appendChild(panelSlot)

let currentState: OperatorState = DEFAULT_STATE

const banner = new TierChangeBanner({
    target: bannerSlot,
    props: { transition: null }
})

const panel = new SetlistPanel({
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
        // SetlistPanel's enumerate callback wraps the audioDevices coming via state.
        // The picker calls this on mount and on Refresh; we return the latest list.
        enumerateDevices: async () => currentState.audioDevices
    }
})

// Wire SetlistPanel events → command envelopes.
panel.$on("start-sync", () => bridge.sendCommand({ kind: "engageSync" }))
panel.$on("select-song", (e: CustomEvent<{ songId: string }>) =>
    bridge.sendCommand({ kind: "selectSong", songId: e.detail.songId })
)
panel.$on("change-device", (e: CustomEvent<{ deviceId: string }>) =>
    bridge.sendCommand({ kind: "changeDevice", deviceId: e.detail.deviceId })
)
panel.$on("force-tier", (e: CustomEvent<{ tier: "auto" | "timer" | "manual" }>) =>
    bridge.sendCommand({ kind: "forceTier", tier: e.detail.tier })
)

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

    panel.$set({
        projectTitle: next.projectTitle,
        tier: next.tier,
        lastTransition: next.lastTransition,
        setlist: next.setlist,
        activeSongId: next.activeSongId,
        nextSongTitle: next.nextSongTitle,
        syncActive: next.syncActive,
        selectedDeviceId: next.selectedDeviceId
    })

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
        panel.$destroy()
    } catch {
        // already destroyed
    }
    try {
        banner.$destroy()
    } catch {
        // already destroyed
    }
})
