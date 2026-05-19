import { describe, expect, it, vi } from "vitest"
import type { Arrangement } from "../types/timing-map.js"
import { CaptionInjectionOutputAdapter, type CaptionInjectionMessage, type CaptionTransport } from "./caption-injection-output-adapter.js"
import { DEMO_TIMING_MAP } from "./demo-timing-map.js"
import { makeFrame } from "./sync-frame-fixture.js"

function makeTransport(opts: { throwOnSend?: boolean } = {}): CaptionTransport & { messages: CaptionInjectionMessage[] } {
    return {
        messages: [],
        connect: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
        send(message) {
            if (opts.throwOnSend) throw new Error("transport saturated")
            this.messages.push(message)
        }
    }
}

describe("CaptionInjectionOutputAdapter", () => {
    it("starts a caption session and sends load-map metadata", async () => {
        const transport = makeTransport()
        const adapter = new CaptionInjectionOutputAdapter({ transport, wordSweepSupported: true })

        await adapter.start({ outputId: "caption-output" })
        adapter.loadTimingMap(DEMO_TIMING_MAP, null, [{ language: "zu-ZA", sections: [] }])

        expect(transport.messages[0]).toEqual({
            type: "lyricue:caption-session",
            outputId: "caption-output",
            highlightMode: "word-sweep"
        })
        expect(transport.messages[1]).toEqual({
            type: "lyricue:caption-map",
            outputId: "caption-output",
            showId: DEMO_TIMING_MAP.showId,
            sectionCount: 1,
            languages: ["en", "zu-ZA"]
        })
    })

    it("sends word-sweep frame payloads when the upstream extension is available", async () => {
        const transport = makeTransport()
        const adapter = new CaptionInjectionOutputAdapter({ transport, wordSweepSupported: true })
        await adapter.start({ outputId: "caption-output" })
        adapter.loadTimingMap(DEMO_TIMING_MAP, null)

        adapter.pushSyncFrame(makeFrame({ slideIndex: 0, wordIndex: 2, wordProgress: 1.7, tier: "auto", vad: "active" }))

        expect(transport.messages.at(-1)).toMatchObject({
            type: "lyricue:caption-frame",
            outputId: "caption-output",
            showId: DEMO_TIMING_MAP.showId,
            slideIndex: 0,
            sectionId: "demo-1",
            words: ["Hello", "world", "this", "is", "LyriCue", "running", "end", "to", "end", "in", "demo", "mode"],
            activeWordIndex: 2,
            highlightMode: "word-sweep",
            wordProgress: 1
        })
        expect(adapter.health.framesDelivered).toBe(1)
    })

    it("degrades to word-swap payloads when the upstream extension is absent", async () => {
        const transport = makeTransport()
        const adapter = new CaptionInjectionOutputAdapter({ transport })
        await adapter.start({ outputId: "caption-output" })
        adapter.loadTimingMap(DEMO_TIMING_MAP, null)

        adapter.pushSyncFrame(makeFrame({ slideIndex: 0, wordIndex: 2, wordProgress: 0.5 }))

        expect(transport.messages.at(-1)).toMatchObject({
            type: "lyricue:caption-frame",
            activeWordIndex: 2
        })
        expect(transport.messages.at(-1)).not.toHaveProperty("highlightMode")
        expect(transport.messages.at(-1)).not.toHaveProperty("wordProgress")
    })

    it("resolves sections through the selected arrangement", async () => {
        const transport = makeTransport()
        const adapter = new CaptionInjectionOutputAdapter({ transport, wordSweepSupported: true })
        const arrangement: Arrangement = {
            id: "chorus-first",
            name: "Chorus First",
            showId: DEMO_TIMING_MAP.showId,
            isDefault: true,
            sequence: [{ sectionId: "demo-1" }],
            createdAt: "2026-05-19T00:00:00.000Z",
            updatedAt: "2026-05-19T00:00:00.000Z"
        }
        await adapter.start({ outputId: "caption-output" })
        adapter.loadTimingMap(DEMO_TIMING_MAP, arrangement)

        adapter.pushSyncFrame(makeFrame({ slideIndex: 0, wordIndex: 0 }))

        expect(transport.messages.at(-1)).toMatchObject({
            sectionId: "demo-1",
            text: "Hello world this is LyriCue running end to end in demo mode"
        })
    })

    it("never throws from pushSyncFrame when the transport fails", async () => {
        const transport = makeTransport({ throwOnSend: true })
        const adapter = new CaptionInjectionOutputAdapter({ transport })
        await adapter.start({ outputId: "caption-output" })
        adapter.loadTimingMap(DEMO_TIMING_MAP, null)

        expect(() => adapter.pushSyncFrame(makeFrame())).not.toThrow()
        expect(adapter.health.framesDropped).toBe(1)
        expect(adapter.health.lastError?.message).toContain("transport saturated")
    })

    it("drops frames before start or before a timing map is loaded", async () => {
        const transport = makeTransport()
        const adapter = new CaptionInjectionOutputAdapter({ transport })

        adapter.pushSyncFrame(makeFrame())
        await adapter.start({ outputId: "caption-output" })
        adapter.pushSyncFrame(makeFrame())

        expect(adapter.health.framesDropped).toBe(2)
        expect(transport.messages).toHaveLength(1)
    })
})
