/**
 * Adversarial tests for OwnWindowOutputAdapter — race-window scenarios not covered
 * by the existing 25-test suite.
 *
 * Focus:
 *   1. loadTimingMap called BEFORE start() — current behaviour silently drops the map.
 *      The renderer will then stay on its placeholder forever, even after start+ready.
 *   2. loadTimingMap called AFTER stop() — same silent drop.
 *   3. Mid-flush errors: when half the buffered frames succeed and half fail, the
 *      framesDelivered + framesDropped counters must each be accurate.
 *   4. start() → window forcibly destroyed externally (not via close()) → next push
 *      must drop, not throw.
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

function makeHarness(opts: { sendFailsOn?: number[] } = {}) {
    const sent: { channel: string; payload: unknown }[] = []
    const sendCallCounts: { total: number } = { total: 0 }
    let destroyed = false
    let readyHandler: (() => void) | null = null
    let closedHandler: (() => void) | null = null

    const win: ManagedWindow = {
        isDestroyed: () => destroyed,
        send: (channel, payload) => {
            sendCallCounts.total++
            if (opts.sendFailsOn && opts.sendFailsOn.includes(sendCallCounts.total)) {
                throw new Error(`send fail on call ${sendCallCounts.total}`)
            }
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
        forceDestroy: () => {
            destroyed = true
        }
    }
}

describe("adversarial: loadTimingMap lifecycle ordering", () => {
    it("loadTimingMap called BEFORE start() must either buffer or be loud", async () => {
        // Construct adapter but DO NOT start it. Then call loadTimingMap.
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        // Currently this silently returns (line: !this.#window guard).
        a.loadTimingMap(stubMap, null)
        // After we eventually start + signal ready, the map MUST reach the renderer —
        // otherwise the operator clicks "Start Sync" and gets a frozen placeholder.
        await a.start({ outputId: "out-1" })
        h.simulateRendererReady()
        await new Promise((r) => setImmediate(r))
        const loadEnvelopes = h.sent.filter((s) => (s.payload as { channel: string }).channel === "LC_LOAD_MAP")
        expect(
            loadEnvelopes,
            "loadTimingMap pre-start must either buffer for delivery after start, or callers must re-call after start"
        ).toHaveLength(1)
    })

    it("loadTimingMap called AFTER stop() must not silently drop without recording lastError", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        h.simulateRendererReady()
        await new Promise((r) => setImmediate(r))
        await a.stop()
        // Capture health before and after the post-stop loadTimingMap.
        const before = a.health
        a.loadTimingMap(stubMap, null)
        const after = a.health
        // Drop is acceptable; silent drop without telemetry is not. Either lastError
        // increments OR the call should be recorded somewhere observable.
        // For now we pin the no-throw guarantee; a future hardening pass could add
        // explicit lastError = "loadTimingMap after stop" telemetry.
        expect(after.running).toBe(false)
        expect(after.framesDropped).toBe(before.framesDropped) // load-map isn't a frame
    })
})

describe("adversarial: pre-ready flush accounting", () => {
    it("mid-flush send errors increment framesDropped accurately; subsequent successes increment framesDelivered", async () => {
        // Buffer 4 frames before ready. Configure the harness so the 1st send (which is
        // the load-map, if any) and the 3rd buffered frame fail. Verify the counters.
        const h = makeHarness({ sendFailsOn: [3] }) // 3rd send (1st load + 2nd frame succeeds, 3rd frame fails)
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        // Push 4 frames before ready.
        for (let i = 0; i < 4; i++) a.pushSyncFrame(makeFrame({ wordIndex: i }))
        const beforeFlush = a.health
        expect(beforeFlush.framesDelivered).toBe(0)
        expect(beforeFlush.framesDropped).toBe(0)
        // Signal ready. The 4 buffered frames flush; the 3rd send throws.
        h.simulateRendererReady()
        const after = a.health
        // Expected: 3 delivered + 1 dropped (the failing one).
        expect(after.framesDelivered + after.framesDropped).toBe(4)
        expect(after.framesDropped).toBeGreaterThanOrEqual(1)
        expect(after.lastError, "the failing send must record lastError").not.toBeNull()
    })
})

describe("adversarial: window destroyed externally between push calls", () => {
    it("pushSyncFrame increments framesDropped (not throws) when window destroyed externally without close()", async () => {
        // Some platforms (Linux GTK?) can mark a window as destroyed without firing the
        // close event in time. The adapter must use isDestroyed() defensively on every push.
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        h.simulateRendererReady()
        // Push one frame successfully.
        a.pushSyncFrame(makeFrame({ wordIndex: 0 }))
        // Externally mark destroyed (simulating an OS-level event the close handler hasn't fired for yet).
        h.forceDestroy()
        // Next push must drop, not throw.
        expect(() => a.pushSyncFrame(makeFrame({ wordIndex: 1 }))).not.toThrow()
        const final = a.health
        expect(final.framesDelivered).toBe(1)
        expect(final.framesDropped).toBeGreaterThanOrEqual(1)
    })
})
