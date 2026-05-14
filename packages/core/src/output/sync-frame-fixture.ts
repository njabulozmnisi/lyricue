/**
 * SyncFrame test fixtures — generators that produce realistic frame sequences for
 * adapter and renderer tests.
 *
 * Per epics.md STORY-02.1 AC5. Used by:
 *   - Adapter unit tests (e.g., "pushSyncFrame() at 60Hz keeps framesDelivered in step").
 *   - Renderer tests (e.g., "KR's sweep CSS variable matches wordProgress").
 *   - Walking-skeleton demo (STORY-02.4) — drives the real adapters with synthetic input.
 *
 * Also a test-utility — exported via `@lyricue/core/output/test-utils`.
 */

import type { SyncFrame } from "./sync-frame.js"

export interface FrameSequenceOptions {
    /** Output ID stamped on every frame. */
    outputId?: string
    /** How many words to walk through. Default 10. */
    wordCount?: number
    /** How long each word lasts in milliseconds. Default 500 ms. */
    msPerWord?: number
    /** Frame rate, frames per second. Default 60. */
    fps?: number
    /** Slide index reported on every frame. Default 0. */
    slideIndex?: number
    /** Tier and VAD state for the whole sequence. Defaults to ('auto', 'active'). */
    tier?: SyncFrame["tier"]
    vad?: SyncFrame["vad"]
}

/**
 * Produce a sequence of SyncFrames stepping linearly through `wordCount` words at
 * `fps`. `wordProgress` ramps 0 → 1 within each word, then resets as `wordIndex`
 * advances. The final frame is the last frame of the last word (progress ≈ 1).
 *
 * Total frame count = ceil(wordCount * msPerWord / 1000 * fps).
 */
export function generateFrameSequence(opts: FrameSequenceOptions = {}): SyncFrame[] {
    const {
        outputId = "test-output",
        wordCount = 10,
        msPerWord = 500,
        fps = 60,
        slideIndex = 0,
        tier = "auto",
        vad = "active"
    } = opts

    const totalMs = wordCount * msPerWord
    const frameIntervalMs = 1000 / fps
    const frames: SyncFrame[] = []

    for (let elapsedMs = 0; elapsedMs <= totalMs; elapsedMs += frameIntervalMs) {
        const wordIndex = Math.min(Math.floor(elapsedMs / msPerWord), wordCount - 1)
        const wordStartMs = wordIndex * msPerWord
        const progress = Math.min((elapsedMs - wordStartMs) / msPerWord, 1)
        frames.push({
            outputId,
            slideIndex,
            wordIndex,
            wordProgress: progress,
            tier,
            vad
        })
    }

    return frames
}

/**
 * Step a single frame from the previous one — handy for tests that want to assert
 * incremental adapter behaviour without pre-computing a whole sequence.
 */
export function nextFrame(prev: SyncFrame, opts: { msDelta?: number; msPerWord?: number } = {}): SyncFrame {
    const { msDelta = 1000 / 60, msPerWord = 500 } = opts
    const currentWordMs = prev.wordIndex * msPerWord
    const elapsedInWord = prev.wordProgress * msPerWord + msDelta
    if (elapsedInWord >= msPerWord) {
        return {
            ...prev,
            wordIndex: prev.wordIndex + 1,
            wordProgress: (elapsedInWord - msPerWord) / msPerWord
        }
    }
    return {
        ...prev,
        wordProgress: Math.min(elapsedInWord / msPerWord, 1)
    }
}

/** A single canonical "starting" frame — useful when a test wants a known seed. */
export function makeFrame(overrides: Partial<SyncFrame> = {}): SyncFrame {
    return {
        outputId: "test-output",
        slideIndex: 0,
        wordIndex: 0,
        wordProgress: 0,
        tier: "auto",
        vad: "active",
        ...overrides
    }
}
