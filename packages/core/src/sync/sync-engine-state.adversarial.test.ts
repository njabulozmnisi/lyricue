/**
 * Adversarial tests for SyncEngine state transitions.
 *
 * Focus on hostile / boundary tempo + beatConfidence values that could arrive from a
 * misbehaving BD module (or, more relevantly in production, from a noisy synthetic
 * driver). The transitions are pure functions — the question is whether they accept
 * NaN/Infinity into the state where the tick loop will then do `cursorRefTime +=
 * deltaWallMs * tempoRatio`, propagating NaN throughout.
 *
 * A NaN cursorRefTime cascades into:
 *   - currentSlideIndex stuck at 0 (lookupWord with NaN finds no word)
 *   - wordProgress = NaN → renderer CSS `calc(NaN * 100%)` is invalid → likely 0% gradient
 *   - karaoke output appears frozen even though SE is "running"
 *
 * Per the live-worship reliability target (NFR2.1), SE must never enter a NaN state.
 */

import { describe, expect, it } from "vitest"
import { applyEvent, makeInitialState } from "./sync-engine-state.js"

describe("SyncEngine — hostile tempo/confidence values", () => {
    it("does not allow tempoUpdate to write NaN tempoRatio into state", () => {
        const initial = makeInitialState()
        const next = applyEvent(initial, { kind: "tempoUpdate", tempoRatio: Number.NaN, beatConfidence: 0.8 })
        expect(Number.isFinite(next.tempoRatio), "tempoRatio must remain finite after NaN input").toBe(true)
    })

    it("does not allow tempoUpdate to write Infinity tempoRatio", () => {
        const initial = makeInitialState()
        const next = applyEvent(initial, { kind: "tempoUpdate", tempoRatio: Number.POSITIVE_INFINITY, beatConfidence: 0.8 })
        expect(Number.isFinite(next.tempoRatio)).toBe(true)
    })

    it("clamps beatConfidence to [0,1] — values above 1 break confidence-degradation gates", () => {
        const initial = makeInitialState()
        const next = applyEvent(initial, { kind: "tempoUpdate", tempoRatio: 1.0, beatConfidence: 5 })
        expect(next.beatConfidence).toBeLessThanOrEqual(1)
        expect(next.beatConfidence).toBeGreaterThanOrEqual(0)
    })

    it("clamps beatConfidence to [0,1] — negative confidence", () => {
        const initial = makeInitialState()
        const next = applyEvent(initial, { kind: "tempoUpdate", tempoRatio: 1.0, beatConfidence: -0.5 })
        expect(next.beatConfidence).toBeGreaterThanOrEqual(0)
    })

    it("rejects NaN beatConfidence — falls back to 0", () => {
        const initial = makeInitialState()
        const next = applyEvent(initial, { kind: "tempoUpdate", tempoRatio: 1.0, beatConfidence: Number.NaN })
        expect(Number.isFinite(next.beatConfidence)).toBe(true)
    })

    it("clamps tempoRatio to documented [0.7, 1.4] envelope when out-of-range", () => {
        // The audio module clamps before sending, but a defensive belt-and-braces clamp
        // in SE prevents a bypassed audio path (synthetic driver bug, test seam) from
        // propagating an out-of-envelope ratio into the cursor.
        const initial = makeInitialState()
        const fast = applyEvent(initial, { kind: "tempoUpdate", tempoRatio: 100, beatConfidence: 0.9 })
        expect(fast.tempoRatio).toBeLessThanOrEqual(1.4)
        const slow = applyEvent(initial, { kind: "tempoUpdate", tempoRatio: 0.01, beatConfidence: 0.9 })
        expect(slow.tempoRatio).toBeGreaterThanOrEqual(0.7)
    })

    it("rejects NaN/Infinity positionCorrection targets", () => {
        const initial = { ...makeInitialState(), activeTimingMap: {} as never, cursorRefTime: 5000 }
        const next = applyEvent(initial, {
            kind: "positionCorrection",
            targetRefMs: Number.NaN,
            wallTime: 1000
        })
        // The position-correction state must not be set to NaN — the tick interpolator
        // would propagate NaN into cursorRefTime on the next frame.
        expect(next.positionCorrectionTargetMs === null || Number.isFinite(next.positionCorrectionTargetMs)).toBe(true)
    })

    it("rejects negative positionCorrection targets", () => {
        const initial = { ...makeInitialState(), activeTimingMap: {} as never, cursorRefTime: 5000 }
        const next = applyEvent(initial, {
            kind: "positionCorrection",
            targetRefMs: -100,
            wallTime: 1000
        })
        // Negative ref-ms is non-physical (cursor < song start). Reject or clamp to 0.
        if (next.positionCorrectionTargetMs !== null) {
            expect(next.positionCorrectionTargetMs).toBeGreaterThanOrEqual(0)
        }
    })

    it("nextSection rejects NaN targetRefMs — cursor must stay finite", () => {
        const initial = { ...makeInitialState(), activeTimingMap: {} as never, cursorRefTime: 5000 }
        const next = applyEvent(initial, { kind: "nextSection", targetRefMs: Number.NaN, wallTime: 1000 })
        expect(Number.isFinite(next.cursorRefTime)).toBe(true)
    })
})
