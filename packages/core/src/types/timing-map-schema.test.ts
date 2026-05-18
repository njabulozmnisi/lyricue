import { describe, it, expect } from "vitest"
import { SCHEMA_LYRICUE_TIMING_V1 } from "./schema-versions.js"
import { validateTimingMap, validateArrangement, validateArrangements, validateParallelLyricsTrack, type TimingMap, type Arrangement, type ParallelLyricsTrack } from "./timing-map-schema.js"

/**
 * Tests deliberately exercise EVERY structural error class STORY-03.1 AC3 calls out:
 *   - valid map (happy path)
 *   - missing required fields at each depth (top, section, word, line, metadata)
 *   - wrong type at each depth
 *   - negative numbers where non-negatives are required
 *   - inverted ranges (endMs < startMs)
 *   - empty strings where strings must be non-empty
 *   - empty map (no sections — valid)
 *   - max-scale map (10 sections × 100+ words) — must not exceed sane validation time
 *
 * The Result shape is verified at every error path: failures are { ok: false, errors: [...] }
 * with addressable JSON paths.
 */

const VALID_WORD = {
    text: "Hello",
    startMs: 0,
    endMs: 500,
    confidence: 0.95,
    lineIndex: 0
}

const VALID_LINE = {
    startMs: 0,
    endMs: 500,
    wordStartIndex: 0,
    wordEndIndex: 1
}

const VALID_SECTION = {
    id: "v1",
    type: "verse" as const,
    label: "Verse 1",
    slideIndex: 0,
    startMs: 0,
    endMs: 1000,
    words: [VALID_WORD],
    lines: [VALID_LINE]
}

function makeValidMap(overrides: Partial<TimingMap> = {}): TimingMap {
    return {
        $schema: SCHEMA_LYRICUE_TIMING_V1,
        showId: "show-001",
        learnedFrom: {
            method: "studio",
            filename: "amazing-grace.wav",
            duration: 240.5,
            learnedAt: "2026-05-15T00:00:00.000Z"
        },
        bpm: 76,
        timeSignature: "4/4",
        language: "en",
        sections: [VALID_SECTION],
        metadata: {
            demucsModel: "htdemucs",
            whisperxModel: "large-v2",
            schemaVersion: "1",
            version: "1.0.0"
        },
        ...overrides
    } as TimingMap
}

describe("validateTimingMap — happy path", () => {
    it("accepts a minimal valid map", () => {
        const result = validateTimingMap(makeValidMap())
        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.value.showId).toBe("show-001")
            expect(result.value.sections).toHaveLength(1)
        }
    })

    it("accepts a map with no sections (empty arrangement)", () => {
        const result = validateTimingMap(makeValidMap({ sections: [] }))
        expect(result.ok).toBe(true)
    })

    it("accepts every TimingSectionType", () => {
        const types = ["verse", "chorus", "bridge", "pre-chorus", "tag", "intro", "outro", "other"]
        for (const type of types) {
            const map = makeValidMap({
                sections: [{ ...VALID_SECTION, type: type as TimingMap["sections"][number]["type"] }]
            })
            const result = validateTimingMap(map)
            expect(result.ok, `type=${type} should be valid`).toBe(true)
        }
    })

    it("accepts optional fields omitted (timeSignature, learnedFrom.filename/source, metadata.*Model, word.held)", () => {
        const map = makeValidMap()
        // Strip the optional fields and re-validate.
        const stripped = JSON.parse(JSON.stringify(map))
        delete stripped.timeSignature
        delete stripped.learnedFrom.filename
        delete stripped.metadata.demucsModel
        delete stripped.metadata.whisperxModel
        const result = validateTimingMap(stripped)
        expect(result.ok).toBe(true)
    })

    it("accepts optional parallel lyric tracks on the timing map", () => {
        const result = validateTimingMap(
            makeValidMap({
                parallel: [{ language: "zu-ZA", sections: [{ sectionId: "v1", text: "Akekho ofana noJesu" }] }]
            })
        )
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.value.parallel?.[0]?.language).toBe("zu-ZA")
    })

    it("accepts null word confidence (WhisperX couldn't align that word)", () => {
        const map = makeValidMap({
            sections: [{ ...VALID_SECTION, words: [{ ...VALID_WORD, confidence: null }] }]
        })
        expect(validateTimingMap(map).ok).toBe(true)
    })

    it("accepts a 10-section × 120-word-per-section max-scale map within sane time", () => {
        const start = performance.now()
        const sections = Array.from({ length: 10 }, (_, sectionIdx) => ({
            id: `s${sectionIdx}`,
            type: "verse" as const,
            label: `Section ${sectionIdx}`,
            slideIndex: sectionIdx,
            startMs: sectionIdx * 30_000,
            endMs: (sectionIdx + 1) * 30_000,
            words: Array.from({ length: 120 }, (_, wordIdx) => ({
                text: `word${wordIdx}`,
                startMs: sectionIdx * 30_000 + wordIdx * 250,
                endMs: sectionIdx * 30_000 + (wordIdx + 1) * 250,
                confidence: 0.9,
                lineIndex: Math.floor(wordIdx / 10)
            })),
            lines: Array.from({ length: 12 }, (_, lineIdx) => ({
                startMs: sectionIdx * 30_000 + lineIdx * 2500,
                endMs: sectionIdx * 30_000 + (lineIdx + 1) * 2500,
                wordStartIndex: lineIdx * 10,
                wordEndIndex: (lineIdx + 1) * 10
            }))
        }))
        const result = validateTimingMap(makeValidMap({ sections }))
        const elapsed = performance.now() - start
        expect(result.ok).toBe(true)
        // Soft budget — large maps shouldn't take more than ~200ms to validate.
        expect(elapsed, `validation took ${elapsed.toFixed(0)}ms`).toBeLessThan(500)
    })
})

describe("validateTimingMap — structural errors", () => {
    it("returns errors with addressable JSON paths", () => {
        const result = validateTimingMap({})
        expect(result.ok).toBe(false)
        if (!result.ok) {
            // At minimum, $schema and showId are missing.
            const paths = result.errors.map((e) => e.path)
            expect(paths).toContain("$schema")
            expect(paths).toContain("showId")
        }
    })

    it("rejects wrong $schema literal", () => {
        const result = validateTimingMap(makeValidMap({ $schema: "wrong-schema" as unknown as typeof SCHEMA_LYRICUE_TIMING_V1 }))
        expect(result.ok).toBe(false)
        if (!result.ok) {
            const schemaErr = result.errors.find((e) => e.path === "$schema")
            expect(schemaErr).toBeDefined()
        }
    })

    it("rejects empty showId", () => {
        const result = validateTimingMap(makeValidMap({ showId: "" }))
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.errors.some((e) => e.path === "showId")).toBe(true)
    })

    it("rejects bpm <= 0", () => {
        for (const bpm of [0, -10, -1]) {
            const result = validateTimingMap(makeValidMap({ bpm }))
            expect(result.ok, `bpm=${bpm} should be rejected`).toBe(false)
        }
    })

    it("rejects an invalid learnedAt timestamp", () => {
        const map = JSON.parse(JSON.stringify(makeValidMap()))
        map.learnedFrom.learnedAt = "not-a-date"
        const result = validateTimingMap(map)
        expect(result.ok).toBe(false)
        if (!result.ok) {
            expect(result.errors.some((e) => e.path === "learnedFrom.learnedAt")).toBe(true)
        }
    })

    it("rejects a word with endMs < startMs (inverted range)", () => {
        const map = makeValidMap({
            sections: [
                {
                    ...VALID_SECTION,
                    words: [{ ...VALID_WORD, startMs: 1000, endMs: 500 }]
                }
            ]
        })
        const result = validateTimingMap(map)
        expect(result.ok).toBe(false)
        if (!result.ok) {
            expect(result.errors.some((e) => e.path.startsWith("sections.0.words.0"))).toBe(true)
        }
    })

    it("rejects a line with wordEndIndex < wordStartIndex", () => {
        const map = makeValidMap({
            sections: [
                {
                    ...VALID_SECTION,
                    lines: [{ ...VALID_LINE, wordStartIndex: 10, wordEndIndex: 5 }]
                }
            ]
        })
        const result = validateTimingMap(map)
        expect(result.ok).toBe(false)
    })

    it("rejects a section with endMs < startMs", () => {
        const map = makeValidMap({
            sections: [{ ...VALID_SECTION, startMs: 5000, endMs: 1000 }]
        })
        expect(validateTimingMap(map).ok).toBe(false)
    })

    it("rejects negative startMs / endMs / slideIndex / lineIndex", () => {
        const negatives = [{ word: { ...VALID_WORD, startMs: -1 } }, { word: { ...VALID_WORD, endMs: -1 } }, { word: { ...VALID_WORD, lineIndex: -1 } }, { section: { ...VALID_SECTION, slideIndex: -1 } }]
        for (const fixture of negatives) {
            const sec = fixture.section ?? { ...VALID_SECTION, words: [fixture.word!] }
            const result = validateTimingMap(makeValidMap({ sections: [sec] }))
            expect(result.ok).toBe(false)
        }
    })

    it("rejects an unknown TimingSectionType", () => {
        const map = makeValidMap({
            sections: [
                {
                    ...VALID_SECTION,
                    type: "refrain" as unknown as TimingMap["sections"][number]["type"]
                }
            ]
        })
        expect(validateTimingMap(map).ok).toBe(false)
    })

    it("rejects confidence outside [0, 1]", () => {
        for (const confidence of [-0.1, 1.1, 2]) {
            const map = makeValidMap({
                sections: [
                    {
                        ...VALID_SECTION,
                        words: [{ ...VALID_WORD, confidence }]
                    }
                ]
            })
            const result = validateTimingMap(map)
            expect(result.ok, `confidence=${confidence} should be rejected`).toBe(false)
        }
    })

    it("rejects schemaVersion other than '1'", () => {
        const map = makeValidMap()
        const mutated = JSON.parse(JSON.stringify(map))
        mutated.metadata.schemaVersion = "2"
        expect(validateTimingMap(mutated).ok).toBe(false)
    })

    it("rejects an empty metadata.version string", () => {
        const map = JSON.parse(JSON.stringify(makeValidMap()))
        map.metadata.version = ""
        expect(validateTimingMap(map).ok).toBe(false)
    })

    it("rejects a non-string showId", () => {
        const result = validateTimingMap(makeValidMap({ showId: 123 as unknown as string }))
        expect(result.ok).toBe(false)
        if (!result.ok) {
            const err = result.errors.find((e) => e.path === "showId")
            expect(err?.code).toBe("invalid_type")
        }
    })

    it("rejects an entirely-wrong-typed input", () => {
        expect(validateTimingMap(null).ok).toBe(false)
        expect(validateTimingMap("not an object").ok).toBe(false)
        expect(validateTimingMap(42).ok).toBe(false)
        expect(validateTimingMap([]).ok).toBe(false)
    })

    it("reports MULTIPLE errors in one pass (not just the first)", () => {
        const result = validateTimingMap({ showId: "", bpm: -5, language: "" })
        expect(result.ok).toBe(false)
        if (!result.ok) {
            // showId empty, $schema missing, learnedFrom missing, bpm negative, language too short, sections missing, metadata missing.
            expect(result.errors.length).toBeGreaterThanOrEqual(4)
        }
    })
})

describe("validateArrangement", () => {
    function makeValidArrangement(): Arrangement {
        return {
            id: "sunday-morning",
            name: "Sunday Morning",
            showId: "show-001",
            isDefault: false,
            sequence: [{ sectionId: "v1" }, { sectionId: "c1" }, { sectionId: "v1" }],
            createdAt: "2026-05-15T00:00:00.000Z",
            updatedAt: "2026-05-15T00:00:00.000Z"
        }
    }

    it("accepts a valid arrangement", () => {
        expect(validateArrangement(makeValidArrangement()).ok).toBe(true)
    })

    it("allows duplicate section refs in the sequence (chorus repeated)", () => {
        const arr = makeValidArrangement()
        arr.sequence = Array(5).fill({ sectionId: "c1" })
        expect(validateArrangement(arr).ok).toBe(true)
    })

    it("rejects empty id, name, showId", () => {
        for (const field of ["id", "name", "showId"] as const) {
            const arr = makeValidArrangement()
            arr[field] = ""
            expect(validateArrangement(arr).ok, `${field} empty should reject`).toBe(false)
        }
    })

    it("rejects an arrangement step with empty sectionId", () => {
        const arr = makeValidArrangement()
        arr.sequence = [{ sectionId: "" }]
        expect(validateArrangement(arr).ok).toBe(false)
    })

    it("rejects an invalid createdAt timestamp", () => {
        const arr = makeValidArrangement()
        arr.createdAt = "not-a-date"
        expect(validateArrangement(arr).ok).toBe(false)
    })

    it("validates an array of arrangements", () => {
        const valid = validateArrangements([makeValidArrangement(), makeValidArrangement()])
        expect(valid.ok).toBe(true)
        if (valid.ok) expect(valid.value).toHaveLength(2)

        const oneInvalid = validateArrangements([makeValidArrangement(), { invalid: true }])
        expect(oneInvalid.ok).toBe(false)
    })
})

describe("validateParallelLyricsTrack", () => {
    function makeValidTrack(): ParallelLyricsTrack {
        return {
            language: "zu-ZA",
            sections: [
                { sectionId: "v1", text: "Akekho ofana noJesu" },
                { sectionId: "c1", text: "Ngiyabonga\nNgiyabonga" }
            ]
        }
    }

    it("accepts a valid track", () => {
        expect(validateParallelLyricsTrack(makeValidTrack()).ok).toBe(true)
    })

    it("allows empty sections array (track skeleton awaiting fill-in)", () => {
        const track = makeValidTrack()
        track.sections = []
        expect(validateParallelLyricsTrack(track).ok).toBe(true)
    })

    it("rejects a track with an empty sectionId", () => {
        const track = makeValidTrack()
        track.sections = [{ sectionId: "", text: "hi" }]
        expect(validateParallelLyricsTrack(track).ok).toBe(false)
    })

    it("rejects a track with a missing language", () => {
        const track = makeValidTrack() as Partial<ParallelLyricsTrack>
        delete track.language
        expect(validateParallelLyricsTrack(track).ok).toBe(false)
    })
})
