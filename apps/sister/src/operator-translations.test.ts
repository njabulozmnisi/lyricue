import { describe, expect, it } from "vitest"
import { SCHEMA_LYRICUE_TIMING_V1, type TimingMap, type TimingSection } from "@lyricue/core/types"
import type { TimingMapVariant } from "@lyricue/core/setlist"
import { prepareOperatorTranslationSave } from "./operator-translations.js"

function section(id: string, label = id): TimingSection {
    return {
        id,
        type: "verse",
        label,
        slideIndex: 0,
        startMs: 0,
        endMs: 1000,
        words: [{ text: label, startMs: 0, endMs: 1000, confidence: 0.99, lineIndex: 0 }],
        lines: [{ startMs: 0, endMs: 1000, wordStartIndex: 0, wordEndIndex: 1 }]
    }
}

function map(opts: { showId?: string; method?: "studio" | "rehearsal"; bpm?: number; sections?: TimingSection[] } = {}): TimingMap {
    return {
        $schema: SCHEMA_LYRICUE_TIMING_V1,
        showId: opts.showId ?? "show-1",
        learnedFrom: { method: opts.method ?? "studio", duration: 20, learnedAt: "2026-06-06T00:00:00.000Z" },
        bpm: opts.bpm ?? 120,
        language: "en",
        sections: opts.sections ?? [section("v1", "Verse 1"), section("c1", "Chorus")],
        metadata: { schemaVersion: "1", version: "1.0.0" }
    }
}

function resolver(studio = map(), rehearsal: TimingMap | null = null): (showId: string, variant: TimingMapVariant) => TimingMap | null {
    return (showId, variant) => {
        if (showId !== "show-1") return null
        return variant === "rehearsal" ? rehearsal : studio
    }
}

describe("prepareOperatorTranslationSave", () => {
    it("applies only normalized parallel tracks to the authoritative timing map", () => {
        const current = map({ bpm: 120 })
        const rendererMap: TimingMap = {
            ...map({ bpm: 60, sections: [section("stale", "Stale")] }),
            parallel: [
                {
                    language: "zu-ZA",
                    sections: [
                        { sectionId: "stale", text: "Must be dropped" },
                        { sectionId: "c1", text: "Ikhorasi" }
                    ]
                }
            ]
        }

        const result = prepareOperatorTranslationSave(rendererMap, resolver(current))

        expect(result).toEqual({
            ok: true,
            value: {
                variant: "studio",
                map: {
                    ...current,
                    parallel: [
                        {
                            language: "zu-ZA",
                            sections: [
                                { sectionId: "v1", text: "" },
                                { sectionId: "c1", text: "Ikhorasi" }
                            ]
                        }
                    ]
                }
            }
        })
    })

    it("routes rehearsal translation saves to the rehearsal timing-map variant", () => {
        const rehearsal = map({ method: "rehearsal", bpm: 118 })
        const rendererMap: TimingMap = {
            ...rehearsal,
            parallel: [{ language: "xh-ZA", sections: [{ sectionId: "v1", text: "Ivesi" }] }]
        }

        const result = prepareOperatorTranslationSave(rendererMap, resolver(map(), rehearsal))

        expect(result.ok && result.value.variant).toBe("rehearsal")
        expect(result.ok && result.value.map.bpm).toBe(118)
        expect(result.ok && result.value.map.parallel?.[0]?.sections).toEqual([
            { sectionId: "v1", text: "Ivesi" },
            { sectionId: "c1", text: "" }
        ])
    })

    it("rejects translation saves for unknown shows", () => {
        expect(prepareOperatorTranslationSave(map({ showId: "missing" }), resolver())).toEqual({
            ok: false,
            message: "unknown showId=missing"
        })
    })
})
