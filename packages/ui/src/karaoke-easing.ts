/**
 * Tempo-adaptive CSS transition duration for the karaoke renderer's sweep + handoff.
 *
 * Per operator feedback 2026-05-15 — the constant 100ms-opacity / no-gradient-transition
 * pairing rendered as a stair-step at 60Hz. Songs are not all the same tempo, so a
 * single fixed duration can't be both "snappy enough" for staccato words AND "soft
 * enough" for held notes.
 *
 * Mapping (piecewise linear, monotonic, clamped):
 *
 *   word.endMs - word.startMs    →  CSS transition-duration
 *   ─────────────────────────────────────────────────────────
 *      ≤ 200ms  (staccato)      →  50ms   (snappy)
 *        500ms  (normal)        →  80ms   (baseline)
 *      ≥ 1500ms (held)          →  200ms  (soft)
 *
 * Values between the documented anchors interpolate linearly. Out-of-range inputs
 * (NaN, ≤0) return the 80ms baseline as a safe fallback.
 *
 * Why piecewise linear vs. an exponential curve: simpler to reason about + tune; the
 * three anchor points map cleanly to operator-observable categories (staccato / normal /
 * held). An exponential would have one less degree of freedom but also one less
 * place to tune without rewriting the whole formula.
 */
export function wordEaseMs(durationMs: number): number {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return 80
    if (durationMs <= 200) return 50
    if (durationMs <= 500) {
        // Linear interpolation 200ms → 50ms ease, 500ms → 80ms ease.
        return 50 + ((durationMs - 200) / 300) * 30
    }
    if (durationMs <= 1500) {
        // Linear interpolation 500ms → 80ms ease, 1500ms → 200ms ease.
        return 80 + ((durationMs - 500) / 1000) * 120
    }
    return 200
}

export const WORD_EASE_MIN_MS = 50 as const
export const WORD_EASE_MAX_MS = 200 as const
export const WORD_EASE_BASELINE_MS = 80 as const
