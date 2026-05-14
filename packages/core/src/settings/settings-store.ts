/**
 * SettingsStore — persists the operator-facing LyriCueSettings tree to `<userData>/lyricue/settings.json`.
 *
 * Owned by the Electron main process; renderer code reads via IPC. Lifecycle:
 *   1. App boot: `new SettingsStore(paths)` then `await store.load()`.
 *   2. Subsequent changes: `await store.save(updated)` — atomic, schema-validated.
 *   3. UI components subscribe via `store.subscribe(fn)` and re-render on every persist.
 */

import { DEFAULT_LYRICUE_SETTINGS, LyriCueSettingsSchema, type LyriCueSettings } from "../types/index.js"
import type { LyriCuePaths } from "./paths.js"
import { JsonFileStore } from "./json-file-store.js"

export class SettingsStore extends JsonFileStore<LyriCueSettings> {
    constructor(paths: LyriCuePaths) {
        super({
            filePath: paths.settingsFile,
            schema: LyriCueSettingsSchema,
            defaults: DEFAULT_LYRICUE_SETTINGS
        })
    }
}
