/**
 * Tempo math for the Sync Engine.
 *
 * Per EP-07 STORY-07.6, architecture.md §4.5, FR3.4.
 *
 * `tempoRatio(liveBPM, referenceBPM)` returns the scaling factor SE applies to a
 * reference TimingMap's word durations so the projection follows the live vocalist's
 * actual pace. The ratio is hard-clamped to [0.7, 1.4] because:
 *
 *   - Out-of-range values are almost always a beat-detection error (e.g., a snare hit
 *     doubled the detected BPM, or the leader paused entirely and BD went to zero).
 *   - A 30% speed-up or slow-down is already at the edge of what feels natural
 *     to a congregation. Anything wider would be more disruptive than helpful.
 *
 * The function is pure. Tests cover boundaries, sign, sentinel inputs, NaN/Infinity.
 */

/**
 * Min/max plausible tempo ratio. Outside this band the function returns 1.0 (i.e., play
 * the reference at native speed) and the caller can log a confidence warning.
 *
 * Documented as exported constants so the operator-facing diagnostics surface can
 * display the clamp range without re-deriving it.
 */
export const TEMPO_RATIO_MIN = 0.7 as const
export const TEMPO_RATIO_MAX = 1.4 as const

/**
 * Result of a tempo-ratio computation. We return a struct (not just a number) so the
 * caller can branch on `wasClamped` without re-checking — useful for the diagnostics
 * panel and for SE's confidence-degradation logic.
 */
export interface TempoRatioResult {
    /** The clamped, safe-to-apply ratio. Always finite, always in [TEMPO_RATIO_MIN, TEMPO_RATIO_MAX]. */
    ratio: number
    /** The raw `liveBPM / referenceBPM` before clamping. Useful for diagnostics. null when inputs were invalid. */
    rawRatio: number | null
    /** True iff `rawRatio` was outside the clamp band (caller may want to warn or degrade tier). */
    wasClamped: boolean
    /**
     * Reason the result is 1.0 — when applicable. Lets the caller render a precise
     * tooltip without inferring from the numbers.
     */
    reason: "ok" | "live-bpm-missing" | "reference-bpm-missing" | "non-finite" | "clamped"
}

/**
 * Compute the tempo ratio between the live BPM (from BeatDetection) and the reference
 * BPM (from the loaded TimingMap). Returns a structured result; never throws.
 *
 * Behaviour matrix:
 *   live=null/0   → ratio=1.0, reason="live-bpm-missing" (BD hasn't locked yet)
 *   ref=null/0    → ratio=1.0, reason="reference-bpm-missing" (no song loaded)
 *   non-finite    → ratio=1.0, reason="non-finite" (NaN/Infinity from a bug)
 *   raw < 0.7     → ratio=0.7? NO — we return 1.0 with reason="clamped" because
 *                   an out-of-band raw value indicates beat-detection error, not a real
 *                   tempo. Hard-clamping to the boundary would silently apply a wrong
 *                   value; returning 1.0 + a warning is the safer default.
 *   raw > 1.4     → ratio=1.0, reason="clamped" (same rationale)
 *   else          → ratio=raw, reason="ok"
 *
 * Note: this is a stricter reading of architecture.md §4.5 than a naïve `clamp(raw, 0.7, 1.4)`.
 * The architecture text says "Outside the clamp range, the engine treats the ratio as 1.0
 * and logs a warning" — which is exactly the behaviour above.
 */
export function tempoRatio(
    liveBPM: number | null | undefined,
    referenceBPM: number | null | undefined
): TempoRatioResult {
    if (liveBPM === null || liveBPM === undefined || liveBPM === 0) {
        return { ratio: 1.0, rawRatio: null, wasClamped: false, reason: "live-bpm-missing" }
    }
    if (referenceBPM === null || referenceBPM === undefined || referenceBPM === 0) {
        return { ratio: 1.0, rawRatio: null, wasClamped: false, reason: "reference-bpm-missing" }
    }
    if (!Number.isFinite(liveBPM) || !Number.isFinite(referenceBPM)) {
        return { ratio: 1.0, rawRatio: null, wasClamped: false, reason: "non-finite" }
    }

    const raw = liveBPM / referenceBPM

    if (raw < TEMPO_RATIO_MIN || raw > TEMPO_RATIO_MAX) {
        return { ratio: 1.0, rawRatio: raw, wasClamped: true, reason: "clamped" }
    }

    return { ratio: raw, rawRatio: raw, wasClamped: false, reason: "ok" }
}
