// LyriCue shared types. Schemas correspond 1:1 to architecture.md §6.
// Detailed types land per their owning epics; this barrel re-exports each subsection.

export * from "./schema-versions.js"
export * from "./identity.js"
export * from "./library-config.js"
export * from "./settings.js"
export * from "./timing-map.js"

/**
 * Deployment-mode discriminator. Decides which OutputAdapter is the default at runtime
 * and which entry point electron-builder packages. See architecture.md ADR-16 & ADR-17.
 */
export type DeploymentMode = "fork" | "sister"

/**
 * Current deployment mode is injected at build time via the LC_DEPLOYMENT_MODE env var.
 * Falls back to "sister" for development convenience when unset.
 */
export const DEPLOYMENT_MODE: DeploymentMode =
    (typeof process !== "undefined" && (process.env.LC_DEPLOYMENT_MODE as DeploymentMode)) || "sister"

/**
 * The top-level IPC channel name LyriCue uses for all main↔renderer messaging.
 * In fork mode, FreeShow's main process registers a listener on this channel (via the
 * fork patch in `apps/fork/freeshow/src/types/Channels.ts`). In sister mode, our own
 * Electron main does the same. Either way, the wire shape is `{ channel: string; data: any }`.
 *
 * See architecture.md §6.4.
 */
export const LYRICUE = "LYRICUE" as const
