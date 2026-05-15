/**
 * Karaoke-output preload script.
 *
 * Runs in Electron's privileged preload context with `contextIsolation: true` and
 * exposes a narrow surface to the renderer's Svelte code via `contextBridge`.
 *
 * Security model (per Electron's contextIsolation best practices + NFR2.1 zero-crash):
 *   - The renderer NEVER touches `ipcRenderer` directly.
 *   - We expose exactly two functions: subscribe (main → renderer) and signalReady
 *     (renderer → main).
 *   - Subscribe takes a callback. Cleanup is via the returned unsubscribe handle so
 *     the renderer can detach listeners on hot-reload without leaking.
 *   - signalReady is fire-and-forget; the renderer cannot read its result.
 *
 * Wire shape:
 *   - Inbound on the OWN_WINDOW_CHANNEL = "lyricue:output" channel.
 *     Payload envelope: { channel: "LC_SYNC_FRAME" | "LC_LOAD_MAP", data: ... }
 *   - Outbound on the OWN_WINDOW_READY_EVENT = "lyricue:output:ready" event.
 *     No payload.
 *
 * Module format note: preload scripts run in a special context. Electron supports both
 * CommonJS (.js with no "type":"module") and ESM (.mjs) preloads, but the most portable
 * pattern across Electron versions and security configurations is CommonJS. This file
 * uses CJS-style imports (compiled by a dedicated tsconfig — see tsconfig.preload.json)
 * so it emits as require()/module.exports regardless of the workspace's "type": "module".
 *
 * The constants are duplicated here rather than imported from the adapter to avoid
 * pulling Electron + Node into the preload bundle in unexpected ways. The values must
 * match `apps/sister/src/output/OwnWindowOutputAdapter.ts` exactly.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports -- preload is CJS by design
const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron")

const OWN_WINDOW_CHANNEL = "lyricue:output"
const OWN_WINDOW_READY_EVENT = "lyricue:output:ready"

/**
 * Envelope shape mirroring what the adapter sends. The renderer's TS types should be
 * compatible with this — we keep the type loose here because the preload is shared
 * across versions of the renderer and we don't want a missed update to break the bridge.
 */
interface OutputEnvelope {
    channel: string
    data: unknown
}

type EnvelopeHandler = (envelope: OutputEnvelope) => void

contextBridge.exposeInMainWorld("lyricueOutput", {
    /**
     * Subscribe to envelopes from main. The handler is invoked once per message.
     * Returns an unsubscribe function — call it on teardown to detach the listener.
     *
     * Defensive: the wrapped listener swallows any handler-thrown errors so a bad
     * Svelte component can't break the IPC bridge.
     */
    subscribe(handler: EnvelopeHandler): () => void {
        const wrapped = (_event: Electron.IpcRendererEvent, envelope: OutputEnvelope) => {
            try {
                handler(envelope)
            } catch (err) {
                // The renderer can hot-reload buggy code; we don't want a thrown
                // exception to take out the listener wiring with it.
                console.error("[lyricue:preload] handler threw:", err)
            }
        }
        ipcRenderer.on(OWN_WINDOW_CHANNEL, wrapped)
        return () => {
            ipcRenderer.off(OWN_WINDOW_CHANNEL, wrapped)
        }
    },

    /**
     * Tell main the renderer has mounted and is ready to receive frames. The adapter
     * uses this to flush any buffered frames pushed before the renderer mounted.
     *
     * Fire-and-forget — the renderer cannot await or observe the result. Idempotent
     * from main's perspective (the adapter records ready=true and ignores duplicates).
     */
    signalReady(): void {
        ipcRenderer.send(OWN_WINDOW_READY_EVENT)
    }
})

/**
 * Type declaration the renderer can rely on. Mirrored under `Window` so Svelte code
 * can type `window.lyricueOutput.subscribe(...)` without manual any-casts.
 */
declare global {
    interface Window {
        lyricueOutput: {
            subscribe: (handler: EnvelopeHandler) => () => void
            signalReady: () => void
        }
    }
}

export {}
