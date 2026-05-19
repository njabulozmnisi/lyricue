import { describe, expect, it } from "vitest"
import { normalizeRehearsalSegments } from "./rehearsal-segments.js"

describe("normalizeRehearsalSegments", () => {
    it("normalizes matched and review segments for the UI", () => {
        expect(
            normalizeRehearsalSegments(
                {
                    segments: [
                        { index: 0, status: "matched", showId: "s1", title: "Way Maker", startSec: 1, endSec: 5, confidence: 0.8 },
                        { status: "review", confidence: 0.2 }
                    ]
                },
                "/tmp/rehearsal.wav"
            )
        ).toEqual([
            { index: 0, status: "matched", showId: "s1", title: "Way Maker", startSec: 1, endSec: 5, confidence: 0.8, sourceAudioPath: "/tmp/rehearsal.wav" },
            { index: 1, status: "review", showId: null, title: "Segment 2", confidence: 0.2, sourceAudioPath: "/tmp/rehearsal.wav" }
        ])
    })

    it("surfaces sidecar segmentation errors as failed summary rows", () => {
        expect(normalizeRehearsalSegments({ error: "decode failed", segments: [] }, "/tmp/rehearsal.wav")).toEqual([
            {
                index: 0,
                title: "Segmentation failed: decode failed",
                status: "failed",
                confidence: 0,
                sourceAudioPath: "/tmp/rehearsal.wav"
            }
        ])
    })

    it("surfaces empty segmentation results as reviewable summary rows", () => {
        expect(normalizeRehearsalSegments({ audio: { durationSeconds: 125 }, segments: [] }, null)).toEqual([
            {
                index: 0,
                title: "No song segments detected in 2:05 recording",
                status: "review",
                confidence: 0
            }
        ])
    })
})
