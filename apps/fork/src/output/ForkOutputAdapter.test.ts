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
