/**
 * SyncEngineState + state-machine transitions.
 *
 * Per EP-09 STORY-09.1, architecture.md §4.8.
 *
 * The state is the *single source of truth* SE owns. Every transition is a pure
 * function: `(state, event) → state'`. SE's tick loop reads the state, computes
 * a new state via these functions, and atomically replaces it via the store.
 *
 * Tier semantics (FR5.4–5.6 + architecture.md §4.8):
 *
 *   - **auto** — full AI sync: BD's tempoRatio drives cursorRefTime advancement.
 *   - **timer** — fallback: cursorRefTime advances at native speed (tempoRatio=1.0)
 *     until the operator intervenes or re-engages auto.
 *   - **manual** — the operator drives slide changes directly; no auto-advance.
 *   - **waitingForStart** — a song has loaded but VAD hasn't been engaged yet.
 *     Cursor is frozen at song start; first VAD-active event triggers startSync.
 *     This is a sub-state SE enters between songs; tier remains whatever the
 *     operator's preference is, but the rAF loop holds the cursor.
 */

import type { Arrangement, TimingMap } from "../types/timing-map.js"

export type SyncTier = "auto" | "timer" | "manual"

/**
 * Sub-state distinct from tier. While tier captures "how SE advances the cursor",
 * `runState` captures "should SE be advancing the cursor at all". The two together
 * fully describe SE's behaviour on any given tick.
 *
 *   - **idle**: no map loaded, cursor at 0, nothing to do.
 *   - **waitingForStart**: map loaded but VAD hasn't engaged yet (song just started
 *     or the operator just reset). Cursor frozen at song-start.
 *   - **running**: actively advancing the cursor per tier rules.
 *   - **finished**: cursor has past the last word's endMs — songComplete fired,
 *     SE is waiting for the next song to load OR for the operator to manually
 *     re-engage.
 */
export type SyncRunState = "idle" | "waitingForStart" | "running" | "finished"

export interface SyncEngineState {
    /** Tier and run-state — see types above. */
    tier: SyncTier
    runState: SyncRunState

    /** Active timing map + arrangement. null when no song is loaded. */
    activeTimingMap: TimingMap | null
    activeArrangement: Arrangement | null
    activeShowId: string | null

    /** Cursor position in reference-track ms. 0 = song start. */
    cursorRefTime: number

    /** Total duration of the active sequence in reference-track ms. 0 when no song. */
    totalDurationMs: number

    /** Wall-clock time when the cursor was last advanced. Used to compute deltaRefMs. */
    lastTickWallTime: number | null

    /** Wall-clock time when sync engaged for the current song (FR5.5 debounce baseline). */
    songStartWallTime: number | null

    /** Latest tempoRatio from BD (clamped to [0.7,1.4] or 1.0 — see audio/tempo.ts). */
    tempoRatio: number

    /** Latest beatConfidence from BD, in [0,1]. */
    beatConfidence: number

    /** VAD state — drives the silent-gate in the tick loop. */
    vadState: "active" | "silent"

    /** Cursor's resolved word position, mirroring lookupWord's output. */
    currentSlideIndex: number
    currentWordIndex: number
    wordProgress: number

    /** Wall-clock timestamp of the last manual override (next/prev/toggle). null if none. */
    lastManualInterventionAt: number | null

    /**
     * Pending position-correction target in reference-track ms. When non-null, the
     * tick loop's animator interpolates `cursorRefTime` from its current value toward
     * `positionCorrectionTargetMs` over POSITION_CORRECTION_DURATION_MS, then clears
     * this field.
     */
    positionCorrectionTargetMs: number | null
    /** Wall-clock time the current position-correction animation started. null when idle. */
    positionCorrectionStartedAt: number | null
    /** cursorRefTime at the moment the animation started — anchor for interpolation. */
    positionCorrectionAnchorMs: number | null

    /**
     * Accumulated wall-ms of confidence-below-threshold runs. Resets on every confident
     * tick. When this exceeds CONFIDENCE_DEGRADATION_MS, SE degrades auto → timer.
     */
    lowConfidenceDurationMs: number
}

/** Default state for a fresh SE — no song, idle. */
export function makeInitialState(): SyncEngineState {
    return {
        tier: "auto",
        runState: "idle",
        activeTimingMap: null,
        activeArrangement: null,
        activeShowId: null,
        cursorRefTime: 0,
        totalDurationMs: 0,
        lastTickWallTime: null,
        songStartWallTime: null,
        tempoRatio: 1.0,
        beatConfidence: 0,
        vadState: "silent",
        currentSlideIndex: 0,
        currentWordIndex: 0,
        wordProgress: 0,
        lastManualInterventionAt: null,
        positionCorrectionTargetMs: null,
        positionCorrectionStartedAt: null,
        positionCorrectionAnchorMs: null,
        lowConfidenceDurationMs: 0
    }
}

/** Position-correction animation duration in ms (FR4.4). */
export const POSITION_CORRECTION_DURATION_MS = 300 as const

/** beatConfidence threshold below which the auto → timer degradation timer accumulates. */
export const CONFIDENCE_DEGRADATION_THRESHOLD = 0.4 as const

/** Accumulated low-confidence ms before auto → timer fires (FR5.5). */
export const CONFIDENCE_DEGRADATION_MS = 10_000 as const

/** Manual-override debounce window — STT position corrections are ignored within this window. */
export const DEFAULT_MANUAL_DEBOUNCE_MS = 3000 as const

/**
 * Hard-clamp envelope for tempoRatio. The audio module is responsible for the primary
 * clamp before sending tempoUpdate, but SE applies a belt-and-braces clamp because a
 * bypassed audio path (synthetic driver bug, a future direct test seam, a misbehaving
 * sidecar response) must not propagate an out-of-envelope ratio into the cursor — that
 * would either freeze the karaoke output (NaN cascades) or scroll lyrics at a non-musical
 * rate during live worship.
 *
 * Module-local constants so they don't collide with the canonical exports in audio/index.
 */
const SE_TEMPO_RATIO_MIN = 0.7
const SE_TEMPO_RATIO_MAX = 1.4

/** Sanitises a tempoRatio for entry into state. NaN/Infinity collapse to 1.0 (native). */
function sanitizeTempoRatio(value: number): number {
    if (!Number.isFinite(value)) return 1.0
    if (value < SE_TEMPO_RATIO_MIN) return SE_TEMPO_RATIO_MIN
    if (value > SE_TEMPO_RATIO_MAX) return SE_TEMPO_RATIO_MAX
    return value
}

/** Sanitises a beatConfidence for entry into state. NaN collapses to 0; clamps to [0,1]. */
function sanitizeBeatConfidence(value: number): number {
    if (!Number.isFinite(value)) return 0
    if (value < 0) return 0
    if (value > 1) return 1
    return value
}

/**
 * Sanitises a cursor target (ref-ms). NaN/Infinity are rejected by returning null —
 * callers branch on null to skip the transition rather than writing NaN into cursorRefTime.
 * Negative values are clamped to 0 (cursor cannot precede song start).
 */
function sanitizeCursorTarget(value: number): number | null {
    if (!Number.isFinite(value)) return null
    if (value < 0) return 0
    return value
}

// ─── Events ──────────────────────────────────────────────────────────────────

/**
 * Discriminated union of every event SE responds to. Each transition function below
 * handles a single event variant; the tick loop dispatches incoming events through
 * `applyEvent()`.
 *
 * Events are the only way state changes outside the tick loop's own per-frame advance.
 */
export type SyncEvent =
    | { kind: "loadSong"; map: TimingMap; arrangement: Arrangement | null; showId: string }
    | { kind: "clearSong" }
    | { kind: "engageSync"; wallTime: number }
    | { kind: "tempoUpdate"; tempoRatio: number; beatConfidence: number }
    | { kind: "vadUpdate"; vadState: "active" | "silent" }
    | { kind: "audioInputLost" }
    | { kind: "forceTier"; tier: SyncTier; wallTime: number }
    | { kind: "nextSection"; targetRefMs: number; wallTime: number }
    | { kind: "prevSection"; targetRefMs: number; wallTime: number }
    | { kind: "toggleManual"; wallTime: number }
    | { kind: "reEngageSync"; wallTime: number }
    | { kind: "positionCorrection"; targetRefMs: number; wallTime: number }
    | { kind: "songComplete" }

// ─── Pure transition functions ───────────────────────────────────────────────

export function onLoadSong(
    state: SyncEngineState,
    event: { map: TimingMap; arrangement: Arrangement | null; showId: string }
): SyncEngineState {
    return {
        ...makeInitialState(),
        tier: state.tier, // preserve the operator's tier choice across songs
        activeTimingMap: event.map,
        activeArrangement: event.arrangement,
        activeShowId: event.showId,
        runState: "waitingForStart"
    }
}

export function onClearSong(state: SyncEngineState): SyncEngineState {
    return { ...makeInitialState(), tier: state.tier }
}

export function onEngageSync(state: SyncEngineState, event: { wallTime: number }): SyncEngineState {
    if (state.activeTimingMap === null) return state
    return {
        ...state,
        runState: "running",
        cursorRefTime: 0,
        currentSlideIndex: 0,
        currentWordIndex: 0,
        wordProgress: 0,
        songStartWallTime: event.wallTime,
        lastTickWallTime: event.wallTime,
        lowConfidenceDurationMs: 0
    }
}

export function onTempoUpdate(
    state: SyncEngineState,
    event: { tempoRatio: number; beatConfidence: number }
): SyncEngineState {
    return {
        ...state,
        tempoRatio: sanitizeTempoRatio(event.tempoRatio),
        beatConfidence: sanitizeBeatConfidence(event.beatConfidence)
    }
}

export function onVadUpdate(
    state: SyncEngineState,
    event: { vadState: "active" | "silent" }
): SyncEngineState {
    // VAD doesn't change tier or runState directly. The tick loop reads vadState and
    // gates the cursor advance. The only state field updated here is vadState itself.
    return { ...state, vadState: event.vadState }
}

/**
 * Audio input lost — immediate degradation to timer per architecture §4.8. The
 * NFR2.4 budget (3s) is generous; we react synchronously.
 */
export function onAudioInputLost(state: SyncEngineState): SyncEngineState {
    if (state.tier === "manual") return state
    return { ...state, tier: "timer", lowConfidenceDurationMs: 0 }
}

/**
 * Force a tier transition (operator keyboard / UI). Per architecture: "user forces it
 * takes precedence over auto-degradation".
 */
export function onForceTier(
    state: SyncEngineState,
    event: { tier: SyncTier; wallTime: number }
): SyncEngineState {
    if (event.tier === state.tier) return state
    return {
        ...state,
        tier: event.tier,
        lastManualInterventionAt: event.wallTime,
        lowConfidenceDurationMs: 0
    }
}

export function onNextSection(
    state: SyncEngineState,
    event: { targetRefMs: number; wallTime: number }
): SyncEngineState {
    const target = sanitizeCursorTarget(event.targetRefMs)
    if (target === null) return state // invalid target — refuse to corrupt cursor
    return {
        ...state,
        cursorRefTime: target,
        lastManualInterventionAt: event.wallTime,
        // Manual jumps reset any in-flight position-correction animation.
        positionCorrectionTargetMs: null,
        positionCorrectionStartedAt: null,
        positionCorrectionAnchorMs: null
    }
}

export function onPrevSection(
    state: SyncEngineState,
    event: { targetRefMs: number; wallTime: number }
): SyncEngineState {
    const target = sanitizeCursorTarget(event.targetRefMs)
    if (target === null) return state
    return {
        ...state,
        cursorRefTime: target,
        lastManualInterventionAt: event.wallTime,
        positionCorrectionTargetMs: null,
        positionCorrectionStartedAt: null,
        positionCorrectionAnchorMs: null
    }
}

export function onToggleManual(
    state: SyncEngineState,
    event: { wallTime: number }
): SyncEngineState {
    const nextTier: SyncTier = state.tier === "manual" ? "auto" : "manual"
    return {
        ...state,
        tier: nextTier,
        lastManualInterventionAt: event.wallTime,
        lowConfidenceDurationMs: 0
    }
}

export function onReEngageSync(
    state: SyncEngineState,
    event: { wallTime: number }
): SyncEngineState {
    // Re-engage from manual/timer → auto. Also reset song-start anchor so tempo math
    // baselines from "now" (architecture §4.8: "re-engaging Auto re-establishes the
    // song start anchor").
    return {
        ...state,
        tier: "auto",
        songStartWallTime: event.wallTime,
        lastTickWallTime: event.wallTime,
        lowConfidenceDurationMs: 0
    }
}

/**
 * Position correction (from STT). Caller has already computed the target ref-ms.
 * Sets up the animation anchor — the tick loop's interpolator will progress the cursor
 * from `positionCorrectionAnchorMs` to `positionCorrectionTargetMs` over
 * POSITION_CORRECTION_DURATION_MS.
 *
 * Suppressed entirely when the manual-debounce window is active.
 */
export function onPositionCorrection(
    state: SyncEngineState,
    event: { targetRefMs: number; wallTime: number },
    debounceMs = DEFAULT_MANUAL_DEBOUNCE_MS
): SyncEngineState {
    if (state.lastManualInterventionAt !== null) {
        const sinceManual = event.wallTime - state.lastManualInterventionAt
        if (sinceManual < debounceMs) return state // suppressed
    }
    const target = sanitizeCursorTarget(event.targetRefMs)
    if (target === null) return state // NaN/Infinity target — refuse
    // Snap-and-re-animate: if an animation is already in flight, the new target replaces
    // it (architecture: "Animation can be interrupted by another correction").
    return {
        ...state,
        positionCorrectionTargetMs: target,
        positionCorrectionStartedAt: event.wallTime,
        positionCorrectionAnchorMs: state.cursorRefTime
    }
}

export function onSongComplete(state: SyncEngineState): SyncEngineState {
    return { ...state, runState: "finished" }
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

/**
 * Single entry point for all events. Tests use this to exercise every transition with
 * a uniform invocation shape; production SE calls it from its event handlers.
 *
 * Unknown event kinds return the state unchanged (TypeScript's exhaustiveness check
 * catches new variants at compile time; this branch defends against runtime drift).
 */
export function applyEvent(state: SyncEngineState, event: SyncEvent): SyncEngineState {
    switch (event.kind) {
        case "loadSong":
            return onLoadSong(state, event)
        case "clearSong":
            return onClearSong(state)
        case "engageSync":
            return onEngageSync(state, event)
        case "tempoUpdate":
            return onTempoUpdate(state, event)
        case "vadUpdate":
            return onVadUpdate(state, event)
        case "audioInputLost":
            return onAudioInputLost(state)
        case "forceTier":
            return onForceTier(state, event)
        case "nextSection":
            return onNextSection(state, event)
        case "prevSection":
            return onPrevSection(state, event)
        case "toggleManual":
            return onToggleManual(state, event)
        case "reEngageSync":
            return onReEngageSync(state, event)
        case "positionCorrection":
            return onPositionCorrection(state, event)
        case "songComplete":
            return onSongComplete(state)
        default: {
            // Exhaustiveness check: typeof event => never. If a future event kind is added
            // without a case, TS will fail compilation here.
            const _exhaustive: never = event
            void _exhaustive
            return state
        }
    }
}
