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
 *     ├── rehearsals/
 *     │   └── <recordingId>.wav
 *     ├── models/
 *     │   └── <modelName>-<version>/
 *     └── logs/
 *         └── positions-<date>.jsonl
 */

import { join } from "node:path"

export interface LyriCuePaths {
    /** The lyricue root inside userData. */
    root: string
    settingsFile: string
    identityFile: string
    libraryConfigFile: string
    timingMapsDir: string
    arrangementsDir: string
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
        rehearsalsDir: join(root, "rehearsals"),
        modelsDir: join(root, "models"),
        logsDir: join(root, "logs")
    }
}

/**
 * Returns a per-show timing-map path. Show IDs are FreeShow's stable IDs;
 * filenames use them verbatim because they're already URL-safe.
 */
export function timingMapPath(paths: LyriCuePaths, showId: string): string {
    return join(paths.timingMapsDir, `${showId}.timing.json`)
}

export function arrangementsPath(paths: LyriCuePaths, showId: string): string {
    return join(paths.arrangementsDir, `${showId}.arrangements.json`)
}
