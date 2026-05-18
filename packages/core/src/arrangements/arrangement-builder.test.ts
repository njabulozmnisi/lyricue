import { describe, expect, it } from "vitest"
import { arrangementToFreeShowLayout, createArrangement, duplicateArrangementStep, moveArrangementStep, parseArrangementShorthand, removeArrangementStep, selectActiveArrangement } from "./arrangement-builder.js"
import type { Arrangement, TimingMap, TimingSection, TimingSectionType } from "../types/timing-map.js"
import { SCHEMA_LYRICUE_TIMING_V1 } from "../types/schema-versions.js"

function section(id: string, type: TimingSectionType, label: string, slideIndex: number): TimingSection {
    return {
        id,
        type,
        label,
        slideIndex,
        startMs: slideIndex * 1000,
        endMs: slideIndex * 1000 + 1000,
        words: [],
        lines: []
    }
}

function map(): TimingMap {
    return {
        $schema: SCHEMA_LYRICUE_TIMING_V1,
        showId: "show-1",
        learnedFrom: { method: "studio", duration: 40, learnedAt: "2026-05-18T00:00:00Z" },
        bpm: 120,
        language: "en",
        metadata: { schemaVersion: "1", version: "1.0.0" },
        sections: [section("verse1", "verse", "Verse 1", 0), section("chorus", "chorus", "Chorus", 1), section("verse2", "verse", "Verse 2", 2), section("bridge1", "bridge", "Bridge 1", 3), section("bridge2", "bridge", "Bridge 2", 4), section("tag", "tag", "Tag", 5), section("outro", "outro", "Outro", 6)]
    }
}

function arrangement(id: string, isDefault = false): Arrangement {
    return createArrangement({
        id,
        name: id,
        showId: "show-1",
        isDefault,
        sequence: [{ sectionId: "verse1" }],
        now: "2026-05-18T00:00:00Z"
    })
}

describe("arrangement builder", () => {
    it("parses common arrangement shorthand into section references", () => {
        const parsed = parseArrangementShorthand("V1 C V2 C B2 Tag Outro", map())
        expect(parsed.unknownTokens).toEqual([])
        expect(parsed.sequence.map((step) => step.sectionId)).toEqual(["verse1", "chorus", "verse2", "chorus", "bridge2", "tag", "outro"])
    })

    it("keeps unrecognized shorthand tokens visible to the operator", () => {
        const parsed = parseArrangementShorthand("V1 Vamp C", map())
        expect(parsed.sequence.map((step) => step.sectionId)).toEqual(["verse1", "chorus"])
        expect(parsed.unknownTokens).toEqual(["Vamp"])
    })

    it("moves, duplicates, and removes sequence steps without mutating the input", () => {
        const sequence = [{ sectionId: "verse1" }, { sectionId: "chorus" }, { sectionId: "bridge1" }]
        expect(moveArrangementStep(sequence, 2, 0).map((step) => step.sectionId)).toEqual(["bridge1", "verse1", "chorus"])
        expect(duplicateArrangementStep(sequence, 1).map((step) => step.sectionId)).toEqual(["verse1", "chorus", "chorus", "bridge1"])
        expect(removeArrangementStep(sequence, 0).map((step) => step.sectionId)).toEqual(["chorus", "bridge1"])
        expect(sequence.map((step) => step.sectionId)).toEqual(["verse1", "chorus", "bridge1"])
    })

    it("creates and selects named arrangements", () => {
        const defaultArrangement = arrangement("default", true)
        const special = arrangement("sunday")
        expect(defaultArrangement.createdAt).toBe("2026-05-18T00:00:00Z")
        expect(selectActiveArrangement([defaultArrangement, special], "sunday")).toBe(special)
        expect(selectActiveArrangement([defaultArrangement, special], null)).toBe(defaultArrangement)
    })

    it("projects an arrangement to a FreeShow slide sequence", () => {
        const arr = createArrangement({
            id: "sunday",
            name: "Sunday",
            showId: "show-1",
            sequence: [{ sectionId: "chorus" }, { sectionId: "verse1" }, { sectionId: "chorus" }],
            now: "2026-05-18T00:00:00Z"
        })
        expect(arrangementToFreeShowLayout(arr, map())).toEqual({
            id: "sunday",
            name: "Sunday",
            slides: [1, 0, 1]
        })
    })

    it("rejects layout projection when an arrangement references a missing section", () => {
        const arr = createArrangement({
            id: "bad",
            name: "Bad",
            showId: "show-1",
            sequence: [{ sectionId: "missing" }],
            now: "2026-05-18T00:00:00Z"
        })
        expect(() => arrangementToFreeShowLayout(arr, map())).toThrow(/unknown section/)
    })
})
