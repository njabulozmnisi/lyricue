import { describe, it, expect } from "vitest"
import { MockOutputAdapter } from "./mock-output-adapter.js"
import { makeFrame } from "./sync-frame-fixture.js"
import type { TimingMap } from "../types/timing-map.js"

const stubMap: TimingMap = {
    $schema: "lyricue-timing-v1",
    showId: "show-x",
    learnedFrom: { method: "studio", duration: 1, learnedAt: "2026-05-14T00:00:00Z" },
    bpm: 120,
    language: "en",
    sections: [],
    metadata: { schemaVersion: "1", version: "0.1.0" }
}

describe("MockOutputAdapter", () => {
    it("records start / pushSyncFrame / loadTimingMap / stop in order", async () => {
        const a = new MockOutputAdapter()
        await a.start({ outputId: "out-1" })
        a.loadTimingMap(stubMap, null)
        a.pushSyncFrame(makeFrame())
        await a.stop()

        const methods = a.calls.map((c) => c.method)
        expect(methods).toEqual(["start", "loadTimingMap", "pushSyncFrame", "stop"])
    })

    it("drops frames that arrive before start() and counts them in framesDropped", () => {
        const a = new MockOutputAdapter()
        a.pushSyncFrame(makeFrame())
        a.pushSyncFrame(makeFrame())
        expect(a.health.framesDelivered).toBe(0)
        expect(a.health.framesDropped).toBe(2)
    })

    it("delivers frames after start() and tracks lastFrameAtMs", async () => {
        const a = new MockOutputAdapter()
        await a.start({ outputId: "out-1" })
        a.pushSyncFrame(makeFrame())
        expect(a.health.framesDelivered).toBe(1)
        expect(a.health.lastFrameAtMs).not.toBeNull()
    })

    it("simulates a saturated transport when dropEveryFrame is set", async () => {
        const a = new MockOutputAdapter({ dropEveryFrame: true })
        await a.start({ outputId: "out-1" })
        for (let i = 0; i < 5; i++) a.pushSyncFrame(makeFrame())
        expect(a.health.framesDelivered).toBe(0)
        expect(a.health.framesDropped).toBe(5)
    })

    it("returns a frozen snapshot from health so external code cannot mutate it", () => {
        const a = new MockOutputAdapter()
        const snapshot = a.health
        expect(() => {
            ;(snapshot as { framesDelivered: number }).framesDelivered = 999
        }).toThrow(TypeError)
    })

    it("injectError surfaces on health.lastError", () => {
        const a = new MockOutputAdapter()
        a.injectError("transport closed")
        expect(a.health.lastError?.message).toBe("transport closed")
    })

    it("reset() clears recorded calls and resets counters, preserving running state", async () => {
        const a = new MockOutputAdapter()
        await a.start({ outputId: "out-1" })
        a.pushSyncFrame(makeFrame())
        a.pushSyncFrame(makeFrame())
        expect(a.health.framesDelivered).toBe(2)

        a.reset()
        expect(a.calls).toEqual([])
        expect(a.health.framesDelivered).toBe(0)
        // running should still be true because we never called stop().
        expect(a.health.running).toBe(true)
    })

    it("never throws from pushSyncFrame, satisfying NFR2.1 (zero-crash contract)", async () => {
        const a = new MockOutputAdapter()
        // Bizarre but type-valid frames.
        await a.start({ outputId: "out-1" })
        expect(() =>
            a.pushSyncFrame(
                makeFrame({ wordIndex: -1, wordProgress: 5, slideIndex: Number.MAX_SAFE_INTEGER })
            )
        ).not.toThrow()
    })
})
