import { describe, expect, it } from "vitest"
import type { TimingMap, TimingSection } from "../types/timing-map.js"
import { buildPhraseIndex, findPhraseMatch, levenshteinSimilarity } from "./phrase-matcher.js"

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
    const v1 = section("v1", 0, ["Amazing", "grace", "how", "sweet", "the", "sound"], 0)
    const c1 = section("c1", 1, ["How", "great", "is", "our", "God"], 6)
    const v2 = section("v2", 2, ["I", "once", "was", "lost", "but", "now", "am", "found"], 11)
    const c2 = section("c2", 3, ["How", "great", "is", "our", "God"], 19)
    return {
        $schema: "lyricue-timing-v1",
        showId: "s1",
        learnedFrom: { method: "studio", duration: 12, learnedAt: "2026-05-16T00:00:00.000Z" },
        bpm: 120,
        language: "en",
        sections: [v1, c1, v2, c2],
        metadata: { schemaVersion: "1", version: "1.0.0" }
    }
}

describe("levenshteinSimilarity", () => {
    it("scores exact and close words", () => {
        expect(levenshteinSimilarity("your", "your")).toBe(1)
        expect(levenshteinSimilarity("youre", "your")).toBeGreaterThanOrEqual(0.75)
        expect(levenshteinSimilarity("alpha", "omega")).toBeLessThan(0.75)
    })
})

describe("phrase matcher", () => {
    it("finds an exact 3-word phrase", () => {
        const index = buildPhraseIndex(map())
        const match = findPhraseMatch(index, "grace how sweet")
        expect(match?.sectionId).toBe("v1")
        expect(match?.slideIndex).toBe(0)
        expect(match?.wordIndex).toBe(1)
    })

    it("accepts fuzzy per-word matches within tolerance", () => {
        const index = buildPhraseIndex(map())
        const match = findPhraseMatch(index, "how greats is")
        expect(match?.sectionId).toBe("c1")
        expect(match?.confidence).toBeGreaterThanOrEqual(0.75)
    })

    it("rejects phrases below tolerance", () => {
        const index = buildPhraseIndex(map())
        expect(findPhraseMatch(index, "completely unrelated phrase")).toBeNull()
    })

    it("uses the smallest forward jump for repeated phrases", () => {
        const index = buildPhraseIndex(map())
        const match = findPhraseMatch(index, "how great is", { globalWordOrdinal: 10 })
        expect(match?.sectionId).toBe("c2")
    })

    it("can require a different current section for correction", () => {
        const index = buildPhraseIndex(map())
        const match = findPhraseMatch(index, "how great is", {
            sectionId: "c1",
            globalWordOrdinal: 6,
            requireDifferentSection: true
        })
        expect(match?.sectionId).toBe("c2")
    })
})
