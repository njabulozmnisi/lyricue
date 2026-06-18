/**
 * No-op transcriber — satisfies the SttWindowTranscriber contract without producing
 * recognition results.
 *
 * Use cases:
 *   1. STT-disabled deployments — the operator turned STT correction off in Settings.
 *      Wiring this transcriber keeps the LiveSttCorrectionController exercising its
 *      buffer / dispatch / observer paths without invoking a real (and expensive)
 *      recognition model. The controller correctly degrades to "no correction events"
 *      rather than throwing because the rolling-window returns a `transcribed` status
 *      with a null transcript.
 *
 *   2. Pre-binding development — LyriCue's planned STT binding (originally whisper.cpp;
 *      that package no longer resolves on npm and a replacement is pending) is platform
 *      specific. While the binding work is in flight, sister-mode hosts can wire this
 *      no-op so the whole STT pipeline can be exercised end-to-end during integration
 *      QA without requiring the native dep.
 *
 *   3. Test fixtures — unit tests that need a transcriber that "never finds a phrase"
 *      use this directly.
 *
 * Contract — SttWindowTranscriber:
 *   `(samples: Float32Array, context: SttWindowContext) => Promise<SttTranscript | null>`
 *
 *   - Returning null is the documented "I heard audio but recognised nothing" signal.
 *     Downstream phrase-matcher treats null exactly like a transcript whose text fails
 *     to match any phrase — it's a no-correction outcome, not an error.
 *   - The contract is async; any future real binding can buffer + return in its own time.
 *
 * The no-op returns null synchronously (wrapped in a resolved promise) so the rolling
 * window's cadence/throughput tests aren't slowed down.
 */

import type { SttWindowContext, SttTranscript, SttWindowTranscriber } from "./rolling-window-transcriber.js"

/**
 * Returns a transcriber that ignores its inputs and resolves to null.
 *
 * Pass to `createLiveSttCorrectionController({ transcribe: createNoOpTranscriber() })`
 * to keep the full STT pipeline live without a real recognition engine.
 */
export function createNoOpTranscriber(): SttWindowTranscriber {
    return async (_samples: Float32Array, _context: SttWindowContext): Promise<SttTranscript | null> => null
}

/**
 * Returns a transcriber that resolves to a constant transcript regardless of the audio
 * it receives. Useful in tests that need a deterministic "always recognised X" path
 * without the surrounding phrase-matching machinery.
 *
 * confidence defaults to 1.0; downstream phrase-matcher applies its own threshold.
 */
export function createConstantTranscriber(text: string, confidence = 1.0): SttWindowTranscriber {
    return async (_samples: Float32Array, _context: SttWindowContext): Promise<SttTranscript | null> => ({
        text,
        confidence
    })
}
