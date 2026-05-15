import { describe, it, expect } from "vitest"
import {
    WORD_EASE_BASELINE_MS,
    WORD_EASE_MAX_MS,
    WORD_EASE_MIN_MS,
    wordEaseMs
} from "./karaoke-easing.js"

/**
 * Tempo-adaptive easing — operator feedback 2026-05-15.
 *
 * The map is piecewise-linear with three anchor points:
 *   ≤200ms  → 50ms (staccato)
 *    500ms  → 80ms (baseline)
 *   ≥1500ms → 200ms (held)
 *
 * Tests pin the anchors + verify the interpolation behaviour + defensive guards.
 */

describe("wordEaseMs — anchor points", () => {
    it("returns 50ms for staccato words (≤200ms duration)", () => {
        expect(wordEaseMs(200)).toBe(WORD_EASE_MIN_MS)
        expect(wordEaseMs(150)).toBe(WORD_EASE_MIN_MS)
        expect(wordEaseMs(1)).toBe(WORD_EASE_MIN_MS)
    })

    it("returns the documented 80ms baseline at 500ms", () => {
        expect(wordEaseMs(500)).toBe(WORD_EASE_BASELINE_MS)
    })

    it("returns 200ms for held notes (≥1500ms duration)", () => {
        expect(wordEaseMs(1500)).toBe(WORD_EASE_MAX_MS)
        expect(wordEaseMs(3000)).toBe(WORD_EASE_MAX_MS)
        expect(wordEaseMs(60_000)).toBe(WORD_EASE_MAX_MS)
    })
})

describe("wordEaseMs — interpolation", () => {
    it("interpolates linearly between 200ms and 500ms (50ms → 80ms ease)", () => {
        // Midpoint: 350ms → 65ms ease
        expect(wordEaseMs(350)).toBeCloseTo(65, 5)
        // 300ms → 60ms (1/3 of the way)
        expect(wordEaseMs(300)).toBeCloseTo(60, 5)
    })

    it("interpolates linearly between 500ms and 1500ms (80ms → 200ms ease)", () => {
        // Midpoint: 1000ms → 140ms ease
        expect(wordEaseMs(1000)).toBeCloseTo(140, 5)
        // 750ms → 110ms (1/4 of the way)
        expect(wordEaseMs(750)).toBeCloseTo(110, 5)
    })

    it("is monotonic across positive valid inputs — longer words never get a shorter ease", () => {
        // Note: wordEaseMs(0) and wordEaseMs(<0) return the 80ms baseline as a defensive
        // guard, which is intentionally outside the monotonic curve. The monotonic
        // property only applies to legitimate positive word durations.
        let last = wordEaseMs(1)
        for (let d = 50; d <= 2000; d += 50) {
            const curr = wordEaseMs(d)
            expect(curr).toBeGreaterThanOrEqual(last)
            last = curr
        }
    })

    it("never falls outside [50, 200] for any positive finite input", () => {
        const inputs = [10, 100, 200, 350, 500, 700, 1000, 1500, 5000, 60000]
        for (const d of inputs) {
            const ease = wordEaseMs(d)
            expect(ease).toBeGreaterThanOrEqual(WORD_EASE_MIN_MS)
            expect(ease).toBeLessThanOrEqual(WORD_EASE_MAX_MS)
        }
    })
})

describe("wordEaseMs — defensive guards", () => {
    it("returns the 80ms baseline for non-finite inputs", () => {
        expect(wordEaseMs(Number.NaN)).toBe(WORD_EASE_BASELINE_MS)
        expect(wordEaseMs(Number.POSITIVE_INFINITY)).toBe(WORD_EASE_BASELINE_MS)
        expect(wordEaseMs(Number.NEGATIVE_INFINITY)).toBe(WORD_EASE_BASELINE_MS)
    })

    it("returns the 80ms baseline for zero or negative durations", () => {
        expect(wordEaseMs(0)).toBe(WORD_EASE_BASELINE_MS)
        expect(wordEaseMs(-100)).toBe(WORD_EASE_BASELINE_MS)
    })
})

describe("wordEaseMs — realistic worship-music inputs", () => {
    it("a typical syllable in a moderate-tempo worship song (~400ms) gets ~70ms ease", () => {
        // 400ms → 50 + (200/300)*30 = 70
        expect(wordEaseMs(400)).toBeCloseTo(70, 5)
    })

    it("a sustained chorus syllable (~800ms) gets ~116ms ease", () => {
        // 800ms → 80 + (300/1000)*120 = 116
        expect(wordEaseMs(800)).toBeCloseTo(116, 5)
    })

    it("a 'lord' held note in a worship ballad (~2000ms) saturates at 200ms ease", () => {
        expect(wordEaseMs(2000)).toBe(WORD_EASE_MAX_MS)
    })

    it("a fast staccato in an uptempo song (~120ms) gets the 50ms snap", () => {
        expect(wordEaseMs(120)).toBe(WORD_EASE_MIN_MS)
    })
})
