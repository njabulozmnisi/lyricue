/**
 * LibraryConfigStore — persists LibraryConfig to `<userData>/lyricue/library-config.json`.
 *
 * Per architecture.md §6.4. Credentials and signing keys are stored as SecretRef handles;
 * the raw secrets live in the OS keychain via Electron's safeStorage and are resolved at
 * use-time, not at load-time. This file alone reveals which credentials *exist* but not
 * their values — safe to back up or copy across machines.
 */

import { DEFAULT_LIBRARY_CONFIG, LibraryConfigSchema, type LibraryConfig } from "../types/index.js"
import type { LyriCuePaths } from "./paths.js"
import { JsonFileStore } from "./json-file-store.js"

export class LibraryConfigStore extends JsonFileStore<LibraryConfig> {
    constructor(paths: LyriCuePaths) {
        super({
            filePath: paths.libraryConfigFile,
            schema: LibraryConfigSchema,
            defaults: DEFAULT_LIBRARY_CONFIG
        })
    }
}
