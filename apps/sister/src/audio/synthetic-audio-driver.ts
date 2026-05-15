/**
 * Synthetic audio driver — replaces a real microphone for end-to-end demo wiring.
 *
 * Production audio pipeline (per architecture §4.4 → §4.5 → §4.6):
 *
 *   AudioInput (mic) → Meyda → { rms, spectralFlux } → BpmEstimator → tempoRatio
 *                                                  ↘ → VadDetector → vadState
 *
 * For the LC_E2E_MODE demo we don't have a microphone, so we synthesise a deterministic
 * 120-BPM feature stream that drives the BPM estimator + VAD via the same APIs the real
 * audio pipeline would. The downstream Sync Engine never knows the difference.
 *
 * Why a synthetic driver and not just hard-coded `tempoUpdate` events:
 *   - This exercises BpmEstimator + VadDetector at runtime — the same modules a real
 *     mic would feed. If a regression slips into either, the e2e demo catches it.
 *   - It validates the composition contract (Meyda's feature object → BPM/VAD → SE)
 *     end-to-end, which a mocked tempoUpdate would skip.
 *
 * The driver does NOT touch Web Audio, AudioContext, or any renderer-only API. It runs
 * in the Electron main process as a simple setInterval-driven feeder. EP-10 will replace
 * this with the real Meyda chain wired to AudioInput.
 */

import {
    createBpmEstimator,
    createVadDetector,
    tempoRatio,
    type BpmEstimator,
    type BpmEstimatorState,
    type VadDetector,
    type VadState
} from "@lyricue/core/audio"

export interface SyntheticAudioOptions {
    /** Target tempo to synthesise, in beats per minute. Default 120. */
    targetBPM?: number
    /** Reference BPM from the loaded timing map — used to compute tempoRatio for SE. */
    referenceBPM: number
    /** Feature emission rate — matches Meyda's ~11ms windows by default. */
    sampleIntervalMs?: number
    /**
     * Baseline RMS in non-onset frames. Default 0.1 — well above the VAD enter
     * threshold (0.05) so the demo locks into 'active' within enterMs.
     */
    baselineRMS?: number
    /**
     * Spectral-flux value at onset frames. Default 1.0 — well above the running median,
     * so the BPM estimator's adaptive threshold (median × 1.5) triggers reliably.
     */
    onsetFlux?: number
    /** Optional clock override — defaults to performance.now(). Tests inject a stub. */
    now?: () => number
}

export interface SyntheticAudioCallbacks {
    /** Fired on every BPM-estimator state change (every onset). */
    onTempoUpdate?: (data: { tempoRatio: number; beatConfidence: number; liveBPM: number | null }) => void
    /** Fired on every VAD transition. */
    onVadUpdate?: (state: VadState) => void
}

export interface SyntheticAudioDriver {
    /** Start emitting features. Idempotent. */
    start(): void
    /** Stop emitting. Idempotent. Resets the BPM estimator + VAD so the next start is clean. */
    stop(): void
    /** True iff the driver's interval is active. */
    isRunning(): boolean
    /** Read the most recent BPM-estimator state — useful for diagnostics logging. */
    bpmState(): BpmEstimatorState
    /** Read the most recent VAD state. */
    vadState(): VadState
    /** The estimator + VAD instances, exposed for test inspection. */
    readonly bpm: BpmEstimator
    readonly vad: VadDetector
}

export function createSyntheticAudioDriver(
    opts: SyntheticAudioOptions,
    callbacks: SyntheticAudioCallbacks = {}
): SyntheticAudioDriver {
    const targetBPM = opts.targetBPM ?? 120
    const sampleIntervalMs = opts.sampleIntervalMs ?? 11
    const baselineRMS = opts.baselineRMS ?? 0.1
    const onsetFlux = opts.onsetFlux ?? 1.0
    const now = opts.now ?? (() => performance.now())

    const beatPeriodMs = 60_000 / targetBPM

    const bpm = createBpmEstimator()
    const vad = createVadDetector()

    let timer: ReturnType<typeof setInterval> | null = null
    let startedAt = 0
    let lastBeatEmittedAt = -Infinity

    vad.onTransition((state) => {
        callbacks.onVadUpdate?.(state)
    })

    function tick(): void {
        const t = now()
        const elapsed = t - startedAt

        // Are we at a beat boundary this frame? Emit one onset per beatPeriodMs.
        let flux = 0
        if (elapsed - lastBeatEmittedAt >= beatPeriodMs) {
            flux = onsetFlux
            lastBeatEmittedAt = elapsed
        }

        // Always feed an RMS sample — VAD needs continuous data, not just onsets.
        vad.feed(baselineRMS, t)

        // Feed the BPM estimator. Non-onset frames pass a small noise floor so the
        // adaptive threshold (running median × 1.5) has data to baseline against.
        const fluxSample = flux > 0 ? flux : 0.05
        const before = bpm.state().liveBPM
        bpm.feed(fluxSample, t)
        const after = bpm.state()

        if (after.lastWasOnset) {
            const ratio = tempoRatio(after.liveBPM, opts.referenceBPM)
            callbacks.onTempoUpdate?.({
                tempoRatio: ratio.ratio,
                beatConfidence: after.beatConfidence,
                liveBPM: after.liveBPM
            })
            // Lint quiet: 'before' is captured so a future maintainer can detect BPM
            // changes if they want to. We don't react to it here.
            void before
        }
    }

    return {
        start() {
            if (timer !== null) return
            startedAt = now()
            lastBeatEmittedAt = -Infinity
            timer = setInterval(tick, sampleIntervalMs)
        },
        stop() {
            if (timer === null) return
            clearInterval(timer)
            timer = null
            bpm.reset()
            vad.reset()
        },
        isRunning() {
            return timer !== null
        },
        bpmState() {
            return bpm.state()
        },
        vadState() {
            return vad.snapshot()
        },
        bpm,
        vad
    }
}
