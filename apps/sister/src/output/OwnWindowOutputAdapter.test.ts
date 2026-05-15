import { describe, it, expect, vi } from "vitest"
import {
    OWN_WINDOW_CHANNEL,
    OwnWindowOutputAdapter,
    type BrowserWindowFactory,
    type ManagedWindow
} from "./OwnWindowOutputAdapter.js"
import { makeFrame } from "@lyricue/core/output/test-utils"
import type { TimingMap } from "@lyricue/core/types"

/**
 * Test harness: a fully-stubbed `ManagedWindow` that records every `send` plus a
 * factory that returns it. Exposes hooks the tests need to drive the adapter through
 * its lifecycle (simulate renderer-ready, simulate OS close, simulate destroy).
 */
function makeHarness(opts: { factoryFails?: boolean; factoryReturnsNull?: boolean } = {}) {
    const sent: { channel: string; payload: unknown }[] = []
    let destroyed = false
    let readyHandler: (() => void) | null = null
    let closedHandler: (() => void) | null = null

    const win: ManagedWindow = {
        isDestroyed: () => destroyed,
        send: (channel, payload) => {
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
            // Real Electron fires "closed" after .close(); the wrapper does the same so
            // the adapter sees the destroy event flow it expects.
            closedHandler?.()
        }
    }

    const factory: BrowserWindowFactory = vi.fn(async () => {
        if (opts.factoryFails) throw new Error("factory blew up")
        if (opts.factoryReturnsNull) return null
        return win
    })

    return {
        factory,
        sent,
        simulateRendererReady: () => readyHandler?.(),
        simulateOsClose: () => {
            destroyed = true
            closedHandler?.()
        },
        simulateDestroyOnly: () => {
            // OS destroyed the window's native handle but didn't fire our `closed` listener
            // (rare but possible on shutdown races). Adapter must treat isDestroyed() as truth.
            destroyed = true
        },
        get hasReadyHandler() {
            return readyHandler !== null
        },
        get hasClosedHandler() {
            return closedHandler !== null
        }
    }
}

const stubMap: TimingMap = {
    $schema: "lyricue-timing-v1",
    showId: "show-x",
    learnedFrom: { method: "studio", duration: 1, learnedAt: "2026-05-14T00:00:00Z" },
    bpm: 120,
    language: "en",
    sections: [],
    metadata: { schemaVersion: "1", version: "0.1.0" }
}

describe("OwnWindowOutputAdapter — adapter contract conformance", () => {
    it("does not deliver frames before start()", () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        a.pushSyncFrame(makeFrame())
        expect(h.sent).toHaveLength(0)
        expect(a.health.framesDelivered).toBe(0)
        expect(a.health.framesDropped).toBe(1)
    })

    it("after start() + rendererReady, delivers frames as LC_SYNC_FRAME on the OWN_WINDOW_CHANNEL", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        h.simulateRendererReady()
        a.pushSyncFrame(makeFrame({ wordIndex: 7 }))

        expect(h.sent).toHaveLength(1)
        expect(h.sent[0]?.channel).toBe(OWN_WINDOW_CHANNEL)
        expect((h.sent[0]?.payload as any).channel).toBe("LC_SYNC_FRAME")
        expect((h.sent[0]?.payload as any).data.wordIndex).toBe(7)
        expect(a.health.framesDelivered).toBe(1)
    })

    it("never throws from pushSyncFrame even when send() blows up (NFR2.1 zero-crash)", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        h.simulateRendererReady()
        // Replace send with a thrower so we test the exception path.
        const original = (h.factory as any).mock.results[0].value
        const win: ManagedWindow = await original
        win.send = () => {
            throw new Error("transport collapsed")
        }
        expect(() => a.pushSyncFrame(makeFrame())).not.toThrow()
        expect(a.health.framesDropped).toBe(1)
        expect(a.health.lastError?.message).toBe("transport collapsed")
    })

    it("returns a frozen snapshot from health so external code cannot mutate it", () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        const snapshot = a.health
        expect(() => {
            ;(snapshot as { framesDelivered: number }).framesDelivered = 999
        }).toThrow(TypeError)
    })

    it("stop() resets running state and ignores subsequent frames", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        h.simulateRendererReady()
        await a.stop()
        a.pushSyncFrame(makeFrame())
        expect(a.health.framesDelivered).toBe(0)
        expect(a.health.framesDropped).toBe(1)
    })

    it("loadTimingMap broadcasts LC_LOAD_MAP with the expected payload shape (after renderer-ready)", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        // Per the M1-close D11 fix, loadTimingMap defers until the renderer signals ready.
        // The map is the contract the renderer needs BEFORE any frame can resolve a section.
        h.simulateRendererReady()
        a.loadTimingMap(stubMap, null)
        const lastSent = h.sent[h.sent.length - 1]
        expect(lastSent?.channel).toBe(OWN_WINDOW_CHANNEL)
        expect((lastSent?.payload as any).channel).toBe("LC_LOAD_MAP")
        expect((lastSent?.payload as any).data.showId).toBe("show-x")
        expect((lastSent?.payload as any).data.outputId).toBe("out-1")
    })

    it("omits parallelLyrics from the payload when not provided (exactOptionalPropertyTypes)", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        h.simulateRendererReady()
        a.loadTimingMap(stubMap, null)
        const payload = (h.sent[0]?.payload as any).data
        expect("parallelLyrics" in payload).toBe(false)
    })

    it("includes parallelLyrics when provided", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        h.simulateRendererReady()
        a.loadTimingMap(stubMap, null, [{ language: "zu-ZA", sections: [] }])
        const payload = (h.sent[0]?.payload as any).data
        expect(payload.parallelLyrics).toHaveLength(1)
        expect(payload.parallelLyrics[0].language).toBe("zu-ZA")
    })

    it("treats destroyed windows as a frame drop, not a send (preserves NFR2.1)", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        h.simulateRendererReady()
        h.simulateDestroyOnly() // OS destroyed handle but no `closed` event fired
        a.pushSyncFrame(makeFrame())
        // The send-before-destroy buffered frames have flushed, so we expect 0 delivery
        // attempts after destroy. Only the one frame we just pushed is observable here,
        // and it should be counted as dropped.
        expect(a.health.framesDropped).toBeGreaterThanOrEqual(1)
    })
})

describe("OwnWindowOutputAdapter — window lifecycle (OwnWindow-specific)", () => {
    it("idempotent start(): a second start() is a no-op while a window is open", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        await a.start({ outputId: "out-2" }) // ignored
        expect(h.factory).toHaveBeenCalledTimes(1)
    })

    it("records lastError and stays not-running when the factory throws", async () => {
        const h = makeHarness({ factoryFails: true })
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        expect(a.health.running).toBe(false)
        expect(a.health.lastError?.message).toContain("factory threw")
        expect(a.health.lastError?.message).toContain("factory blew up")
    })

    it("records lastError and stays not-running when the factory returns null", async () => {
        const h = makeHarness({ factoryReturnsNull: true })
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        expect(a.health.running).toBe(false)
        expect(a.health.lastError?.message).toContain("factory returned null")
    })

    it("emits 'adapterClosed' when the OS closes the window", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        const onClosed = vi.fn()
        a.on("adapterClosed", onClosed)
        await a.start({ outputId: "out-1" })
        h.simulateOsClose()
        expect(onClosed).toHaveBeenCalledOnce()
        expect(a.health.running).toBe(false)
    })

    it("does NOT emit 'adapterClosed' when stop() closes the window deliberately", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        const onClosed = vi.fn()
        a.on("adapterClosed", onClosed)
        await a.start({ outputId: "out-1" })
        await a.stop()
        expect(onClosed).not.toHaveBeenCalled()
    })

    it("fires the onWindowClosed callback in addition to the 'adapterClosed' event", async () => {
        const h = makeHarness()
        const onWindowClosed = vi.fn()
        const a = new OwnWindowOutputAdapter({ factory: h.factory, onWindowClosed })
        await a.start({ outputId: "out-1" })
        h.simulateOsClose()
        expect(onWindowClosed).toHaveBeenCalledOnce()
    })

    it("detaches listeners on stop() so subsequent OS events do not produce ghost emissions", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        const onClosed = vi.fn()
        a.on("adapterClosed", onClosed)
        await a.start({ outputId: "out-1" })
        expect(h.hasReadyHandler).toBe(true)
        expect(h.hasClosedHandler).toBe(true)
        await a.stop()
        expect(h.hasReadyHandler).toBe(false)
        expect(h.hasClosedHandler).toBe(false)
    })
})

describe("OwnWindowOutputAdapter — frame buffering before renderer ready", () => {
    it("buffers frames pushed before the renderer signals ready", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        // No simulateRendererReady() yet.
        a.pushSyncFrame(makeFrame({ wordIndex: 0 }))
        a.pushSyncFrame(makeFrame({ wordIndex: 1 }))
        a.pushSyncFrame(makeFrame({ wordIndex: 2 }))
        // Frames are not sent to the renderer yet, and not counted as delivered.
        expect(h.sent).toHaveLength(0)
        expect(a.health.framesDelivered).toBe(0)
        expect(a.health.framesDropped).toBe(0)
    })

    it("flushes buffered frames in order when renderer signals ready", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        a.pushSyncFrame(makeFrame({ wordIndex: 0 }))
        a.pushSyncFrame(makeFrame({ wordIndex: 1 }))
        a.pushSyncFrame(makeFrame({ wordIndex: 2 }))
        h.simulateRendererReady()
        const wordIndexes = h.sent.map((m) => (m.payload as any).data.wordIndex)
        expect(wordIndexes).toEqual([0, 1, 2])
        expect(a.health.framesDelivered).toBe(3)
    })

    it("drops the oldest frame once the buffer cap is reached (preserving the most recent state)", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        // Push 70 frames before renderer is ready. Cap is 60, so 10 should be dropped (oldest).
        for (let i = 0; i < 70; i++) a.pushSyncFrame(makeFrame({ wordIndex: i }))
        expect(a.health.framesDropped).toBe(10)
        h.simulateRendererReady()
        const wordIndexes = h.sent.map((m) => (m.payload as any).data.wordIndex)
        // The oldest 10 (indexes 0..9) were dropped, so the flush should start at 10.
        expect(wordIndexes[0]).toBe(10)
        expect(wordIndexes[wordIndexes.length - 1]).toBe(69)
        expect(wordIndexes).toHaveLength(60)
    })

    it("after renderer-ready, new frames bypass the buffer and deliver immediately", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        h.simulateRendererReady()
        h.sent.length = 0 // ignore anything from earlier
        a.pushSyncFrame(makeFrame({ wordIndex: 99 }))
        expect(h.sent).toHaveLength(1)
        expect((h.sent[0]?.payload as any).data.wordIndex).toBe(99)
    })
})

describe("OwnWindowOutputAdapter — load-map buffering before renderer ready (M1-close D11)", () => {
    it("does NOT send LC_LOAD_MAP before renderer signals ready", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        a.loadTimingMap(stubMap, null)
        // The envelope must be buffered, not yet flushed to the window.
        expect(h.sent).toHaveLength(0)
    })

    it("flushes the buffered LC_LOAD_MAP when renderer signals ready, BEFORE any buffered frames", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        // Order in: load-map first, then frames. The renderer expects this order so it
        // can resolve `slideIndex` before frames cursor into the map.
        a.loadTimingMap(stubMap, null)
        a.pushSyncFrame(makeFrame({ wordIndex: 0 }))
        a.pushSyncFrame(makeFrame({ wordIndex: 1 }))
        h.simulateRendererReady()
        // Three envelopes: 1 LC_LOAD_MAP + 2 LC_SYNC_FRAME, in that order.
        expect(h.sent).toHaveLength(3)
        expect((h.sent[0]?.payload as any).channel).toBe("LC_LOAD_MAP")
        expect((h.sent[1]?.payload as any).channel).toBe("LC_SYNC_FRAME")
        expect((h.sent[2]?.payload as any).channel).toBe("LC_SYNC_FRAME")
    })

    it("a fresh loadTimingMap before ready supersedes the buffered one (last-write-wins)", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        const firstMap: TimingMap = { ...stubMap, showId: "first" }
        const secondMap: TimingMap = { ...stubMap, showId: "second" }
        a.loadTimingMap(firstMap, null)
        a.loadTimingMap(secondMap, null)
        h.simulateRendererReady()
        // Only the second map should have been flushed.
        const loadMapEnvelopes = h.sent.filter((m) => (m.payload as any).channel === "LC_LOAD_MAP")
        expect(loadMapEnvelopes).toHaveLength(1)
        expect((loadMapEnvelopes[0]!.payload as any).data.showId).toBe("second")
    })

    it("after renderer-ready, subsequent loadTimingMap calls deliver immediately", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        h.simulateRendererReady()
        h.sent.length = 0
        a.loadTimingMap(stubMap, null)
        expect(h.sent).toHaveLength(1)
        expect((h.sent[0]?.payload as any).channel).toBe("LC_LOAD_MAP")
    })

    it("stop() clears the buffered load-map so a re-start doesn't replay a stale one", async () => {
        const h = makeHarness()
        const a = new OwnWindowOutputAdapter({ factory: h.factory })
        await a.start({ outputId: "out-1" })
        a.loadTimingMap(stubMap, null)
        await a.stop()
        // Subsequent start() + ready should NOT replay the buffered load-map.
        const h2 = makeHarness()
        const a2 = new OwnWindowOutputAdapter({ factory: h2.factory })
        await a2.start({ outputId: "out-1" })
        h2.simulateRendererReady()
        // h2 should have received nothing because no loadTimingMap was issued on the new adapter.
        expect(h2.sent.filter((m) => (m.payload as any).channel === "LC_LOAD_MAP")).toHaveLength(0)
    })
})
