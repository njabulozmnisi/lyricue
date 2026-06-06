import { describe, expect, it } from "vitest"
import { SCHEMA_LYRICUE_TIMING_V1, type Arrangement, type TimingMap, type TimingSection } from "@lyricue/core/types"
import { prepareOperatorArrangementSave } from "./operator-arrangements.js"

function section(id: string): TimingSection {
    return {
        id,
        type: "verse",
        label: id,
        slideIndex: 0,
        startMs: 0,
        endMs: 1000,
        words: [],
        lines: []
    }
}

const map: TimingMap = {
    $schema: SCHEMA_LYRICUE_TIMING_V1,
    showId: "show-1",
    learnedFrom: { method: "studio", duration: 20, learnedAt: "2026-06-06T00:00:00.000Z" },
    bpm: 120,
    language: "en",
    sections: [section("v1"), section("c1")],
    metadata: { schemaVersion: "1", version: "1.0.0" }
}

function arrangement(sequence = [{ sectionId: "v1" }]): Arrangement {
    return {
        id: "default",
        name: "Default",
        showId: "show-1",
        isDefault: true,
        sequence,
        createdAt: "2026-06-06T00:00:00.000Z",
        updatedAt: "2026-06-06T00:00:00.000Z"
    }
}

describe("prepareOperatorArrangementSave", () => {
    it("normalizes stale section IDs before the main process persists an arrangement", () => {
        const result = prepareOperatorArrangementSave(arrangement([{ sectionId: "stale" }, { sectionId: "c1" }]), (showId) => (showId === "show-1" ? map : null))

        expect(result).toEqual({
            ok: true,
            arrangement: {
                ...arrangement([{ sectionId: "stale" }, { sectionId: "c1" }]),
                sequence: [{ sectionId: "c1" }]
            }
        })
    })

    it("rejects arrangements for unknown shows", () => {
        expect(prepareOperatorArrangementSave({ ...arrangement(), showId: "missing" }, () => null)).toEqual({
            ok: false,
            message: "unknown showId=missing"
        })
    })

    it("rejects arrangements with no sections in the active timing map", () => {
        expect(prepareOperatorArrangementSave(arrangement([{ sectionId: "stale" }]), () => map)).toEqual({
            ok: false,
            message: 'arrangement "default" has no sections in active timing map'
        })
    })
})
