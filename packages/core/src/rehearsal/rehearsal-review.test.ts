import { describe, expect, it } from "vitest"
import { DEMO_TIMING_MAP } from "../output/test-utils.js"
import { buildRehearsalTimingMapVariant, wordReviewKey } from "./rehearsal-review.js"

describe("buildRehearsalTimingMapVariant", () => {
    it("scales the studio map into the reviewed rehearsal segment duration", () => {
        const map = buildRehearsalTimingMapVariant({
            baseMap: DEMO_TIMING_MAP,
            segment: {
                showId: DEMO_TIMING_MAP.showId,
                startSec: 10,
                endSec: 13,
                sourceAudioPath: "/tmp/rehearsal.wav"
            },
            learnedAt: "2026-05-19T00:00:00.000Z",
            sourceFilename: "rehearsal.wav"
        })

        expect(map.showId).toBe(DEMO_TIMING_MAP.showId)
        expect(map.learnedFrom).toEqual({
            method: "rehearsal",
            filename: "rehearsal.wav",
            duration: 3,
            learnedAt: "2026-05-19T00:00:00.000Z"
        })
        expect(map.sections[0]?.endMs).toBe(3000)
        expect(map.sections[0]?.words[0]).toMatchObject({ text: "Hello", startMs: 0, endMs: 250 })
        expect(map.sections[0]?.words.at(-1)).toMatchObject({ text: "mode", startMs: 2750, endMs: 3000 })
        expect(map.metadata.version).toContain("+rehearsal")
    })

    it("marks skipped words as unaligned without removing them from the lyric structure", () => {
        const map = buildRehearsalTimingMapVariant({
            baseMap: DEMO_TIMING_MAP,
            segment: {
                showId: DEMO_TIMING_MAP.showId,
                startSec: 0,
                endSec: 6
            },
            skippedWordKeys: [wordReviewKey("demo-1", 1)]
        })

        expect(map.sections[0]?.words[0]?.confidence).toBe(1)
        expect(map.sections[0]?.words[1]?.text).toBe("world")
        expect(map.sections[0]?.words[1]?.confidence).toBeNull()
        expect(map.sections[0]?.lines[0]).toEqual(DEMO_TIMING_MAP.sections[0]?.lines[0])
    })
})
