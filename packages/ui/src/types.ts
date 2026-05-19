/**
 * Shared TypeScript types for the UI components.
 *
 * Svelte 3's `<script lang="ts">` doesn't support `export type` / `export interface`
 * declarations directly (they require `<script context="module">`). Rather than ship
 * a module-context block in every component, we centralise the shared types here and
 * consume them via standard TS imports.
 */

export type SyncTier = "auto" | "timer" | "manual"
export type TimingMapVariant = "studio" | "rehearsal"

export interface TierTransition {
    from: SyncTier
    to: SyncTier
    /** Plain-language explanation for the operator. */
    reason: string
    /** Wall-clock timestamp when the transition happened. */
    atWallMs: number
}

export type SyncStatus = "learned" | "partial" | "not-learned"

export interface SetlistSong {
    id: string
    title: string
    syncStatus: SyncStatus
    /** Reference BPM, or null when not yet learned. */
    bpm: number | null
    /** Optional artist for display. */
    artist?: string
}

export interface AudioDeviceInfo {
    deviceId: string
    label: string
    kind: "audioinput"
    groupId: string
}
