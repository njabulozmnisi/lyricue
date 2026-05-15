import { describe, it, expect, vi } from "vitest"
import { ForkOutputAdapter } from "./ForkOutputAdapter.js"
import { makeFrame } from "@lyricue/core/output/test-utils"
import type { TimingMap } from "@lyricue/core/types"

/**
 * Minimal BrowserWindow stub. Records sent messages so the test can assert what reached
 * the renderer. We don't import `electron` in the test runtime; the adapter only cares
 * about the shape `{ isDestroyed(): boolean; webContents: { send(channel, msg) } }`.
 */
function makeStubWindow() {
    const sent: { channel: string; msg: unknown }[] = []
    return {
        sent,
        win: {
            isDestroyed: () => false,
            webContents: {
                send: (channel: string, msg: unknown) => {
                    sent.push({ channel, msg })
                }
            }
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

describe("ForkOutputAdapter", () => {
    it("does not deliver frames before start()", () => {
        const w = makeStubWindow()
        const adapter = new ForkOutputAdapter({ getKaraokeWindows: () => [w.win as any] })
        adapter.pushSyncFrame(makeFrame())
        expect(w.sent).toHaveLength(0)
        expect(adapter.health.framesDelivered).toBe(0)
        expect(adapter.health.framesDropped).toBe(1)
    })

    it("delivers SyncFrames to every karaoke window on the OUTPUT channel as LC_SYNC_FRAME", async () => {
        const w1 = makeStubWindow()
        const w2 = makeStubWindow()
        const adapter = new ForkOutputAdapter({ getKaraokeWindows: () => [w1.win as any, w2.win as any] })
        await adapter.start({ outputId: "out-1" })
        adapter.pushSyncFrame(makeFrame({ wordIndex: 3 }))

        expect(w1.sent).toHaveLength(1)
        expect(w1.sent[0]?.channel).toBe("OUTPUT")
        expect((w1.sent[0]?.msg as any).channel).toBe("LC_SYNC_FRAME")
        expect((w1.sent[0]?.msg as any).data.wordIndex).toBe(3)
        expect(w2.sent).toHaveLength(1)
        expect(adapter.health.framesDelivered).toBe(1)
    })

    it("drops frames when no karaoke windows are open", async () => {
        const adapter = new ForkOutputAdapter({ getKaraokeWindows: () => [] })
        await adapter.start({ outputId: "out-1" })
        adapter.pushSyncFrame(makeFrame())
        expect(adapter.health.framesDelivered).toBe(0)
        expect(adapter.health.framesDropped).toBe(1)
    })

    it("skips destroyed windows", async () => {
        const live = makeStubWindow()
        const dead = makeStubWindow()
        dead.win.isDestroyed = () => true
        const adapter = new ForkOutputAdapter({ getKaraokeWindows: () => [live.win as any, dead.win as any] })
        await adapter.start({ outputId: "out-1" })
        adapter.pushSyncFrame(makeFrame())
        expect(live.sent).toHaveLength(1)
        expect(dead.sent).toHaveLength(0)
    })

    it("never throws from pushSyncFrame even if the transport blows up (NFR2.1 zero-crash)", async () => {
        const adapter = new ForkOutputAdapter({
            getKaraokeWindows: () => {
                throw new Error("transport collapsed")
            }
        })
        await adapter.start({ outputId: "out-1" })
        expect(() => adapter.pushSyncFrame(makeFrame())).not.toThrow()
        expect(adapter.health.framesDropped).toBe(1)
        expect(adapter.health.lastError?.message).toBe("transport collapsed")
    })

    it("loadTimingMap broadcasts LC_LOAD_MAP to every karaoke window", async () => {
        const w = makeStubWindow()
        const adapter = new ForkOutputAdapter({ getKaraokeWindows: () => [w.win as any] })
        await adapter.start({ outputId: "out-1" })
        adapter.loadTimingMap(stubMap, null)

        const lastSent = w.sent[w.sent.length - 1]
        expect(lastSent?.channel).toBe("OUTPUT")
        expect((lastSent?.msg as any).channel).toBe("LC_LOAD_MAP")
        expect((lastSent?.msg as any).data.showId).toBe("show-x")
        expect((lastSent?.msg as any).data.outputId).toBe("out-1")
    })

    it("omits parallelLyrics from the payload when not provided (exactOptionalPropertyTypes)", async () => {
        const w = makeStubWindow()
        const adapter = new ForkOutputAdapter({ getKaraokeWindows: () => [w.win as any] })
        await adapter.start({ outputId: "out-1" })
        adapter.loadTimingMap(stubMap, null)
        const payload = (w.sent[0]?.msg as any).data
        expect("parallelLyrics" in payload).toBe(false)
    })

    it("includes parallelLyrics when provided", async () => {
        const w = makeStubWindow()
        const adapter = new ForkOutputAdapter({ getKaraokeWindows: () => [w.win as any] })
        await adapter.start({ outputId: "out-1" })
        adapter.loadTimingMap(stubMap, null, [{ language: "zu-ZA", sections: [] }])
        const payload = (w.sent[0]?.msg as any).data
        expect(payload.parallelLyrics).toHaveLength(1)
        expect(payload.parallelLyrics[0].language).toBe("zu-ZA")
    })

    it("stop() resets running state and ignores subsequent frames", async () => {
        const w = makeStubWindow()
        const adapter = new ForkOutputAdapter({ getKaraokeWindows: () => [w.win as any] })
        await adapter.start({ outputId: "out-1" })
        await adapter.stop()
        adapter.pushSyncFrame(makeFrame())
        expect(adapter.health.framesDelivered).toBe(0)
        expect(adapter.health.framesDropped).toBe(1)
    })
})

describe("ForkOutputAdapter — load-map buffering before any karaoke window exists (M1-close D11)", () => {
    it("buffers LC_LOAD_MAP when no karaoke window is open at call time", async () => {
        // Start with zero windows. FreeShow hasn't opened its karaoke output yet.
        let windows: any[] = []
        const adapter = new ForkOutputAdapter({ getKaraokeWindows: () => windows })
        await adapter.start({ outputId: "out-1" })
        adapter.loadTimingMap(stubMap, null)
        // Nothing was sent — there was no window to send to.
        // (No assertion needed beyond "no exception"; the next test verifies the flush.)
        expect(adapter.health.lastError).toBeNull()
    })

    it("flushes the buffered load-map on the next pushSyncFrame, BEFORE the frame itself", async () => {
        let windows: any[] = []
        const adapter = new ForkOutputAdapter({ getKaraokeWindows: () => windows })
        await adapter.start({ outputId: "out-1" })
        adapter.loadTimingMap(stubMap, null)

        // Now FreeShow opens a karaoke window.
        const w = makeStubWindow()
        windows = [w.win as any]

        adapter.pushSyncFrame(makeFrame({ wordIndex: 0 }))

        // The window must have received the load-map first, then the frame.
        expect(w.sent).toHaveLength(2)
        expect((w.sent[0]?.msg as any).channel).toBe("LC_LOAD_MAP")
        expect((w.sent[1]?.msg as any).channel).toBe("LC_SYNC_FRAME")
    })

    it("does NOT buffer when a karaoke window already exists at call time", async () => {
        const w = makeStubWindow()
        const adapter = new ForkOutputAdapter({ getKaraokeWindows: () => [w.win as any] })
        await adapter.start({ outputId: "out-1" })
        adapter.loadTimingMap(stubMap, null)
        // The send fired immediately.
        expect(w.sent).toHaveLength(1)
        expect((w.sent[0]?.msg as any).channel).toBe("LC_LOAD_MAP")
        // And the buffer is empty so the next pushSyncFrame doesn't re-send the map.
        const wForFrame = makeStubWindow()
        const adapter2 = new ForkOutputAdapter({ getKaraokeWindows: () => [wForFrame.win as any] })
        await adapter2.start({ outputId: "out-1" })
        // To prove "no replay across adapter instances" we just confirm w.sent count was 1.
        // Verifying same-instance no-replay:
        adapter.pushSyncFrame(makeFrame())
        // The original adapter sent map + frame to its window; no second map.
        const channels = w.sent.map((s) => (s.msg as any).channel)
        expect(channels).toEqual(["LC_LOAD_MAP", "LC_SYNC_FRAME"])
    })

    it("a fresh loadTimingMap before any window appears supersedes the buffered one", async () => {
        let windows: any[] = []
        const adapter = new ForkOutputAdapter({ getKaraokeWindows: () => windows })
        await adapter.start({ outputId: "out-1" })
        const first: TimingMap = { ...stubMap, showId: "first" }
        const second: TimingMap = { ...stubMap, showId: "second" }
        adapter.loadTimingMap(first, null)
        adapter.loadTimingMap(second, null)

        const w = makeStubWindow()
        windows = [w.win as any]
        adapter.pushSyncFrame(makeFrame())

        const loadMaps = w.sent.filter((s) => (s.msg as any).channel === "LC_LOAD_MAP")
        expect(loadMaps).toHaveLength(1)
        expect((loadMaps[0]!.msg as any).data.showId).toBe("second")
    })

    it("stop() clears the buffered load-map", async () => {
        let windows: any[] = []
        const adapter = new ForkOutputAdapter({ getKaraokeWindows: () => windows })
        await adapter.start({ outputId: "out-1" })
        adapter.loadTimingMap(stubMap, null)
        await adapter.stop()

        // After stop(), even if a window appears and pushSyncFrame fires, no map flushes.
        // (Frames will drop too because !running; that's expected.)
        const w = makeStubWindow()
        windows = [w.win as any]
        // Re-start without re-issuing loadTimingMap.
        await adapter.start({ outputId: "out-1" })
        adapter.pushSyncFrame(makeFrame())
        const loadMaps = w.sent.filter((s) => (s.msg as any).channel === "LC_LOAD_MAP")
        expect(loadMaps).toHaveLength(0)
    })
})
