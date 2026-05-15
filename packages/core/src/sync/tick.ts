/**
 * SyncEngine per-frame tick.
 *
 * Per EP-09 STORY-09.2 + 09.4 + 09.6 + 09.7, architecture.md §4.8.
 *
 * The tick function is *pure*: `(state, nowWallMs) → state'`. The hosting runtime
 * (renderer rAF in production; vitest's fake-timer-driven loop in tests) calls it
 * once per frame. The function:
 *
 *   1. Honours the VAD gate — `vadState === 'silent'` holds the cursor.
 *   2. Honours tier:
 *        - manual → cursor frozen
 *        - timer  → cursor advances at native speed (tempoRatio fixed at 1.0)
 *        - auto   → cursor advances at `state.tempoRatio * wallElapsed`
 *   3. Position-correction animation (STORY-09.6) — when an animation is in flight,
 *      the cursor follows the interpolated target instead of the pure delta-advance,
 *      then both fade out together when the animation completes.
 *   4. Tier degradation accumulator (STORY-09.4) — auto → timer when beatConfidence
 *      stays below the threshold for >CONFIDENCE_DEGRADATION_MS wall-ms.
 *   5. Resolves `(slideIndex, wordIndex, wordProgress)` via lookupWord and updates the
 *      output fields.
 *   6. Detects song-boundary crossings (STORY-09.7) — when the cursor passes the active
 *      sequence's totalDurationMs, runState → finished.
 *
 * Frame budget: NFR1.3 caps tick body at <2ms on M1. The hot paths are lookupWord
 * (<50µs by design — see lookup-word.ts) + a few arithmetic ops. Comfortable margin.
 *
 * The tick function never throws. Bad input (NaN, Infinity in tempoRatio, etc.) is
 * silently coerced or ignored — see the inline guards.
 */

import { lookupWord, sequenceDurationMs } from "./lookup-word.js"
import {
    CONFIDENCE_DEGRADATION_MS,
    CONFIDENCE_DEGRADATION_THRESHOLD,
    POSITION_CORRECTION_DURATION_MS,
    type SyncEngineState
} from "./sync-engine-state.js"

export interface TickOptions {
    /** Override the position-correction animation length. Defaults to FR4.4's 300ms. */
    positionCorrectionDurationMs?: number
    /** Override the auto→timer accumulator threshold. Defaults to FR5.5's 0.4. */
    confidenceDegradationThreshold?: number
    /** Override the accumulator window. Defaults to FR5.5's 10s. */
    confidenceDegradationMs?: number
}

/**
 * Run one rAF tick. Returns the new state — caller atomically swaps it into the store.
 *
 * `nowWallMs` is the renderer's `performance.now()` in production; tests inject a
 * deterministic clock so the loop is reproducible.
 */
export function tick(
    state: SyncEngineState,
    nowWallMs: number,
    opts: TickOptions = {}
): SyncEngineState {
    const positionCorrectionDurationMs =
        opts.positionCorrectionDurationMs ?? POSITION_CORRECTION_DURATION_MS
    const confidenceThreshold =
        opts.confidenceDegradationThreshold ?? CONFIDENCE_DEGRADATION_THRESHOLD
    const confidenceDegradationMs = opts.confidenceDegradationMs ?? CONFIDENCE_DEGRADATION_MS

    // No song loaded → nothing to do (but still update lastTickWallTime so a future
    // load-and-engage sees a fresh baseline).
    if (!state.activeTimingMap || state.runState === "idle") {
        return { ...state, lastTickWallTime: nowWallMs }
    }

    // waitingForStart: cursor frozen at 0, VAD will engage on first 'active' event.
    if (state.runState === "waitingForStart") {
        // Recompute totalDurationMs in case the map/arrangement changed (it doesn't
        // change without a loadSong event, but doing it here keeps the engageSync
        // transition simple — engageSync doesn't have to recompute).
        const totalDurationMs = sequenceDurationMs(state.activeTimingMap, state.activeArrangement)
        return { ...state, totalDurationMs, lastTickWallTime: nowWallMs }
    }

    // finished: cursor past last word. Hold position; await operator action.
    if (state.runState === "finished") {
        return { ...state, lastTickWallTime: nowWallMs }
    }

    // ── running ──────────────────────────────────────────────────────────────

    // First tick after engage — establish wall-time anchor and bail.
    if (state.lastTickWallTime === null) {
        return { ...state, lastTickWallTime: nowWallMs }
    }

    // Defensive: wall clock went backwards (shouldn't, but defensive against test
    // fixtures and OS clock changes). Treat as no-op.
    if (nowWallMs < state.lastTickWallTime) {
        return { ...state, lastTickWallTime: nowWallMs }
    }

    const wallElapsed = nowWallMs - state.lastTickWallTime

    // VAD gate — hold display when silent.
    if (state.vadState === "silent") {
        return { ...state, lastTickWallTime: nowWallMs }
    }

    // Manual tier — no auto-advance. Operator drives via next/prev events.
    if (state.tier === "manual") {
        return { ...state, lastTickWallTime: nowWallMs }
    }

    // ── Cursor advance ───────────────────────────────────────────────────────

    let newCursorRefTime = state.cursorRefTime

    // Position-correction animation in flight — interpolate toward the target.
    let pcTarget = state.positionCorrectionTargetMs
    let pcStarted = state.positionCorrectionStartedAt
    let pcAnchor = state.positionCorrectionAnchorMs

    if (pcTarget !== null && pcStarted !== null && pcAnchor !== null) {
        const elapsed = nowWallMs - pcStarted
        const t = Math.max(0, Math.min(1, elapsed / positionCorrectionDurationMs))
        // Linear interpolation — simple, predictable, and the visual sweep effect is
        // handled by KR's per-word --progress. Smoothness here is just "no jump".
        newCursorRefTime = pcAnchor + (pcTarget - pcAnchor) * t

        if (t >= 1) {
            // Animation complete — snap to the target and clear the animation state.
            newCursorRefTime = pcTarget
            pcTarget = null
            pcStarted = null
            pcAnchor = null
        }
    } else {
        // Normal advance: deltaRefMs = wallElapsed * (auto ? tempoRatio : 1.0).
        const tempo = state.tier === "auto" ? state.tempoRatio : 1.0
        const safeTempo = Number.isFinite(tempo) ? tempo : 1.0
        newCursorRefTime = state.cursorRefTime + wallElapsed * safeTempo
    }

    // ── Tier degradation accumulator (auto only) ──────────────────────────────
    let lowConfidenceDurationMs = state.lowConfidenceDurationMs
    let nextTier = state.tier
    if (state.tier === "auto") {
        if (state.beatConfidence < confidenceThreshold) {
            lowConfidenceDurationMs += wallElapsed
            if (lowConfidenceDurationMs > confidenceDegradationMs) {
                nextTier = "timer"
                lowConfidenceDurationMs = 0
            }
        } else {
            lowConfidenceDurationMs = 0
        }
    } else {
        lowConfidenceDurationMs = 0
    }

    // ── Resolve word position ────────────────────────────────────────────────
    const totalDurationMs = sequenceDurationMs(state.activeTimingMap, state.activeArrangement)
    const lookup = lookupWord({
        map: state.activeTimingMap,
        arrangement: state.activeArrangement,
        cursorRefTime: newCursorRefTime
    })

    let newSlideIndex = state.currentSlideIndex
    let newWordIndex = state.currentWordIndex
    let newWordProgress = state.wordProgress

    if (lookup) {
        newSlideIndex = lookup.slideIndex
        newWordIndex = lookup.wordIndex
        newWordProgress = lookup.wordProgress
    }

    // ── Song-boundary detection ──────────────────────────────────────────────
    let nextRunState: SyncEngineState["runState"] = state.runState
    if (lookup && lookup.pastEnd) {
        nextRunState = "finished"
    }

    return {
        ...state,
        tier: nextTier,
        runState: nextRunState,
        cursorRefTime: newCursorRefTime,
        totalDurationMs,
        currentSlideIndex: newSlideIndex,
        currentWordIndex: newWordIndex,
        wordProgress: newWordProgress,
        lastTickWallTime: nowWallMs,
        lowConfidenceDurationMs,
        positionCorrectionTargetMs: pcTarget,
        positionCorrectionStartedAt: pcStarted,
        positionCorrectionAnchorMs: pcAnchor
    }
}
