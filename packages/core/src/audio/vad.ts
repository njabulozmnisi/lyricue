/**
 * Voice Activity Detector — energy-based with Schmitt-trigger hysteresis.
 *
 * Per EP-08 STORY-08.1, architecture.md §4.6, FR3.9 + FR3.10.
 *
 * The VAD's job is to tell the Sync Engine whether the worship leader is currently
 * producing intentional audio (singing, instrument intro) or in a silent gap
 * (prayer pause, transition). Energy alone is enough for this — we don't need to
 * distinguish speech from singing here (ST handles that downstream).
 *
 * Schmitt-trigger pattern:
 *
 *   - `silent → active`:  RMS above `enterThreshold` for ≥enterMs (default 300ms)
 *   - `active → silent`:  RMS below `exitThreshold` for ≥exitMs (default 1500ms)
 *
 * The two thresholds + the asymmetric dwell times eliminate the flicker a naïve
 * single-threshold detector would produce when the signal hovers near the cutoff.
 * The longer silent dwell (1500ms vs 300ms) is intentional: worship songs have
 * legitimate soft passages and we want to hold display rather than yo-yo states.
 *
 * The detector is **pure** (no side effects beyond the store + callback fan-out).
 * Tests inject a deterministic clock via `now`, so timing-based assertions are
 * frame-accurate without sleeping. It NEVER throws — non-finite RMS values are
 * treated as 0.
 */

import { writable, type Readable } from "../settings/observable.js"

export type VadState = "active" | "silent"

export interface VadOptions {
    /**
     * RMS threshold the signal must EXCEED to begin counting toward `active`.
     * Documented default: 0.05 (calibrated for typical sound-desk line levels,
     * matches DEFAULT_LYRICUE_SETTINGS.sync.vadEnterThreshold). Override in
     * production via the host's settings IPC.
     */
    enterThreshold?: number
    /**
     * RMS threshold the signal must FALL BELOW to begin counting toward `silent`.
     * Must be < enterThreshold to give the trigger any hysteresis. Default 0.02.
     */
    exitThreshold?: number
    /** Sustained ms above enterThreshold required to enter `active`. Default 300. */
    enterMs?: number
    /** Sustained ms below exitThreshold required to fall back to `silent`. Default 1500. */
    exitMs?: number
    /** Initial state. Default `silent` — we always boot in silent. */
    initialState?: VadState
    /** Clock injection — defaults to performance.now(). */
    now?: () => number
}

export interface VadDetector {
    /** Svelte-store-compatible state stream. Subscribers fire on every transition. */
    readonly state: Readable<VadState>

    /** Subscribe to transition events (callback form). Returns an unsubscribe handler. */
    onTransition(handler: (state: VadState) => void): () => void

    /**
     * Feed one Meyda-window's RMS. nowMs is the wall-clock timestamp of the window
     * (caller usually passes `performance.now()`). Returns the resulting state.
     *
     * Non-finite RMS is coerced to 0 (no throw, no NaN propagation).
     */
    feed(rms: number, nowMs?: number): VadState

    /** Snapshot of the current state without subscribing. */
    snapshot(): VadState

    /**
     * Reset the detector — clears any in-flight dwell timers and returns to the
     * initial state. Used on song change.
     */
    reset(): void
}

/**
 * Defaults match DEFAULT_LYRICUE_SETTINGS.sync.{vadEnterThreshold, vadExitThreshold,
 * vadEnterMs, vadExitMs}. Keeping the defaults inline avoids forcing a settings-store
 * import on every VAD consumer (useful for unit tests + headless scripts).
 */
export const DEFAULT_VAD_ENTER_THRESHOLD = 0.05 as const
export const DEFAULT_VAD_EXIT_THRESHOLD = 0.02 as const
export const DEFAULT_VAD_ENTER_MS = 300 as const
export const DEFAULT_VAD_EXIT_MS = 1500 as const

export function createVadDetector(opts: VadOptions = {}): VadDetector {
    const enterThreshold = opts.enterThreshold ?? DEFAULT_VAD_ENTER_THRESHOLD
    const exitThreshold = opts.exitThreshold ?? DEFAULT_VAD_EXIT_THRESHOLD
    const enterMs = opts.enterMs ?? DEFAULT_VAD_ENTER_MS
    const exitMs = opts.exitMs ?? DEFAULT_VAD_EXIT_MS
    const initial: VadState = opts.initialState ?? "silent"
    const now = opts.now ?? (() => performance.now())

    const stateStore = writable<VadState>(initial)
    const handlers = new Set<(s: VadState) => void>()

    /**
     * Wall-time when the current dwell period started. null when the signal is
     * stable (i.e., when the current RMS isn't pushing toward the *other* state).
     *
     *   - In `silent`: this is the moment RMS first crossed above enterThreshold.
     *     If RMS stays above for ≥enterMs, we transition to `active` and clear.
     *     If RMS dips back below enterThreshold, we clear (no commitment).
     *   - In `active`: this is the moment RMS first dropped below exitThreshold.
     *     If RMS stays below for ≥exitMs, we transition to `silent` and clear.
     *     If RMS rises above exitThreshold, we clear.
     */
    let dwellStart: number | null = null
    let current: VadState = initial

    function setState(next: VadState): void {
        if (next === current) return
        current = next
        stateStore.set(next)
        for (const h of [...handlers]) {
            try {
                h(next)
            } catch (err) {
                // A subscriber MUST NOT take down the pipeline.
                // eslint-disable-next-line no-console
                console.error("[lyricue:vad] onTransition handler threw:", err)
            }
        }
    }

    function feed(rmsRaw: number, nowMsArg?: number): VadState {
        const rms = Number.isFinite(rmsRaw) && rmsRaw > 0 ? rmsRaw : 0
        const t = nowMsArg ?? now()

        if (current === "silent") {
            // Trying to enter `active`: signal must stay above the enter threshold
            // continuously for ≥enterMs.
            if (rms > enterThreshold) {
                if (dwellStart === null) {
                    dwellStart = t
                } else if (t - dwellStart >= enterMs) {
                    setState("active")
                    dwellStart = null
                }
            } else {
                // Signal dipped below enter threshold — abandon the dwell.
                dwellStart = null
            }
        } else {
            // active state. Trying to exit to `silent`: signal must stay below the
            // exit threshold continuously for ≥exitMs.
            if (rms < exitThreshold) {
                if (dwellStart === null) {
                    dwellStart = t
                } else if (t - dwellStart >= exitMs) {
                    setState("silent")
                    dwellStart = null
                }
            } else {
                // Signal climbed back above exit threshold — abandon the dwell.
                dwellStart = null
            }
        }

        return current
    }

    return {
        state: { subscribe: (run) => stateStore.subscribe(run) },
        onTransition(handler) {
            handlers.add(handler)
            return () => {
                handlers.delete(handler)
            }
        },
        feed,
        snapshot() {
            return current
        },
        reset() {
            dwellStart = null
            if (current !== initial) {
                current = initial
                stateStore.set(initial)
            }
        }
    }
}
