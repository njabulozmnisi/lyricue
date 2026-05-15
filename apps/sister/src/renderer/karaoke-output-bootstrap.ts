/**
 * Sister-mode karaoke-output renderer bootstrap.
 *
 * Vite bundles this file (per `apps/sister/vite.config.mjs`) into
 * `apps/sister/public/build/karaoke-output.bundle.js` as an IIFE — see vite.config.mjs
 * for the format rationale (`<script type="module">` doesn't load over `file://`).
 * The HTML at `apps/sister/public/karaoke-output.html` loads it via classic `<script>`.
 *
 * Responsibilities:
 *   1. Mount `KaraokeOutput.svelte` (identical to fork mode — that's the point of
 *      ADR-16's adapter abstraction).
 *   2. Subscribe to envelopes from main via the preload-exposed `window.lyricueOutput`.
 *      Dispatch by `envelope.channel` to the Svelte component's frame consumer.
 *   3. Signal renderer-ready so the adapter can flush any buffered frames. The adapter's
 *      `makeReadyLatch` handles the race where signalReady fires before the adapter
 *      subscribes (architecture.md ADR-16 / electron-browser-window-factory.ts).
 *   4. Clean up on `beforeunload` so a hot-reload doesn't leak listeners.
 *
 * Security: this bootstrap NEVER touches `ipcRenderer` directly. The preload script
 * (apps/sister/src/preload/karaoke-output-preload.ts) is the only IPC surface, scoped
 * via `contextBridge.exposeInMainWorld`.
 */

import KaraokeOutput from "@lyricue/ui/KaraokeOutput.svelte"

/**
 * Envelope shape mirroring what the adapter sends. The renderer's TS types should be
 * compatible with this — we keep the type loose here because the preload is shared
 * across versions of the renderer and we don't want a missed update to break the bridge.
 */
interface Envelope {
    channel: "LC_SYNC_FRAME" | "LC_LOAD_MAP" | string
    data: unknown
}

/**
 * Minimal SyncFrame shape — kept inline so the bootstrap has no TS dependency on
 * @lyricue/core types at compile time. The shape MUST match SyncFrame in
 * @lyricue/core/output exactly; any drift here would silently break frame delivery.
 */
interface SyncFrame {
    outputId: string
    slideIndex: number
    wordIndex: number
    wordProgress: number
    tier: "auto" | "timer" | "manual"
    vad: "active" | "silent"
}

const root = document.getElementById("root")
if (!root) {
    // Without a #root element, there's nowhere to mount. Loud error so a missing HTML
    // template doesn't fail silently.
    document.body.innerText = "[lyricue] FATAL: #root element not found in karaoke-output.html"
    throw new Error("[lyricue] #root missing")
}

/**
 * Placeholder outputId for the walking-skeleton. The output's identity is communicated
 * via `LC_LOAD_MAP` envelopes (which carry a `showId` and an `outputId`). Until that
 * arrives we use this stable placeholder so the Svelte component's
 * `frame.outputId === outputId` filter accepts incoming frames.
 *
 * EP-04 STORY-04.3 replaces this with the real outputId resolved via IPC at startup,
 * once we wire the main process → renderer identity handshake.
 */
const PLACEHOLDER_OUTPUT_ID = "lyricue-sister-output"

/**
 * Svelte subscriber dispatcher. KaraokeOutput accepts a `subscribe` prop that returns
 * a SyncFrame consumer; we adapt the preload envelope dispatcher into that contract.
 *
 * The frame counter is intentionally retained for STORY-02.5 (diagnostics): the first
 * frame and every 60th frame thereafter are logged so an operator can confirm "frames
 * are flowing" without attaching DevTools. EP-02 STORY-02.5 will surface this in the
 * UI diagnostics panel; until then, console.info is the contract.
 */
let frameHandler: ((frame: SyncFrame) => void) | null = null
let frameCount = 0

function dispatchEnvelope(envelope: Envelope): void {
    if (envelope.channel === "LC_SYNC_FRAME") {
        frameCount++
        if (frameCount === 1 || frameCount % 60 === 0) {
            const f = envelope.data as SyncFrame
            console.info(
                `[lyricue:sister-renderer] frame #${frameCount} wordIndex=${f.wordIndex} progress=${f.wordProgress.toFixed(2)}`
            )
        }
        frameHandler?.(envelope.data as SyncFrame)
    } else if (envelope.channel === "LC_LOAD_MAP") {
        // STORY-02.3 stub: KaraokeOutput doesn't yet consume timing maps directly
        // (full timing-map rendering lands in EP-06). For the walking skeleton we
        // simply ignore LOAD_MAP. The frames themselves carry enough state to drive
        // the placeholder visualisation.
    } else {
        console.warn(`[lyricue:sister-renderer] unknown envelope channel: ${envelope.channel}`)
    }
}

// Subscribe to the preload's IPC bridge. The preload exposes `window.lyricueOutput`
// per `karaoke-output-preload.ts`; without that exposure (e.g., contextIsolation
// misconfigured, preload script missing), we surface a clear error rather than
// silently failing.
const bridge = (window as unknown as { lyricueOutput?: {
    subscribe: (handler: (envelope: Envelope) => void) => () => void
    signalReady: () => void
}}).lyricueOutput

if (!bridge) {
    const msg =
        "[lyricue:sister-renderer] FATAL: window.lyricueOutput is not exposed. " +
        "Preload script may have failed or contextIsolation is misconfigured."
    console.error(msg)
    root.textContent = msg
    throw new Error(msg)
}

const unsubscribe = bridge.subscribe(dispatchEnvelope)

// Mount the KaraokeOutput component. The `subscribe` prop receives a function that
// installs a SyncFrame consumer; KaraokeOutput holds the consumer and unsubscribes
// on its own destroy. We return a tear-down that clears `frameHandler` so a re-mount
// (or hot-reload) doesn't leave a dangling reference to the previous component.
const component = new KaraokeOutput({
    target: root,
    props: {
        outputId: PLACEHOLDER_OUTPUT_ID,
        subscribe: (handler: (frame: SyncFrame) => void) => {
            frameHandler = handler
            return () => {
                frameHandler = null
            }
        }
    }
})

// Tell main we're ready. After this, the adapter flushes any buffered frames.
// The adapter's ready-latch (electron-browser-window-factory.ts `makeReadyLatch`)
// handles the case where this fires before the adapter subscribes to the event.
bridge.signalReady()

// Hot-reload / hard-reload cleanup. Detaches IPC listeners and destroys the Svelte
// component so a fresh mount on reload doesn't leak.
window.addEventListener("beforeunload", () => {
    try {
        unsubscribe()
    } catch {
        // Already detached.
    }
    try {
        component.$destroy()
    } catch {
        // Component already destroyed.
    }
})
