import { describe, expect, it } from "vitest"
import { SCHEMA_LYRICUE_TIMING_V1 } from "../types/schema-versions.js"
import type { ParallelLyricsTrack, TimingMap, TimingSection } from "../types/timing-map.js"
import {
    createParallelLyricsDraft,
    normalizeParallelLyricsTrack,
    projectTimingMapToPrimaryLanguage,
    removeParallelLyricsTrack,
    sectionPlainText,
    upsertParallelLyricsTrack
} from "./parallel-lyrics.js"

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

describe("projectTimingMapToPrimaryLanguage (EP-19 translated-primary)", () => {
    it("returns the input unchanged when the requested language is already primary", () => {
        const original = map([{ language: "zu-ZA", sections: [{ sectionId: "v1", text: "Umusa omangalisayo" }] }])
        const projected = projectTimingMapToPrimaryLanguage(original, "en")
        expect(projected).toBe(original)
    })

    it("returns the input unchanged when no parallel track exists for the language", () => {
        const original = map()
        const projected = projectTimingMapToPrimaryLanguage(original, "es-ES")
        expect(projected).toBe(original)
    })

    it("promotes a parallel track to primary and swaps section words to the translated text", () => {
        const original = map([{ language: "zu-ZA", sections: [{ sectionId: "v1", text: "Umusa omangalisayo" }] }])
        const projected = projectTimingMapToPrimaryLanguage(original, "zu-ZA")
        expect(projected.language).toBe("zu-ZA")
        expect(projected.sections).toHaveLength(1)
        const section0 = projected.sections[0]!
        expect(section0.words).toHaveLength(1)
        expect(section0.words[0]!.text).toBe("Umusa omangalisayo")
        // Section envelope preserved.
        expect(section0.startMs).toBe(0)
        expect(section0.endMs).toBe(1000)
        // Lines reset because per-word boundaries no longer map cleanly.
        expect(section0.lines).toEqual([])
    })

    it("demotes the original learned-language words to a parallel track so operators can toggle back", () => {
        const original = map([{ language: "zu-ZA", sections: [{ sectionId: "v1", text: "Umusa omangalisayo" }] }])
        const projected = projectTimingMapToPrimaryLanguage(original, "zu-ZA")
        const englishTrack = projected.parallel?.find((track) => track.language === "en")
        expect(englishTrack, "original english must be retained as a parallel track").toBeDefined()
        expect(englishTrack?.sections[0]?.text).toBe("Amazing grace")
    })

    it("does not duplicate the learned-language parallel track when one already exists", () => {
        const withEnglishOverride: ParallelLyricsTrack = {
            language: "en",
            sections: [{ sectionId: "v1", text: "Operator-edited English text" }]
        }
        const zuluTrack: ParallelLyricsTrack = {
            language: "zu-ZA",
            sections: [{ sectionId: "v1", text: "Umusa omangalisayo" }]
        }
        const original = map([withEnglishOverride, zuluTrack])
        const projected = projectTimingMapToPrimaryLanguage(original, "zu-ZA")
        const englishTracks = projected.parallel?.filter((track) => track.language === "en") ?? []
        expect(englishTracks).toHaveLength(1)
        // Operator's edited English text is preserved — not overwritten by the auto-demotion.
        expect(englishTracks[0]?.sections[0]?.text).toBe("Operator-edited English text")
    })

    it("does not mutate the input map", () => {
        const original = map([{ language: "zu-ZA", sections: [{ sectionId: "v1", text: "Umusa omangalisayo" }] }])
        const beforeLanguage = original.language
        const beforeSectionWordCount = original.sections[0]!.words.length
        projectTimingMapToPrimaryLanguage(original, "zu-ZA")
        expect(original.language).toBe(beforeLanguage)
        expect(original.sections[0]!.words.length).toBe(beforeSectionWordCount)
    })

    it("handles multi-section maps with partial translation coverage (empty text for missing sections)", () => {
        const twoSection = twoSectionMap([
            { language: "es-ES", sections: [{ sectionId: "v1", text: "Verso uno" }] } // chorus missing
        ])
        const projected = projectTimingMapToPrimaryLanguage(twoSection, "es-ES")
        expect(projected.sections[0]!.words[0]!.text).toBe("Verso uno")
        expect(projected.sections[1]!.words[0]!.text).toBe("") // empty fallback for missing section
    })
})
