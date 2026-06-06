import { resolve } from "node:path"

export type LearnSongAlignmentMode = "deterministic" | "production"

export const DETERMINISTIC_LEARN_SONG_TIMEOUT_MS = 120_000
export const PRODUCTION_LEARN_SONG_TIMEOUT_MS = 7 * 60 * 1000

export function learnSongTimeoutMs(alignmentMode: LearnSongAlignmentMode): number {
    return alignmentMode === "production" ? PRODUCTION_LEARN_SONG_TIMEOUT_MS : DETERMINISTIC_LEARN_SONG_TIMEOUT_MS
}

export function resolveSourceSidecarPythonOverride(opts: {
    sidecarRoot: string
    envOverride: string | undefined
    exists: (path: string) => boolean
}): string | null {
    const explicit = opts.envOverride?.trim()
    if (explicit) return explicit

    const venvPython = resolve(opts.sidecarRoot, ".venv", "bin", "python")
    return opts.exists(venvPython) ? venvPython : null
}
