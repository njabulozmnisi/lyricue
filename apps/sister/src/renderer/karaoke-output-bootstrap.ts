/**
 * Sister-mode karaoke-output renderer bootstrap.
 *
 * Vite bundles this file (per `apps/sister/vite.config.mjs`) into
 * `apps/sister/public/build/karaoke-output.bundle.js` as an IIFE — see vite.config.mjs
 * for the format rationale (`<script type="module">` doesn't load over `file://`).
 * The HTML at `apps/sister/public/karaoke-output.html` loads it via classic `<script>`.
 *
 * Responsibilities:
 *   1. Resolve the outputId for this window. The main process passes it via the URL
 *      hash (`#out=<id>`). Falls back to a stable placeholder so the walking-skeleton
 *      demo (which doesn't yet set the hash) keeps working.
 *   2. Mount `KaraokeOutput.svelte` (identical component in fork mode — ADR-16).
 *   3. Subscribe to envelopes from main via the preload-exposed `window.lyricueOutput`.
 *      Pass each envelope through to the Svelte component, which routes by channel.
 *   4. Signal renderer-ready so the adapter can flush any buffered frames. The adapter's
 *      `makeReadyLatch` handles the race where signalReady fires before the adapter
 *      subscribes (architecture.md ADR-16 / electron-browser-window-factory.ts).
 *   5. Clean up on `beforeunload` so a hot-reload doesn't leak listeners.
 *
 * Security: this bootstrap NEVER touches `ipcRenderer` directly. The preload script
 * (apps/sister/src/preload/karaoke-output-preload.cts) is the only IPC surface, scoped
 * via `contextBridge.exposeInMainWorld`.
 */

import KaraokeOutput from "@lyricue/ui/KaraokeOutput.svelte"

interface Envelope {
    channel: "LC_SYNC_FRAME" | "LC_LOAD_MAP" | string
    data: unknown
}

/**
 * Resolve the outputId from the URL hash (`#out=<id>`) when present, falling back to
 * a stable placeholder for legacy demo paths that don't set the hash.
 *
 * The placeholder is the same value the previous bootstrap baked in; preserving it
 * means the DemoSyncEngine + sister-mode main process keep working unchanged when
 * they don't yet propagate a real outputId (most pre-EP-09 paths).
 *
 * D10 (M1-partial QA carry-forward): hardcoded outputId. We now derive it at runtime
 * but keep the fallback so existing wiring isn't broken in one step. The producer side
 * (apps/sister/src/main.ts) can set `karaoke-output.html#out=<id>` in `loadFile` to
 * pass a real id; until that lands, fallback semantics are preserved.
 */
function resolveOutputId(): string {
    const hash = window.location.hash
    if (hash.startsWith("#")) {
        const params = new URLSearchParams(hash.slice(1))
        const fromHash = params.get("out")
        if (fromHash) return fromHash
    }
    return "lyricue-sister-output"
}

const root = document.getElementById("root")
if (!root) {
    document.body.innerText = "[lyricue] FATAL: #root element not found in karaoke-output.html"
    throw new Error("[lyricue] #root missing")
}

const outputId = resolveOutputId()

// Subscribe to the preload's IPC bridge. The preload exposes `window.lyricueOutput`
// per `karaoke-output-preload.cts`; without that exposure (e.g., contextIsolation
// misconfigured, preload script missing), we surface a clear error rather than
// silently failing.
const bridge = (
    window as unknown as {
        lyricueOutput?: {
            subscribe: (handler: (envelope: Envelope) => void) => () => void
            signalReady: () => void
        }
    }
).lyricueOutput

if (!bridge) {
    const msg =
        "[lyricue:sister-renderer] FATAL: window.lyricueOutput is not exposed. " +
        "Preload script may have failed or contextIsolation is misconfigured."
    console.error(msg)
    root.textContent = msg
    throw new Error(msg)
}

/**
 * Envelope dispatcher passed to the Svelte component. KaraokeOutput consumes
 * `LC_SYNC_FRAME` and `LC_LOAD_MAP` envelopes itself (EP-06 STORY-06.1); we just
 * forward whatever the bridge produces and let the component route.
 *
 * Lightweight diagnostic: the first envelope and every 60th frame thereafter are
 * logged. This is the contract the M1-partial QA pass uses to confirm "frames are
 * flowing" without DevTools.
 */
let envelopeHandler: ((envelope: Envelope) => void) | null = null
let frameCount = 0

const bridgeUnsub = bridge.subscribe((envelope) => {
    if (envelope?.channel === "LC_SYNC_FRAME") {
        frameCount++
        if (frameCount === 1 || frameCount % 60 === 0) {
            const f = (envelope.data ?? {}) as { wordIndex?: number; wordProgress?: number }
            console.info(
                `[lyricue:sister-renderer] frame #${frameCount} wordIndex=${String(f.wordIndex ?? "?")} progress=${(f.wordProgress ?? 0).toFixed(2)}`
            )
        }
    } else if (envelope?.channel === "LC_LOAD_MAP") {
        console.info(`[lyricue:sister-renderer] LC_LOAD_MAP received for outputId=${outputId}`)
    }
    envelopeHandler?.(envelope)
})

// Mount the KaraokeOutput component. The `subscribe` prop installs an envelope consumer;
// the component routes by `envelope.channel` and handles its own teardown on $destroy.
const component = new KaraokeOutput({
    target: root,
    props: {
        outputId,
        subscribe: (handler: (envelope: Envelope) => void) => {
            envelopeHandler = handler
            return () => {
                envelopeHandler = null
            }
        }
        // displaySettings: omitted — component falls back to DEFAULT_DISPLAY until
        // the main-process settings IPC bridge lands (EP-07 / EP-10).
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
        bridgeUnsub()
    } catch {
        // Already detached.
    }
    try {
        component.$destroy()
    } catch {
        // Component already destroyed.
    }
})
