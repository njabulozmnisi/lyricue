import { describe, expect, it } from "vitest"
import type { TimingMap, TimingSection } from "../types/timing-map.js"
import { evaluatePositionCorrection, resolveCurrentPhraseContext } from "./live-position-corrector.js"

function section(id: string, slideIndex: number, words: string[], startOrdinal = 0): TimingSection {
    return {
        id,
        type: id.startsWith("c") ? "chorus" : "verse",
        label: id,
        slideIndex,
        startMs: startOrdinal * 500,
        endMs: (startOrdinal + words.length) * 500,
        words: words.map((text, idx) => ({
            text,
            startMs: (startOrdinal + idx) * 500,
            endMs: (startOrdinal + idx + 1) * 500,
            confidence: 0.99,
            lineIndex: 0
        })),
        lines: []
    }
}

function map(): TimingMap {
    return {
        $schema: "lyricue-timing-v1",
        showId: "s1",
        learnedFrom: { method: "studio", duration: 12, learnedAt: "2026-06-06T00:00:00.000Z" },
        bpm: 120,
        language: "en",
        sections: [
            section("v1", 0, ["Amazing", "grace", "how", "sweet", "the", "sound"], 0),
            section("c1", 1, ["How", "great", "is", "our", "God"], 6),
            section("v2", 2, ["I", "once", "was", "lost", "but", "now", "am", "found"], 11)
        ],
        metadata: { schemaVersion: "1", version: "1.0.0" }
    }
}

describe("resolveCurrentPhraseContext", () => {
    it("resolves section and global word ordinal from the current cursor", () => {
        expect(resolveCurrentPhraseContext(map(), { currentSlideIndex: 1, currentWordIndex: 2, currentRefMs: 4_000 })).toEqual({
            sectionId: "c1",
            slideIndex: 1,
            wordIndex: 2,
            refMs: 4_000,
            globalWordOrdinal: 8
        })
    })
})

describe("evaluatePositionCorrection", () => {
    it("returns null when STT is disabled", () => {
        const decision = evaluatePositionCorrection({
            map: map(),
            recognizedText: "how great is",
            context: { currentSlideIndex: 0, currentWordIndex: 0, currentRefMs: 0 },
            wallTime: 1_000,
            sttEnabled: false
        })

        expect(decision).toBeNull()
    })

    it("rejects transcripts shorter than the configured minimum", () => {
        const decision = evaluatePositionCorrection({
            map: map(),
            recognizedText: "how great",
            context: { currentSlideIndex: 0, currentWordIndex: 0, currentRefMs: 0 },
            wallTime: 1_000,
            sttEnabled: true,
            minWords: 3
        })

        expect(decision).toBeNull()
    })

    it("suppresses same-section matches by default", () => {
        const decision = evaluatePositionCorrection({
            map: map(),
            recognizedText: "grace how sweet",
            context: { currentSlideIndex: 0, currentWordIndex: 0, currentRefMs: 0 },
            wallTime: 1_000,
            sttEnabled: true
        })

        expect(decision).toBeNull()
    })

    it("produces a SyncEngine position-correction event for a cross-section phrase", () => {
        const decision = evaluatePositionCorrection({
            map: map(),
            recognizedText: "how great is",
            context: { currentSlideIndex: 0, currentWordIndex: 2, currentRefMs: 1_000 },
            wallTime: 9_000,
            sttEnabled: true
        })

        expect(decision?.event).toEqual({ kind: "positionCorrection", targetRefMs: 3_000, wallTime: 9_000 })
        expect(decision?.from.sectionId).toBe("v1")
        expect(decision?.to.sectionId).toBe("c1")
        expect(decision?.match.confidence).toBeGreaterThanOrEqual(0.75)
    })
})
