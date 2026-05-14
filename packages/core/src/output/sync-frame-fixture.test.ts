import { describe, it, expect } from "vitest"
import { generateFrameSequence, makeFrame, nextFrame } from "./sync-frame-fixture.js"

describe("generateFrameSequence", () => {
    it("produces 60Hz frames spanning the full word progression range at default settings", () => {
        const frames = generateFrameSequence()

        // 10 words × 500 ms / (1000/60 ms per frame) ≈ 300 frame intervals. Floating-point
        // imprecision in the loop accumulator means the final tick might not land exactly at
        // totalMs, so we accept the second-to-last frame being on the final word.
        expect(frames.length).toBeGreaterThanOrEqual(300)
        expect(frames[0]).toMatchObject({ wordIndex: 0, wordProgress: 0 })

        const last = frames[frames.length - 1]!
        expect(last.wordIndex).toBe(9)
        // Within one frame's worth of the end (~16.67 ms / 500 ms ≈ 0.033 progress).
        expect(last.wordProgress).toBeGreaterThan(0.95)
    })

    it("ramps wordProgress monotonically within each word", () => {
        const frames = generateFrameSequence({ wordCount: 2, msPerWord: 100, fps: 60 })
        const word0 = frames.filter((f) => f.wordIndex === 0)
        for (let i = 1; i < word0.length; i++) {
            expect(word0[i]!.wordProgress).toBeGreaterThanOrEqual(word0[i - 1]!.wordProgress)
        }
    })

    it("stamps the supplied outputId / tier / vad on every frame", () => {
        const frames = generateFrameSequence({
            outputId: "main-projector",
            tier: "timer",
            vad: "silent"
        })
        expect(frames.every((f) => f.outputId === "main-projector")).toBe(true)
        expect(frames.every((f) => f.tier === "timer")).toBe(true)
        expect(frames.every((f) => f.vad === "silent")).toBe(true)
    })
})

describe("nextFrame", () => {
    it("advances wordProgress within the same word when delta fits", () => {
        const next = nextFrame(makeFrame({ wordIndex: 0, wordProgress: 0 }), {
            msDelta: 100,
            msPerWord: 500
        })
        expect(next.wordIndex).toBe(0)
        expect(next.wordProgress).toBeCloseTo(0.2, 5)
    })

    it("rolls over to the next word when delta crosses a word boundary", () => {
        const next = nextFrame(makeFrame({ wordIndex: 0, wordProgress: 0.9 }), {
            msDelta: 100,
            msPerWord: 500
        })
        // Was 0.9 of 500 ms = 450 ms; +100 ms = 550 ms = 50 ms into word 1 = 0.10 of 500 ms.
        expect(next.wordIndex).toBe(1)
        expect(next.wordProgress).toBeCloseTo(0.1, 5)
    })

    it("clamps progress at 1 within the same word when delta is smaller than the remaining time", () => {
        const next = nextFrame(makeFrame({ wordIndex: 0, wordProgress: 0.95 }), {
            msDelta: 1,
            msPerWord: 500
        })
        expect(next.wordIndex).toBe(0)
        expect(next.wordProgress).toBeLessThanOrEqual(1)
    })
})

describe("makeFrame", () => {
    it("returns a sensible default starting frame", () => {
        const f = makeFrame()
        expect(f.outputId).toBe("test-output")
        expect(f.slideIndex).toBe(0)
        expect(f.wordIndex).toBe(0)
        expect(f.wordProgress).toBe(0)
        expect(f.tier).toBe("auto")
        expect(f.vad).toBe("active")
    })

    it("applies overrides shallowly", () => {
        const f = makeFrame({ wordIndex: 5, tier: "manual" })
        expect(f.wordIndex).toBe(5)
        expect(f.tier).toBe("manual")
        // Unrelated defaults preserved.
        expect(f.vad).toBe("active")
    })
})
