/**
 * SyncFrame and LoadMapPayload — the data the Sync Engine pushes through OutputAdapter.
 *
 * Per architecture.md §6.4. Channel name was renamed from the legacy `WS_*` (WorshipSync)
 * to `LC_*` (LyriCue) for consistency with the project rename, per epics.md STORY-02.2 AC2.
 *
 * Stability contract: these payloads are the wire format between SE and KR. Renaming or
 * reshaping requires a coordinated update to all OutputAdapter implementations.
 */

import type { Arrangement, ParallelLyricsTrack, TimingMap } from "../types/timing-map.js"

/**
 * IPC channel-name discriminator embedded in `Message.channel` on the OUTPUT channel.
 * In fork mode, FreeShow's existing OUTPUT IPC channel multiplexes messages by this name.
 * In sister mode, LyriCue's internal IPC uses the same discriminator for symmetry.
 */
export const LC_SYNC_FRAME = "LC_SYNC_FRAME" as const
export const LC_LOAD_MAP = "LC_LOAD_MAP" as const

/**
 * Per-frame state pushed at up to 60 Hz. The renderer is dumb: it derives every visible
 * pixel from a SyncFrame + the currently-loaded TimingMap. No state lives in KR.
 */
export interface SyncFrame {
    /** Identifies which karaoke output window receives this frame. Multi-output is supported. */
    outputId: string
    /** Index into the active arrangement's slide sequence (or the timing map's native order). */
    slideIndex: number
    /** Index into the active slide's words. */
    wordIndex: number
    /**
     * Fractional progress through the current word, [0, 1]. Drives the sweep gradient
     * in KR via a CSS custom property — no per-frame JS DOM mutation.
     */
    wordProgress: number
    /** Current control tier. Affects the on-screen mode indicator. */
    tier: "auto" | "timer" | "manual"
    /** VAD state. When `silent`, the renderer holds steady; KR may dim or pulse the display. */
    vad: "active" | "silent"
}

/**
 * Sent once per song-change. The adapter caches the map locally so subsequent SyncFrames
 * don't have to ship it; that keeps the per-frame payload tiny.
 *
 * Arrangement is null when the operator hasn't picked a non-default arrangement — KR
 * walks the timing map's native section order in that case.
 */
export interface LoadMapPayload {
    outputId: string
    showId: string
    timingMap: TimingMap
    arrangement: Arrangement | null
    /** Optional parallel translation tracks (FR10). Undefined when the operator hasn't enabled them. */
    parallelLyrics?: ParallelLyricsTrack[]
}
