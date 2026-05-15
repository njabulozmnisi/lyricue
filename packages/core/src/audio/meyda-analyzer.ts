/**
 * Meyda feature-extraction wrapper.
 *
 * Per EP-07 STORY-07.4, architecture.md §4.5, ADR-5.
 *
 * Meyda is a JS library for real-time spectral feature extraction. We use it to produce
 * the `rms`, `energy`, `spectralCentroid`, and `spectralFlux` features that BD consumes
 * for onset detection. The library itself is renderer-only because it depends on Web
 * Audio's `AudioContext` and `MediaStreamAudioSourceNode` — but the wrapper around it
 * factors out Meyda behind a thin interface so this module is testable in plain Node.
 *
 * Design choices:
 *   - `createMeydaFeatureSource()` takes a **factory** that returns a MeydaAnalyzerLike.
 *     Production callers pass a factory backed by the real Meyda library; tests pass a
 *     mock that fires arbitrary feature objects when the test triggers them.
 *   - We expose features as both a callback (for the BPM estimator's hot loop) and as a
 *     Svelte-store-compatible Readable (for the diagnostics panel + settings preview).
 *     Per AC3 of STORY-07.4.
 *   - Buffer size 512 samples @ 48kHz → ~10.6ms windows (close to AC2's "~11ms").
 *   - Features list pinned to the four documented in architecture.md §4.5. Adding more
 *     is a one-line change; removing one is a breaking change for downstream consumers.
 */

import { writable, type Readable } from "../settings/observable.js"

/**
 * Subset of Meyda's MeydaAnalyzer interface that we actually use. Lets the production
 * factory return the real Meyda type cast to this, and lets tests return a mock with
 * the same shape but no audio dependency.
 */
export interface MeydaAnalyzerLike {
    start(): void
    stop(): void
}

/**
 * Shape of the per-window feature object Meyda emits. Pinned to the four features
 * architecture.md §4.5 specifies. Meyda emits keys 1:1 with the features list; missing
 * keys mean Meyda failed to compute that feature for the window (rare; we coerce to 0).
 */
export interface MeydaFeatures {
    rms: number
    energy: number
    spectralCentroid: number
    spectralFlux: number
}

export const MEYDA_FEATURE_LIST = [
    "rms",
    "energy",
    "spectralCentroid",
    "spectralFlux"
] as const

export const MEYDA_BUFFER_SIZE = 512 as const

export interface MeydaFactoryArgs {
    /** The Web Audio source node Meyda will analyse. Caller owns its lifecycle. */
    source: unknown // AudioNode in production; opaque in tests
    /** AudioContext Meyda uses for FFT scheduling. */
    audioContext: unknown // AudioContext in production
    /** Power-of-two buffer size — feature window length. */
    bufferSize: number
    /** Features Meyda computes per window. */
    featureExtractors: readonly string[]
    /**
     * Called every buffer with the computed features. Wrapper normalises the shape
     * via `normaliseFeatures()` before forwarding.
     */
    callback: (features: Record<string, unknown>) => void
}

/**
 * Factory that constructs the underlying Meyda analyser. Production code wires
 * `Meyda.createMeydaAnalyzer` here; tests wire a stub that emits synthetic features.
 */
export type MeydaFactory = (args: MeydaFactoryArgs) => MeydaAnalyzerLike

export interface MeydaFeatureSourceOptions {
    source: unknown
    audioContext: unknown
    /** The Meyda factory. Production wires the real library; tests wire a stub. */
    factory: MeydaFactory
    /** Optional override of the default buffer size. */
    bufferSize?: number
}

export interface MeydaFeatureSource {
    /** Svelte-store-compatible feature stream. Latest features (or null until first frame). */
    readonly features: Readable<MeydaFeatures | null>
    /** Subscribe to raw feature callbacks. Returns an unsubscribe function. */
    onFeatures(handler: (features: MeydaFeatures) => void): () => void
    /** Start the analyser. Idempotent. */
    start(): void
    /** Stop the analyser and detach all callbacks. Idempotent. */
    stop(): void
    /** True iff the analyser is running. */
    isRunning(): boolean
}

/**
 * Normalise Meyda's raw output into the MeydaFeatures shape. Missing keys, non-finite
 * values, and unexpected types are all coerced to 0 — we never propagate NaN downstream.
 */
function normaliseFeatures(raw: Record<string, unknown>): MeydaFeatures {
    function pick(key: string): number {
        const v = raw[key]
        return typeof v === "number" && Number.isFinite(v) ? v : 0
    }
    return {
        rms: pick("rms"),
        energy: pick("energy"),
        spectralCentroid: pick("spectralCentroid"),
        spectralFlux: pick("spectralFlux")
    }
}

export function createMeydaFeatureSource(opts: MeydaFeatureSourceOptions): MeydaFeatureSource {
    const bufferSize = opts.bufferSize ?? MEYDA_BUFFER_SIZE
    const featuresStore = writable<MeydaFeatures | null>(null)
    const handlers = new Set<(f: MeydaFeatures) => void>()

    let analyzer: MeydaAnalyzerLike | null = null
    let running = false

    function dispatch(raw: Record<string, unknown>): void {
        const features = normaliseFeatures(raw)
        featuresStore.set(features)
        // Iterate over a snapshot — handlers may detach themselves during iteration.
        for (const h of [...handlers]) {
            try {
                h(features)
            } catch (err) {
                // A handler exception MUST NOT kill the audio pipeline. Live worship
                // tolerates a bad subscriber; it does not tolerate a dropped pipeline.
                // eslint-disable-next-line no-console
                console.error("[lyricue:meyda] feature handler threw:", err)
            }
        }
    }

    return {
        features: { subscribe: (run) => featuresStore.subscribe(run) },

        onFeatures(handler) {
            handlers.add(handler)
            return () => {
                handlers.delete(handler)
            }
        },

        start() {
            if (running) return
            analyzer = opts.factory({
                source: opts.source,
                audioContext: opts.audioContext,
                bufferSize,
                featureExtractors: MEYDA_FEATURE_LIST,
                callback: dispatch
            })
            analyzer.start()
            running = true
        },

        stop() {
            if (!running) return
            try {
                analyzer?.stop()
            } catch {
                // The underlying analyser may throw on stop() if the AudioContext is
                // already closed. The adapter contract from the renderer's perspective
                // is "stop is safe" — swallow.
            }
            analyzer = null
            handlers.clear()
            running = false
            featuresStore.set(null)
        },

        isRunning() {
            return running
        }
    }
}
