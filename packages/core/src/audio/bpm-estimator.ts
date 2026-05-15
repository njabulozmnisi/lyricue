/**
 * BPM estimation core — pure algorithmic logic, no Web Audio dependency.
 *
 * Per EP-07 STORY-07.5, architecture.md §4.5, FR3.3.
 *
 * Two-stage pipeline:
 *   1. **Onset detection** — accept a stream of `spectralFlux` samples (one per Meyda
 *      window — see STORY-07.4). A sample is flagged as an onset when it exceeds the
 *      adaptive threshold: `runningMedian(recent flux) × 1.5`. Adaptive thresholding
 *      keeps the detector robust across loud and quiet songs without per-song tuning.
 *
 *   2. **Tempo estimation** — collect inter-onset intervals (IOIs) over the last
 *      ~8 seconds. Autocorrelate the IOI sequence to find the dominant period.
 *      Convert to BPM. Apply exponential moving average (α=0.2) to suppress jitter.
 *
 * Output:
 *   - `liveBPM` — null until at least 4 onsets have been observed (insufficient data),
 *      then a smoothed BPM estimate updated on every onset.
 *   - `beatConfidence` — in [0,1]. Derived from the coefficient of variation (CV)
 *      of recent IOIs: low CV → consistent tempo → high confidence. Used by SE
 *      to decide tier degradation (confidence < 0.4 for >10s → Timer mode).
 *
 * Design choices:
 *   - The estimator is stateful but the state lives in a closure. Constructing one
 *     `createBpmEstimator()` yields a fresh estimator; instances don't share state.
 *   - The estimator NEVER throws. Bad input is silently coerced to "no onset".
 *   - All timing is in milliseconds. The caller hands in `nowMs` per sample so tests
 *     can drive the estimator deterministically without mocking `performance.now()`.
 *   - We don't use a generic "ring buffer" abstraction — the buffers are small enough
 *     (a few dozen entries) that a JS array with `.shift()` is fine and clearer.
 */

/** Default EMA factor — architecture.md §4.5 specifies 0.2. */
export const DEFAULT_EMA_ALPHA = 0.2 as const

/** Threshold multiplier on the running median of flux — architecture.md §4.5: 1.5. */
export const DEFAULT_FLUX_THRESHOLD_MULTIPLIER = 1.5 as const

/** History window for autocorrelation, in milliseconds. */
export const DEFAULT_IOI_WINDOW_MS = 8000 as const

/** History window for the adaptive flux-threshold median. */
export const DEFAULT_FLUX_WINDOW_SAMPLES = 43 as const // ~500ms at 11ms Meyda windows

/** Minimum onset count before we trust the BPM estimate. */
export const MIN_ONSETS_FOR_BPM = 4 as const

/** BPM band the estimator considers plausible for sung music. */
export const BPM_MIN = 40 as const
export const BPM_MAX = 220 as const

/** Refractory period — minimum gap between onsets. Suppresses double-trigger. */
export const ONSET_REFRACTORY_MS = 60 as const // physiological max ~16 onsets/sec

export interface BpmEstimatorOptions {
    /** Override the EMA smoothing factor. Default 0.2 (architecture.md §4.5). */
    emaAlpha?: number
    /** Override the flux-threshold multiplier. Default 1.5. */
    fluxThresholdMultiplier?: number
    /** Override the IOI window. Default 8000ms. */
    ioiWindowMs?: number
    /** Override the flux history window (in samples). Default 43 (~500ms at 11ms windows). */
    fluxWindowSamples?: number
    /** Minimum gap between successive onsets. Default 60ms. */
    onsetRefractoryMs?: number
}

export interface BpmEstimatorState {
    /** Current smoothed BPM estimate, or null if not enough data yet. */
    liveBPM: number | null
    /** Confidence in [0,1] — low coefficient-of-variation of IOIs = high confidence. */
    beatConfidence: number
    /** Number of onsets observed so far. Useful for the diagnostics surface. */
    onsetCount: number
    /** True iff the most recent feed() call detected an onset. */
    lastWasOnset: boolean
}

export interface BpmEstimator {
    /**
     * Feed one Meyda feature sample. Returns the updated state.
     *
     * @param spectralFlux  The current sample's spectral flux (or any onset-strength
     *                      proxy). Negative / NaN values are coerced to 0 — no throw.
     * @param nowMs         performance.now()-style timestamp for this sample. Must be
     *                      monotonic; non-monotonic values produce undefined behaviour
     *                      but won't crash.
     */
    feed(spectralFlux: number, nowMs: number): BpmEstimatorState

    /** Snapshot of the current state without feeding. */
    state(): BpmEstimatorState

    /** Reset the estimator to its initial state — used on song change. */
    reset(): void
}

export function createBpmEstimator(opts: BpmEstimatorOptions = {}): BpmEstimator {
    const emaAlpha = opts.emaAlpha ?? DEFAULT_EMA_ALPHA
    const thresholdMultiplier = opts.fluxThresholdMultiplier ?? DEFAULT_FLUX_THRESHOLD_MULTIPLIER
    const ioiWindowMs = opts.ioiWindowMs ?? DEFAULT_IOI_WINDOW_MS
    const fluxWindowSamples = opts.fluxWindowSamples ?? DEFAULT_FLUX_WINDOW_SAMPLES
    const refractoryMs = opts.onsetRefractoryMs ?? ONSET_REFRACTORY_MS

    // --- mutable state ---
    let fluxHistory: number[] = [] // rolling window of recent flux samples
    let onsetTimes: number[] = [] // ms timestamps of each detected onset, oldest first
    let lastOnsetAt: number | null = null
    let smoothedBPM: number | null = null
    let lastWasOnset = false

    function adaptiveThreshold(): number {
        if (fluxHistory.length === 0) return 0
        // Running median: sort a copy and pick the middle.
        const sorted = [...fluxHistory].sort((a, b) => a - b)
        const mid = Math.floor(sorted.length / 2)
        const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
        return median * thresholdMultiplier
    }

    /**
     * Autocorrelate the inter-onset intervals to find the dominant period, in ms.
     * Returns null when there aren't enough onsets.
     */
    function dominantPeriodMs(): number | null {
        if (onsetTimes.length < MIN_ONSETS_FOR_BPM) return null

        // Build the IOI list.
        const iois: number[] = []
        for (let i = 1; i < onsetTimes.length; i++) {
            iois.push(onsetTimes[i]! - onsetTimes[i - 1]!)
        }
        if (iois.length === 0) return null

        // Histogram-based dominant period: bin IOIs by 10ms buckets, pick the modal bucket.
        // This is more robust than naïve autocorrelation against a sparse IOI signal and
        // matches the architecture intent ("dominant period").
        const BIN_MS = 10
        const bins = new Map<number, number>()
        for (const ioi of iois) {
            // Only consider IOIs that map to a plausible BPM.
            const bpm = 60_000 / ioi
            if (bpm < BPM_MIN || bpm > BPM_MAX) continue
            const bin = Math.round(ioi / BIN_MS) * BIN_MS
            bins.set(bin, (bins.get(bin) ?? 0) + 1)
        }
        if (bins.size === 0) return null

        // Find the modal bin. Ties broken by smaller IOI (faster tempo).
        let bestBin = -1
        let bestCount = 0
        for (const [bin, count] of bins) {
            if (count > bestCount || (count === bestCount && bin < bestBin)) {
                bestBin = bin
                bestCount = count
            }
        }
        return bestBin > 0 ? bestBin : null
    }

    /**
     * Confidence: 1 - coefficient_of_variation, clamped to [0,1]. Low CV = consistent
     * tempo = high confidence.
     *
     * SE consumes this to decide tier degradation. The architecture says
     * "confidence below 0.4 for >10 seconds triggers degradation from AI Sync to Timer."
     */
    function computeConfidence(): number {
        if (onsetTimes.length < MIN_ONSETS_FOR_BPM) return 0

        const iois: number[] = []
        for (let i = 1; i < onsetTimes.length; i++) {
            iois.push(onsetTimes[i]! - onsetTimes[i - 1]!)
        }
        if (iois.length < 2) return 0

        const mean = iois.reduce((a, b) => a + b, 0) / iois.length
        if (mean === 0) return 0

        const variance = iois.reduce((acc, x) => acc + (x - mean) ** 2, 0) / iois.length
        const stddev = Math.sqrt(variance)
        const cv = stddev / mean

        // CV near 0 → confidence near 1. CV ≥ 1 → confidence 0.
        // The mapping 1 - min(1, cv) is the simplest interpretation. SE's threshold of
        // 0.4 corresponds to a CV of 0.6 — a tempo that's drifting by ~60% interval-to-
        // interval, which is well outside normal worship singing.
        return Math.max(0, Math.min(1, 1 - cv))
    }

    function feed(spectralFluxRaw: number, nowMs: number): BpmEstimatorState {
        // Coerce bad input to 0 — never throw, never propagate NaN.
        const spectralFlux =
            Number.isFinite(spectralFluxRaw) && spectralFluxRaw > 0 ? spectralFluxRaw : 0

        // Update flux history (rolling window).
        fluxHistory.push(spectralFlux)
        if (fluxHistory.length > fluxWindowSamples) fluxHistory.shift()

        const threshold = adaptiveThreshold()
        const isOnset =
            spectralFlux > threshold &&
            threshold > 0 &&
            (lastOnsetAt === null || nowMs - lastOnsetAt >= refractoryMs)

        lastWasOnset = isOnset

        if (isOnset) {
            onsetTimes.push(nowMs)
            lastOnsetAt = nowMs
            // Drop onsets that fell outside the IOI window.
            const cutoff = nowMs - ioiWindowMs
            while (onsetTimes.length > 0 && onsetTimes[0]! < cutoff) onsetTimes.shift()

            // Recompute BPM from the autocorrelated dominant period.
            const period = dominantPeriodMs()
            if (period !== null) {
                const instantBPM = 60_000 / period
                smoothedBPM =
                    smoothedBPM === null
                        ? instantBPM
                        : smoothedBPM * (1 - emaAlpha) + instantBPM * emaAlpha
            }
        }

        return {
            liveBPM: smoothedBPM,
            beatConfidence: computeConfidence(),
            onsetCount: onsetTimes.length,
            lastWasOnset
        }
    }

    function state(): BpmEstimatorState {
        return {
            liveBPM: smoothedBPM,
            beatConfidence: computeConfidence(),
            onsetCount: onsetTimes.length,
            lastWasOnset
        }
    }

    function reset(): void {
        fluxHistory = []
        onsetTimes = []
        lastOnsetAt = null
        smoothedBPM = null
        lastWasOnset = false
    }

    return { feed, state, reset }
}
