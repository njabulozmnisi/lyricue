/**
 * Pass-3.A adversarial — Electron renderer-crash + lifecycle race windows.
 *
 * The existing adapter tests cover the canonical lifecycle (start → ready → frames →
 * stop). This suite probes intermediate-destroyed states and out-of-order events that
 * real Electron can produce under crash, OS-level destroy, or rapid restart:
 *
 *   - send() throws (e.g. renderer crashed) while isDestroyed() still returns false
 *   - onRendererReady fires AFTER stop() — race when the renderer's preload mounts
 *     just as the user closes the window
 *   - onClosed fires twice (some Electron versions re-fire on app-shutdown)
 *   - re-entrant pushSyncFrame from inside the 'adapterClosed' emitter handler
 *   - loadTimingMap → start() (natural composition order) — buffered map flushes
 */

import { describe, expect, it, vi } from "vitest"
import {
    OwnWindowOutputAdapter,
    type BrowserWindowFactory,
    type ManagedWindow
} from "./OwnWindowOutputAdapter.js"
import { makeFrame } from "@lyricue/core/output/test-utils"
import type { TimingMap } from "@lyricue/core/types"

const stubMap: TimingMap = {
    $schema: "lyricue-timing-v1",
    showId: "stub",
    version: "1",
    durationMs: 1000,
    learnedFrom: { method: "studio", confidenceScore: 1.0, generatedAt: "2026-06-18T00:00:00.000Z" },
    metadata: { schemaVersion: "1" },
    sections: []
} as unknown as TimingMap

interface Harness {
    factory: BrowserWindowFactory
    sent: { channel: string; payload: unknown }[]
    sendCallCounts: { total: number }
    simulateRendererReady(): void
    simulateOsClose(): void
    setIsDestroyed(value: boolean): void
    setSendBehaviour(fn: ((call: number) => void) | null): void
}

function makeHarness(): Harness {
    const sent: { channel: string; payload: unknown }[] = []
    const sendCallCounts = { total: 0 }
    let destroyed = false
    let readyHandler: (() => void) | null = null
    let closedHandler: (() => void) | null = null
    let sendBehaviour: ((call: number) => void) | null = null

    const win: ManagedWindow = {
        isDestroyed: () => destroyed,
        send: (channel, payload) => {
            sendCallCounts.total++
            if (sendBehaviour) sendBehaviour(sendCallCounts.total)
            sent.push({ channel, payload })
        },
        onRendererReady: (handler) => {
            readyHandler = handler
            return () => {
                if (readyHandler === handler) readyHandler = null
            }
        },
        onClosed: (handler) => {
            closedHandler = handler
            return () => {
                if (closedHandler === handler) closedHandler = null
            }
        },
        close: () => {
            destroyed = true
            closedHandler?.()
        }
    }

    const factory: BrowserWindowFactory = vi.fn(async () => win)
    return {
        factory,
        sent,
        sendCallCounts,
        simulateRendererReady: () => readyHandler?.(),
        simulateOsClose: () => {
            destroyed = true
            closedHandler?.()
        },
        setIsDestroyed: (value) => {
            destroyed = value
        },
        setSendBehaviour: (fn) => {
            sendBehaviour = fn
        }
    }
}

describe("adversarial: send throws while isDestroyed() still returns false", () => {
    /**
     * Electron renderer can crash (gpu hang, OOM) and the window enters an intermediate
     * state where the underlying webContents is gone but `BrowserWindow.isDestroyed()`
     * has not yet flipped. `webContents.send()` raises in that window. The adapter must
     * record this in lastError + framesDropped — and the NEXT push must not throw even
     * though the destroyed state still hasn't flipped.
     */
    it("records framesDropped + lastError on send-throw; subsequent pushes also drop cleanly", () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        return (async () => {
            await a.start({ outputId: "out-1" })
            h.simulateRendererReady()
            // First push succeeds.
            a.pushSyncFrame(makeFrame({ wordIndex: 0 }))
            expect(a.health.framesDelivered).toBe(1)
            // Renderer "crashes" — send throws on every call, isDestroyed() still false.
            h.setSendBehaviour(() => {
                throw new Error("Object has been destroyed")
            })
            for (let i = 1; i <= 50; i++) {
                expect(() => a.pushSyncFrame(makeFrame({ wordIndex: i }))).not.toThrow()
            }
            const final = a.health
            expect(final.framesDelivered).toBe(1)
            expect(final.framesDropped).toBe(50)
            expect(final.lastError, "lastError must be set after a send-throw").not.toBeNull()
            expect(final.lastError?.message).toContain("destroyed")
        })()
    })

    /**
     * After send recovers (e.g., the renderer was respawned via the host's
     * onWindowClosed → re-spawn flow and the adapter is reused), the next frame must
     * deliver and lastError must clear.
     */
    it("clears lastError after a successful frame following a send-throw burst", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        h.simulateRendererReady()
        h.setSendBehaviour(() => {
            throw new Error("transient")
        })
        a.pushSyncFrame(makeFrame({ wordIndex: 1 }))
        expect(a.health.lastError).not.toBeNull()
        h.setSendBehaviour(null) // recovery
        a.pushSyncFrame(makeFrame({ wordIndex: 2 }))
        expect(a.health.lastError, "lastError must clear after a successful push").toBeNull()
        expect(a.health.framesDelivered).toBe(1)
        expect(a.health.framesDropped).toBe(1)
    })
})

describe("adversarial: onRendererReady fires after stop()", () => {
    /**
     * Race: operator presses close-window or app-quit fires stop() while the renderer's
     * preload is still in the process of mounting. The ready event fires onto a stopped
     * adapter. The current code's #onRendererReady references this.#window which is now
     * null — the early-return guard handles this. Pin the behaviour: no throws, no
     * delivered frames, pending buffer cleared.
     */
    it("ignores ready events fired after stop() without throwing", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        // Queue a load-map + a frame BEFORE ready, then stop.
        a.loadTimingMap(stubMap, null)
        a.pushSyncFrame(makeFrame({ wordIndex: 0 }))
        await a.stop()
        // Now the ready event fires (race window). Per the existing stop() impl, the
        // ready handler was already unsubbed — but tests need to confirm no late ready
        // can cause a delivered frame or load-map send.
        expect(() => h.simulateRendererReady()).not.toThrow()
        // The harness's readyHandler was unsubscribed by stop(); the simulate is a no-op
        // in real code. Either way, no sent envelopes after stop.
        expect(h.sent.filter((s) => (s.payload as { channel: string }).channel === "LC_LOAD_MAP")).toHaveLength(0)
    })
})

describe("adversarial: onClosed fires twice", () => {
    /**
     * Some Electron versions re-fire 'closed' during app-shutdown sequence. The
     * adapter's #onWindowClosed sets #window = null + emits 'adapterClosed'. A
     * second fire would re-emit 'adapterClosed' (operator code receives the event
     * twice). Pin that we don't double-fire.
     */
    it("emits adapterClosed at most once even when the OS close fires twice", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        const closedSpy = vi.fn()
        a.on("adapterClosed", closedSpy)
        h.simulateOsClose()
        // Try to fire it a second time — in reality the handler was unsubscribed, but
        // a sloppy impl could re-fire.
        h.simulateOsClose()
        expect(closedSpy).toHaveBeenCalledTimes(1)
    })
})

describe("adversarial: re-entrant pushSyncFrame from emitter handler", () => {
    /**
     * Operator-visible scenario: an upstream observer subscribes to 'adapterClosed' and
     * inside that handler calls pushSyncFrame as a 'final beacon' attempt. The adapter
     * must not throw, and the frame must be cleanly counted as a drop (not a stale
     * delivery and not silently swallowed).
     */
    it("pushSyncFrame called from inside an adapterClosed handler is a clean drop", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        h.simulateRendererReady()
        a.on("adapterClosed", () => {
            // Re-entrant push from inside the close emitter — must not throw.
            expect(() => a.pushSyncFrame(makeFrame({ wordIndex: 999 }))).not.toThrow()
        })
        h.simulateOsClose()
        const final = a.health
        expect(final.running).toBe(false)
        // The re-entrant frame went to framesDropped (not delivered) because !#running.
        expect(final.framesDropped).toBeGreaterThanOrEqual(1)
    })
})

describe("adversarial: loadTimingMap → start() composition order (pass-2 D-T11 follow-up)", () => {
    /**
     * Verify the pass-2 D-T11 fix end-to-end: a caller that constructs the adapter,
     * calls loadTimingMap immediately, THEN calls start(), THEN signals ready — the
     * map must reach the renderer. This is the natural order in startE2EMode().
     */
    it("buffered pre-start loadTimingMap flushes with the live outputId after start+ready", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        a.loadTimingMap(stubMap, null)
        await a.start({ outputId: "out-7" })
        h.simulateRendererReady()
        await new Promise((r) => setImmediate(r))
        const loadEnvelopes = h.sent.filter(
            (s) => (s.payload as { channel: string }).channel === "LC_LOAD_MAP"
        )
        expect(loadEnvelopes).toHaveLength(1)
        // outputId in the payload must be the live outputId set by start(), not "pending".
        const payload = (loadEnvelopes[0]!.payload as { data: { outputId: string } }).data
        expect(payload.outputId).toBe("out-7")
    })
})
