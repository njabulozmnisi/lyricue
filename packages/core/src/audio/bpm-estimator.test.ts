import { describe, it, expect } from "vitest"
import {
    createBpmEstimator,
    DEFAULT_EMA_ALPHA,
    MIN_ONSETS_FOR_BPM,
    BPM_MIN,
    BPM_MAX,
    ONSET_REFRACTORY_MS
} from "./bpm-estimator.js"

/**
 * STORY-07.5 acceptance tests.
 *
 * Pure-logic coverage. We feed deterministic synthetic flux/time sequences and assert
 * the estimator's output. Real-audio latency (AC5, ≤200ms with a 60-BPM click track) is
 * deferred to STORY-07.7's loopback harness — not exercisable in unit tests.
 *
 * The fixtures below simulate a steady BPM by spacing high-flux samples at the
 * appropriate IOI. We thread `nowMs` manually so the test runs in the kernel of seconds,
 * not wall-clock.
 */

/**
 * Helper: feed the estimator a synthetic stream that simulates a steady BPM. Each beat
 * is one high-flux sample at `bpm`-derived IOI, interleaved with low-flux samples that
 * keep the running-median threshold honest.
 */
function feedSteadyBpm(
    estimator: ReturnType<typeof createBpmEstimator>,
    bpm: number,
    beats: number,
    options: { startMs?: number; lowFlux?: number; highFlux?: number; samplesBetweenBeats?: number } = {}
) {
    const ioiMs = 60_000 / bpm
    const startMs = options.startMs ?? 0
    const lowFlux = options.lowFlux ?? 0.1
    const highFlux = options.highFlux ?? 1.0
    const samplesBetween = options.samplesBetweenBeats ?? 8
    const dt = ioiMs / samplesBetween

    let now = startMs
    for (let beat = 0; beat < beats; beat++) {
        // Low-flux filler samples between beats so the running-median has data.
        for (let i = 0; i < samplesBetween - 1; i++) {
            estimator.feed(lowFlux, now)
            now += dt
        }
        // The beat itself — a high-flux sample.
        estimator.feed(highFlux, now)
        now += dt
    }
    return now
}

describe("createBpmEstimator — initial state", () => {
    it("starts with liveBPM=null + onsetCount=0 + confidence=0", () => {
        const est = createBpmEstimator()
        const s = est.state()
        expect(s.liveBPM).toBeNull()
        expect(s.onsetCount).toBe(0)
        expect(s.beatConfidence).toBe(0)
        expect(s.lastWasOnset).toBe(false)
    })
})

describe("createBpmEstimator — onset detection", () => {
    it("flags an onset when flux exceeds threshold + refractory period passes", () => {
        const est = createBpmEstimator({ fluxWindowSamples: 10, fluxThresholdMultiplier: 1.5 })
        // Prime the median with low values.
        for (let i = 0; i < 10; i++) est.feed(0.1, i * 10)
        // A burst at t=200ms should fire.
        const s = est.feed(2.0, 200)
        expect(s.lastWasOnset).toBe(true)
    })

    it("does NOT flag an onset if flux is below threshold", () => {
        const est = createBpmEstimator({ fluxWindowSamples: 10, fluxThresholdMultiplier: 1.5 })
        for (let i = 0; i < 10; i++) est.feed(0.5, i * 10)
        // Same magnitude as the median — not enough to trigger 1.5x threshold.
        const s = est.feed(0.5, 200)
        expect(s.lastWasOnset).toBe(false)
    })

    it("respects the refractory period (no double-trigger within 60ms)", () => {
        const est = createBpmEstimator({ fluxWindowSamples: 10, fluxThresholdMultiplier: 1.5 })
        for (let i = 0; i < 10; i++) est.feed(0.1, i * 10)
        const a = est.feed(2.0, 200)
        const b = est.feed(2.0, 200 + ONSET_REFRACTORY_MS - 1)
        expect(a.lastWasOnset).toBe(true)
        expect(b.lastWasOnset).toBe(false)
        expect(est.state().onsetCount).toBe(1)
    })

    it("coerces non-finite flux to 0 (does not throw)", () => {
        const est = createBpmEstimator()
        expect(() => est.feed(Number.NaN, 0)).not.toThrow()
        expect(() => est.feed(Number.POSITIVE_INFINITY, 10)).not.toThrow()
        expect(() => est.feed(-1, 20)).not.toThrow()
        expect(est.state().onsetCount).toBe(0)
    })
})

describe("createBpmEstimator — BPM detection", () => {
    it("does not emit a BPM until MIN_ONSETS_FOR_BPM onsets accumulate", () => {
        const est = createBpmEstimator()
        // Feed exactly MIN_ONSETS_FOR_BPM - 1 onsets at 120 BPM.
        feedSteadyBpm(est, 120, MIN_ONSETS_FOR_BPM - 1)
        expect(est.state().liveBPM).toBeNull()
    })

    it("detects 120 BPM from a clean synthetic stream", () => {
        const est = createBpmEstimator()
        feedSteadyBpm(est, 120, 16)
        const bpm = est.state().liveBPM!
        expect(bpm).toBeGreaterThan(118)
        expect(bpm).toBeLessThan(122)
    })

    it("detects 60 BPM", () => {
        const est = createBpmEstimator()
        feedSteadyBpm(est, 60, 12)
        const bpm = est.state().liveBPM!
        expect(bpm).toBeGreaterThan(58)
        expect(bpm).toBeLessThan(62)
    })

    it("detects 100 BPM", () => {
        const est = createBpmEstimator()
        feedSteadyBpm(est, 100, 16)
        const bpm = est.state().liveBPM!
        expect(bpm).toBeGreaterThan(98)
        expect(bpm).toBeLessThan(102)
    })

    it("detects 140 BPM", () => {
        const est = createBpmEstimator()
        feedSteadyBpm(est, 140, 20)
        const bpm = est.state().liveBPM!
        expect(bpm).toBeGreaterThan(138)
        expect(bpm).toBeLessThan(142)
    })

    it("rejects implausible BPMs outside [BPM_MIN, BPM_MAX]", () => {
        // 240 BPM (above BPM_MAX 220). All onsets at the over-fast IOI should not yield a
        // dominant period in the legal band, so liveBPM stays null.
        const est = createBpmEstimator()
        feedSteadyBpm(est, 250, 12, { samplesBetweenBeats: 4 })
        expect(est.state().liveBPM).toBeNull()
        expect(BPM_MIN).toBeLessThanOrEqual(40)
        expect(BPM_MAX).toBeGreaterThanOrEqual(220)
    })
})

describe("createBpmEstimator — EMA smoothing", () => {
    it("applies the documented α=0.2 smoothing (matches architecture.md §4.5)", () => {
        expect(DEFAULT_EMA_ALPHA).toBe(0.2)
    })

    it("converges toward a new tempo when the live BPM shifts", () => {
        const est = createBpmEstimator()
        let now = feedSteadyBpm(est, 100, 12)
        const before = est.state().liveBPM!
        expect(before).toBeGreaterThan(98)
        expect(before).toBeLessThan(102)

        // Shift to 130 BPM. EMA needs several onsets to converge.
        now = feedSteadyBpm(est, 130, 12, { startMs: now })
        const after = est.state().liveBPM!
        // Should have moved meaningfully toward 130 but not necessarily reach it
        // depending on the EMA window — assert it's at least past the midpoint.
        expect(after).toBeGreaterThan(before + 10)
    })

    it("custom emaAlpha overrides the default", () => {
        const fastEst = createBpmEstimator({ emaAlpha: 0.8 })
        const slowEst = createBpmEstimator({ emaAlpha: 0.05 })
        let nowFast = feedSteadyBpm(fastEst, 100, 8)
        let nowSlow = feedSteadyBpm(slowEst, 100, 8)
        nowFast = feedSteadyBpm(fastEst, 150, 8, { startMs: nowFast })
        nowSlow = feedSteadyBpm(slowEst, 150, 8, { startMs: nowSlow })
        // Faster alpha converges more aggressively.
        const fastBpm = fastEst.state().liveBPM!
        const slowBpm = slowEst.state().liveBPM!
        expect(fastBpm).toBeGreaterThan(slowBpm)
    })
})

describe("createBpmEstimator — confidence", () => {
    it("gives high confidence (>0.9) for a perfectly steady tempo", () => {
        const est = createBpmEstimator()
        feedSteadyBpm(est, 120, 16)
        const c = est.state().beatConfidence
        expect(c).toBeGreaterThan(0.9)
    })

    it("gives lower confidence for an erratic tempo", () => {
        const est = createBpmEstimator({ fluxWindowSamples: 10, fluxThresholdMultiplier: 1.5 })
        // Prime the median.
        for (let i = 0; i < 10; i++) est.feed(0.1, i * 5)
        // Onsets at irregular intervals — half-second, two-second, three-second, etc.
        est.feed(2.0, 100)
        est.feed(2.0, 600)
        est.feed(2.0, 2500)
        est.feed(2.0, 3000)
        est.feed(2.0, 5800)
        const c = est.state().beatConfidence
        expect(c).toBeLessThan(0.6)
    })

    it("returns confidence=0 with fewer than MIN_ONSETS_FOR_BPM onsets", () => {
        const est = createBpmEstimator()
        feedSteadyBpm(est, 120, 2) // only 2 onsets
        expect(est.state().beatConfidence).toBe(0)
    })
})

describe("createBpmEstimator — reset", () => {
    it("clears all state to fresh-init values", () => {
        const est = createBpmEstimator()
        feedSteadyBpm(est, 120, 12)
        expect(est.state().liveBPM).not.toBeNull()
        est.reset()
        const s = est.state()
        expect(s.liveBPM).toBeNull()
        expect(s.onsetCount).toBe(0)
        expect(s.beatConfidence).toBe(0)
    })

    it("a fresh estimator after reset can re-acquire a different BPM", () => {
        const est = createBpmEstimator()
        feedSteadyBpm(est, 120, 16)
        est.reset()
        feedSteadyBpm(est, 80, 16)
        const bpm = est.state().liveBPM!
        expect(bpm).toBeGreaterThan(78)
        expect(bpm).toBeLessThan(82)
    })
})

describe("createBpmEstimator — windowing", () => {
    it("drops onsets older than ioiWindowMs", () => {
        // Larger flux window so the adaptive threshold doesn't track up to the burst
        // amplitude after just a few onsets — keeps the median in the noise floor.
        const est = createBpmEstimator({ ioiWindowMs: 1000, fluxWindowSamples: 50, fluxThresholdMultiplier: 1.5 })
        // Prime median with 50 noise samples.
        for (let i = 0; i < 50; i++) est.feed(0.1, i * 5)
        // Three onsets in the first second after priming. Note: priming ran t=0..245, so
        // we use timestamps > 245 + refractory for clean onset detection.
        est.feed(2.0, 300)
        est.feed(2.0, 500)
        est.feed(2.0, 700)
        expect(est.state().onsetCount).toBe(3)
        // A fourth onset 2 seconds later — the first three should fall out of the window.
        est.feed(2.0, 2700)
        const count = est.state().onsetCount
        expect(count).toBe(1)
    })
})

describe("createBpmEstimator — never throws", () => {
    it("survives an empty input stream (no calls to feed)", () => {
        const est = createBpmEstimator()
        expect(() => est.state()).not.toThrow()
        expect(() => est.reset()).not.toThrow()
    })

    it("survives non-monotonic timestamps without crashing", () => {
        const est = createBpmEstimator()
        expect(() => {
            est.feed(0.5, 100)
            est.feed(0.5, 50) // time went backwards
            est.feed(0.5, 200)
        }).not.toThrow()
    })
})
