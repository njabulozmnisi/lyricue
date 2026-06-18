/**
 * Resolves the on-disk paths LyriCue uses under a given userData directory.
 *
 * The userData root is supplied by the host app (Electron's app.getPath('userData') in
 * production; an env override in tests). Core code never imports `electron`, so the host
 * passes the path in rather than us computing it.
 *
 * Directory layout per architecture.md §4.3:
 *   <userData>/lyricue/
 *     ├── settings.json
 *     ├── identity.json
 *     ├── library-config.json
 *     ├── timing-maps/
 *     │   └── <showId>.timing.json
 *     ├── arrangements/
 *     │   └── <showId>.arrangements.json
 *     ├── projects/
 *     │   └── active-project.json
 *     ├── rehearsals/
 *     │   └── <recordingId>.wav
 *     ├── models/
 *     │   └── <modelName>-<version>/
 *     └── logs/
 *         └── positions-<date>.jsonl
 */

import { join } from "node:path"
import type { LearnedFromMethod } from "../types/timing-map.js"

export interface LyriCuePaths {
    /** The lyricue root inside userData. */
    root: string
    settingsFile: string
    identityFile: string
    libraryConfigFile: string
    timingMapsDir: string
    arrangementsDir: string
    projectsDir: string
    activeProjectFile: string
    rehearsalsDir: string
    modelsDir: string
    logsDir: string
}

export function resolveLyriCuePaths(userDataDir: string): LyriCuePaths {
    const root = join(userDataDir, "lyricue")
    return {
        root,
        settingsFile: join(root, "settings.json"),
        identityFile: join(root, "identity.json"),
        libraryConfigFile: join(root, "library-config.json"),
        timingMapsDir: join(root, "timing-maps"),
        arrangementsDir: join(root, "arrangements"),
        projectsDir: join(root, "projects"),
        activeProjectFile: join(root, "projects", "active-project.json"),
        rehearsalsDir: join(root, "rehearsals"),
        modelsDir: join(root, "models"),
        logsDir: join(root, "logs")
    }
}

/**
 * Returns a per-show timing-map path. Show IDs are FreeShow's stable IDs;
 * filenames use them verbatim, but every external caller (operator IPC, learn-song
 * sidecar response, library import, REST project adapter) is untrusted so we MUST
 * reject any showId that could escape the timing-maps directory or contain a
 * filename-unsafe character. Without this guard, a `selectSong` IPC carrying
 * `../../../etc/passwd` would resolve to a sibling-of-userData write.
 */
export function timingMapPath(paths: LyriCuePaths, showId: string): string {
    assertSafeShowId(showId)
    return join(paths.timingMapsDir, `${showId}.timing.json`)
}

export function timingMapVariantPath(paths: LyriCuePaths, showId: string, variant: Extract<LearnedFromMethod, "studio" | "rehearsal">): string {
    assertSafeShowId(showId)
    return join(paths.timingMapsDir, `${showId}.${variant}.timing.json`)
}

export function arrangementsPath(paths: LyriCuePaths, showId: string): string {
    assertSafeShowId(showId)
    return join(paths.arrangementsDir, `${showId}.arrangements.json`)
}

/**
 * Validates a showId is safe to interpolate into a filesystem path.
 *
 * Allowed: ASCII letters, digits, `-`, `_`, `.` — but NEVER a path separator, the
 * special `.` / `..` segments, leading/trailing whitespace, or any control character.
 * Maximum length is 200 chars (FreeShow IDs are short; longer values are either
 * abusive or accidental concatenation).
 *
 * Throws synchronously with an "invalid showId" message so callers fail loudly
 * rather than writing to a sandbox-escaping path.
 */
export function assertSafeShowId(showId: string): void {
    if (typeof showId !== "string" || showId.length === 0 || showId.length > 200) {
        throw new Error(`invalid showId: must be a non-empty string ≤200 chars`)
    }
    if (showId === "." || showId === "..") {
        throw new Error(`invalid showId: dot segments are not allowed`)
    }
    // Reject any path-separator, control char (incl. NUL/newline), whitespace, or
    // characters that the host OS reserves on Windows (* ? " < > | : ).
    // The positive regex is intentionally tight: alphanumeric plus -_. only.
    // This rejects unicode showIds — acceptable: FreeShow's stable IDs are ASCII.
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(showId)) {
        throw new Error(`invalid showId: contains disallowed characters (allowed: A-Z a-z 0-9 . _ -)`)
    }
}
