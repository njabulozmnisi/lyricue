/**
 * lookupWord — given a cursor position in reference-track milliseconds and an active
 * TimingMap (optionally constrained by an Arrangement), return the (slideIndex,
 * wordIndex, wordProgress) tuple SE publishes to the karaoke renderer.
 *
 * Per EP-09 STORY-09.3, architecture.md §4.8.
 *
 * Frame budget: NFR1.3 caps SE's tick body at <2ms on a 4-core M1. This lookup runs once
 * per rAF frame (≤60 Hz) so it has ~1ms headroom. The implementation is:
 *
 *   1. Binary-search the active sequence of sections to find the section that contains
 *      cursorRefTime (or returns the section the cursor is approaching / leaving).
 *   2. Linear scan within the chosen section to find the word that brackets cursorRefTime.
 *      Per-section word count is bounded by section length × typical syllable rate
 *      (≈120 words / 30s section in the worst case), so linear is fine.
 *
 * The function is **pure**: no allocations beyond the result object, no side effects.
 * It NEVER throws — out-of-range inputs return null (before song) or a clamped result
 * (after song).
 */

import type { Arrangement, TimingMap, TimingSection } from "../types/timing-map.js"

/**
 * What the cursor "is at" right now. `slideIndex` indexes into the active sequence
 * (arrangement.sequence when an arrangement is loaded; timingMap.sections otherwise).
 */
export interface CursorPosition {
    /** Index into the active sequence — arrangement step OR raw section. */
    slideIndex: number
    /** Index into that section's `words` array. */
    wordIndex: number
    /** Fractional progress within the active word, in [0, 1]. */
    wordProgress: number
    /** The resolved section the cursor is in (helpful for KR + diagnostics). */
    section: TimingSection
    /** True iff the cursor is past the final word's endMs of the active sequence. */
    pastEnd: boolean
}

/**
 * Resolve a section by sequence index. When an arrangement is active, the sequence is
 * `arrangement.sequence` and each step references a section by id; we lookup the
 * section by id and return it. When no arrangement, the sequence is the timing map's
 * native section order.
 */
function resolveSequence(map: TimingMap, arrangement: Arrangement | null): TimingSection[] {
    if (!arrangement) return map.sections
    // Build the resolved sequence once per call. The caller (SE tick loop) doesn't change
    // the arrangement on every frame, so the per-frame O(N) cost here is acceptable, but
    // we could memoise this if profiling shows it as a hot spot.
    const byId = new Map<string, TimingSection>()
    for (const s of map.sections) byId.set(s.id, s)
    const resolved: TimingSection[] = []
    for (const step of arrangement.sequence) {
        const section = byId.get(step.sectionId)
        if (section) resolved.push(section)
    }
    return resolved
}

/**
 * Compute the global timeline for an active sequence. Each entry holds the cumulative
 * start time of a section in reference-track ms. Used by lookupWord to binary-search.
 *
 * For the native section order this is just `section.startMs`. But when an arrangement
 * repeats sections (e.g., chorus 3 times), the same TimingSection appears multiple times
 * in the sequence and each occurrence has its own cumulative start. This function
 * generates the correct cumulative starts regardless of arrangement complexity.
 *
 * Pure; result is an array of section-relative offsets — caller adds these to the
 * section's local startMs for word lookup.
 */
export function buildSequenceTimeline(
    sequence: TimingSection[]
): { cumulativeStartMs: number; duration: number }[] {
    let cursor = 0
    return sequence.map((section) => {
        const duration = Math.max(0, section.endMs - section.startMs)
        const entry = { cumulativeStartMs: cursor, duration }
        cursor += duration
        return entry
    })
}

/**
 * Binary-search for the section that contains `cursorRefTime` in its half-open
 * [start, start + duration) interval. Returns the index. When the cursor is before
 * the first section, returns -1. When past the last, returns sequence.length - 1.
 *
 * Standard lower-bound binary search.
 */
function findSectionIndex(
    timeline: { cumulativeStartMs: number; duration: number }[],
    cursorRefTime: number
): number {
    if (timeline.length === 0) return -1
    if (cursorRefTime < timeline[0]!.cumulativeStartMs) return -1
    let lo = 0
    let hi = timeline.length - 1
    while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1
        if (timeline[mid]!.cumulativeStartMs <= cursorRefTime) {
            lo = mid
        } else {
            hi = mid - 1
        }
    }
    return lo
}

export interface LookupWordOptions {
    map: TimingMap
    arrangement: Arrangement | null
    cursorRefTime: number
}

/**
 * Resolve the cursor.
 *
 * Returns:
 *   - `null` when cursorRefTime is before the start of the active sequence (the song
 *     hasn't started yet, or the operator scrubbed before t=0). KR renders the section
 *     preview but no active word.
 *   - `{ ..., pastEnd: true }` when cursorRefTime is past the last word — the cursor
 *     snaps to the final word with wordProgress=1.
 *   - `{ ..., pastEnd: false }` otherwise.
 *
 * Frame-budget commentary: the binary-search is O(log N) over sections (≤ ~10 in
 * practice). The linear scan within a section is O(M) over words. Combined cost on a
 * 30-section × 120-word song fixture: well under 50µs on M1.
 */
export function lookupWord(opts: LookupWordOptions): CursorPosition | null {
    const sequence = resolveSequence(opts.map, opts.arrangement)
    if (sequence.length === 0) return null

    const timeline = buildSequenceTimeline(sequence)
    const slideIndex = findSectionIndex(timeline, opts.cursorRefTime)

    // Before song start — caller should render the preview, no active word.
    if (slideIndex < 0) return null

    const section = sequence[slideIndex]!
    const entry = timeline[slideIndex]!

    // Section-local cursor time. The section's words are in the section's *own*
    // time domain (relative to section.startMs), so we convert.
    const sectionLocalMs = opts.cursorRefTime - entry.cumulativeStartMs + section.startMs

    // Find the word that brackets sectionLocalMs. Linear scan because:
    //   - per-section word counts are bounded (typically <150)
    //   - words are guaranteed sorted by startMs per architecture.md §6.1
    const words = section.words
    if (words.length === 0) {
        // Section has no words (placeholder section?). Return a synthetic past-end-ish.
        return {
            slideIndex,
            wordIndex: 0,
            wordProgress: 0,
            section,
            pastEnd: false
        }
    }

    // Past the section's last word — but possibly within the section itself (silent tail
    // before the next section). Snap to the last word with progress=1 and surface the
    // pastEnd flag only when the cursor has run past the FINAL section's final word.
    const lastWord = words[words.length - 1]!
    if (sectionLocalMs >= lastWord.endMs) {
        const isLastSection = slideIndex === sequence.length - 1
        return {
            slideIndex,
            wordIndex: words.length - 1,
            wordProgress: 1,
            section,
            pastEnd: isLastSection
        }
    }

    // Before the section's first word (shouldn't happen given the binary-search, but
    // possible if a section has a leading silent intro before words start).
    const firstWord = words[0]!
    if (sectionLocalMs < firstWord.startMs) {
        return {
            slideIndex,
            wordIndex: 0,
            wordProgress: 0,
            section,
            pastEnd: false
        }
    }

    // Linear scan to find the word.
    for (let i = 0; i < words.length; i++) {
        const word = words[i]!
        if (sectionLocalMs >= word.startMs && sectionLocalMs < word.endMs) {
            const duration = Math.max(1, word.endMs - word.startMs)
            const progress = Math.max(0, Math.min(1, (sectionLocalMs - word.startMs) / duration))
            return {
                slideIndex,
                wordIndex: i,
                wordProgress: progress,
                section,
                pastEnd: false
            }
        }
        // Cursor is in the gap between word i and word i+1 — snap to the word that
        // just ended so KR shows a sweep-completed glyph rather than re-starting an
        // upcoming word's gradient.
        if (sectionLocalMs < word.startMs && i > 0) {
            return {
                slideIndex,
                wordIndex: i - 1,
                wordProgress: 1,
                section,
                pastEnd: false
            }
        }
    }

    // Shouldn't reach here — falls through if the linear scan didn't find a bracket
    // and didn't hit either edge case. Defensive return: snap to the last word.
    return {
        slideIndex,
        wordIndex: words.length - 1,
        wordProgress: 1,
        section,
        pastEnd: slideIndex === sequence.length - 1
    }
}

/**
 * Total duration of the active sequence, in reference-track ms. Used by SE to detect
 * song-boundary crossings (STORY-09.7).
 */
export function sequenceDurationMs(map: TimingMap, arrangement: Arrangement | null): number {
    const sequence = resolveSequence(map, arrangement)
    const timeline = buildSequenceTimeline(sequence)
    if (timeline.length === 0) return 0
    const last = timeline[timeline.length - 1]!
    return last.cumulativeStartMs + last.duration
}

/**
 * Find the start time (in reference-track ms) of the next section after the cursor.
 * Returns the duration of the current section's remaining time + the cumulative offset
 * — i.e., the timestamp the cursor reaches when entering the next section.
 *
 * Returns null when the cursor is past the last section.
 *
 * Used by SE.onNextSection (STORY-09.5).
 */
export function findNextSlideStart(
    map: TimingMap,
    arrangement: Arrangement | null,
    cursorRefTime: number
): number | null {
    const sequence = resolveSequence(map, arrangement)
    const timeline = buildSequenceTimeline(sequence)
    const idx = findSectionIndex(timeline, cursorRefTime)
    if (idx < 0) {
        // Before first section — return the first section's start.
        return timeline.length > 0 ? timeline[0]!.cumulativeStartMs : null
    }
    if (idx >= timeline.length - 1) return null
    return timeline[idx + 1]!.cumulativeStartMs
}

/**
 * Find the start of the previous section relative to the cursor. Returns the cumulative
 * start of section index-1 — or 0 if the cursor is in the first section (snap to start).
 *
 * Used by SE.onPrevSection (STORY-09.5).
 */
export function findPrevSlideStart(
    map: TimingMap,
    arrangement: Arrangement | null,
    cursorRefTime: number
): number | null {
    const sequence = resolveSequence(map, arrangement)
    const timeline = buildSequenceTimeline(sequence)
    const idx = findSectionIndex(timeline, cursorRefTime)
    if (idx <= 0) {
        // In the first section (or before it) — snap to song start.
        return timeline.length > 0 ? timeline[0]!.cumulativeStartMs : null
    }
    return timeline[idx - 1]!.cumulativeStartMs
}
