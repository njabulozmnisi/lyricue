import { describe, expect, it } from "vitest"
import { SCHEMA_LYRICUE_TIMING_V1 } from "../types/schema-versions.js"
import type { ParallelLyricsTrack, TimingMap, TimingSection } from "../types/timing-map.js"
import { createParallelLyricsDraft, normalizeParallelLyricsTrack, removeParallelLyricsTrack, sectionPlainText, upsertParallelLyricsTrack } from "./parallel-lyrics.js"

function section(id: string, label = "Verse 1"): TimingSection {
    return {
        id,
        type: "verse",
        label,
        slideIndex: 0,
        startMs: 0,
        endMs: 1000,
        words: [
            { text: "Amazing", startMs: 0, endMs: 500, confidence: 0.9, lineIndex: 0 },
            { text: "grace", startMs: 500, endMs: 1000, confidence: 0.9, lineIndex: 0 }
        ],
        lines: [{ startMs: 0, endMs: 1000, wordStartIndex: 0, wordEndIndex: 2 }]
    }
}

function map(parallel: ParallelLyricsTrack[] = []): TimingMap {
    return {
        $schema: SCHEMA_LYRICUE_TIMING_V1,
        showId: "show-1",
        learnedFrom: { method: "studio", duration: 20, learnedAt: "2026-05-18T00:00:00Z" },
        bpm: 90,
        language: "en",
        sections: [section("v1")],
        ...(parallel.length > 0 ? { parallel } : {}),
        metadata: { schemaVersion: "1", version: "1.0.0" }
    }
}

function twoSectionMap(parallel: ParallelLyricsTrack[] = []): TimingMap {
    return {
        ...map(parallel),
        sections: [section("v1", "Verse 1"), section("c1", "Chorus")]
    }
}

describe("parallel lyrics helpers", () => {
    it("derives original section text from timing lines", () => {
        expect(sectionPlainText(section("v1"))).toBe("Amazing grace")
    })

    it("creates a per-section draft and preserves existing translated text", () => {
        const draft = createParallelLyricsDraft(map([{ language: "zu-ZA", sections: [{ sectionId: "v1", text: "Umusa omangalisayo" }] }]), "zu-ZA")
        expect(draft).toEqual({
            language: "zu-ZA",
            sections: [{ sectionId: "v1", text: "Umusa omangalisayo" }]
        })
    })

    it("upserts and removes tracks without mutating the input map", () => {
        const original = map()
        const withZulu = upsertParallelLyricsTrack(original, {
            language: "zu-ZA",
            sections: [{ sectionId: "v1", text: "Umusa omangalisayo" }]
        })
        expect(original.parallel).toBeUndefined()
        expect(withZulu.parallel?.[0]?.language).toBe("zu-ZA")

        const replaced = upsertParallelLyricsTrack(withZulu, {
            language: "zu-ZA",
            sections: [{ sectionId: "v1", text: "Updated" }]
        })
        expect(replaced.parallel).toHaveLength(1)
        expect(replaced.parallel?.[0]?.sections[0]?.text).toBe("Updated")

        expect(removeParallelLyricsTrack(replaced, "zu-ZA").parallel).toBeUndefined()
    })

    it("normalizes translation tracks to current timing-map sections", () => {
        const normalized = normalizeParallelLyricsTrack(twoSectionMap(), {
            language: "zu-ZA",
            sections: [
                { sectionId: "stale", text: "Old song text" },
                { sectionId: "v1", text: "Verse translation" }
            ]
        })

        expect(normalized.sections).toEqual([
            { sectionId: "v1", text: "Verse translation" },
            { sectionId: "c1", text: "" }
        ])
    })
})
