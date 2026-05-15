import { describe, it, expect } from "vitest"
import { TEMPO_RATIO_MIN, TEMPO_RATIO_MAX, tempoRatio } from "./tempo.js"

/**
 * STORY-07.6 acceptance tests.
 *
 * AC1: Function in packages/core/audio/tempo.ts ✓
 * AC2: Returns 1.0 when either input is null/0 ✓
 * AC3: Returns 1.0 when raw ratio is outside [0.7, 1.4] (and surfaces via `wasClamped` + `reason`) ✓
 * AC4: Unit tests cover the clamp boundaries ✓
 */

describe("tempoRatio — happy path", () => {
    it("returns the exact ratio when within the clamp band", () => {
        const r = tempoRatio(120, 120)
        expect(r.ratio).toBe(1.0)
        expect(r.rawRatio).toBe(1.0)
        expect(r.wasClamped).toBe(false)
        expect(r.reason).toBe("ok")
    })

    it("returns 1.2 when live is 20% faster than reference", () => {
        const r = tempoRatio(144, 120)
        expect(r.ratio).toBeCloseTo(1.2)
        expect(r.wasClamped).toBe(false)
        expect(r.reason).toBe("ok")
    })

    it("returns 0.8 when live is 20% slower than reference", () => {
        const r = tempoRatio(96, 120)
        expect(r.ratio).toBeCloseTo(0.8)
        expect(r.wasClamped).toBe(false)
        expect(r.reason).toBe("ok")
    })
})

describe("tempoRatio — clamp boundaries", () => {
    it("accepts the exact min boundary (raw = 0.7)", () => {
        const r = tempoRatio(70, 100)
        expect(r.ratio).toBeCloseTo(TEMPO_RATIO_MIN)
        expect(r.wasClamped).toBe(false)
        expect(r.reason).toBe("ok")
    })

    it("accepts the exact max boundary (raw = 1.4)", () => {
        const r = tempoRatio(140, 100)
        expect(r.ratio).toBeCloseTo(TEMPO_RATIO_MAX)
        expect(r.wasClamped).toBe(false)
        expect(r.reason).toBe("ok")
    })

    it("rejects a hair below the min — returns 1.0 with reason 'clamped'", () => {
        const r = tempoRatio(69, 100) // 0.69
        expect(r.ratio).toBe(1.0)
        expect(r.rawRatio).toBeCloseTo(0.69)
        expect(r.wasClamped).toBe(true)
        expect(r.reason).toBe("clamped")
    })

    it("rejects a hair above the max — returns 1.0 with reason 'clamped'", () => {
        const r = tempoRatio(141, 100) // 1.41
        expect(r.ratio).toBe(1.0)
        expect(r.rawRatio).toBeCloseTo(1.41)
        expect(r.wasClamped).toBe(true)
        expect(r.reason).toBe("clamped")
    })

    it("rejects a doubled-beat artefact (raw = 2.0) — common BD failure mode", () => {
        const r = tempoRatio(240, 120)
        expect(r.ratio).toBe(1.0)
        expect(r.wasClamped).toBe(true)
        expect(r.reason).toBe("clamped")
    })

    it("rejects a halved-beat artefact (raw = 0.5) — another common BD failure mode", () => {
        const r = tempoRatio(60, 120)
        expect(r.ratio).toBe(1.0)
        expect(r.wasClamped).toBe(true)
        expect(r.reason).toBe("clamped")
    })
})

describe("tempoRatio — sentinel inputs", () => {
    it("returns 1.0 + reason='live-bpm-missing' when liveBPM is null", () => {
        const r = tempoRatio(null, 120)
        expect(r.ratio).toBe(1.0)
        expect(r.rawRatio).toBeNull()
        expect(r.wasClamped).toBe(false)
        expect(r.reason).toBe("live-bpm-missing")
    })

    it("returns 1.0 + reason='live-bpm-missing' when liveBPM is undefined", () => {
        const r = tempoRatio(undefined, 120)
        expect(r.ratio).toBe(1.0)
        expect(r.reason).toBe("live-bpm-missing")
    })

    it("returns 1.0 + reason='live-bpm-missing' when liveBPM is 0", () => {
        const r = tempoRatio(0, 120)
        expect(r.ratio).toBe(1.0)
        expect(r.reason).toBe("live-bpm-missing")
    })

    it("returns 1.0 + reason='reference-bpm-missing' when referenceBPM is null", () => {
        const r = tempoRatio(120, null)
        expect(r.ratio).toBe(1.0)
        expect(r.reason).toBe("reference-bpm-missing")
    })

    it("returns 1.0 + reason='reference-bpm-missing' when referenceBPM is 0", () => {
        const r = tempoRatio(120, 0)
        expect(r.ratio).toBe(1.0)
        expect(r.reason).toBe("reference-bpm-missing")
    })
})

describe("tempoRatio — non-finite guard", () => {
    it("rejects NaN liveBPM", () => {
        const r = tempoRatio(Number.NaN, 120)
        expect(r.ratio).toBe(1.0)
        expect(r.reason).toBe("non-finite")
    })

    it("rejects Infinity referenceBPM", () => {
        const r = tempoRatio(120, Number.POSITIVE_INFINITY)
        expect(r.ratio).toBe(1.0)
        expect(r.reason).toBe("non-finite")
    })

    it("rejects -Infinity", () => {
        const r = tempoRatio(Number.NEGATIVE_INFINITY, 120)
        expect(r.ratio).toBe(1.0)
        expect(r.reason).toBe("non-finite")
    })

    it("rejects negative liveBPM as clamped (raw < 0 < 0.7)", () => {
        // A negative BPM is non-sensical but Number.isFinite returns true for it.
        // We treat it as a clamp violation (it's outside the legal band).
        const r = tempoRatio(-60, 120)
        expect(r.ratio).toBe(1.0)
        expect(r.wasClamped).toBe(true)
        expect(r.reason).toBe("clamped")
    })
})
