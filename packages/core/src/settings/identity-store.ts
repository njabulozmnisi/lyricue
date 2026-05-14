/**
 * IdentityStore — persists InstallIdentity (org/campus/user) to `<userData>/lyricue/identity.json`.
 *
 * Per architecture.md §6.3 + MC-NFR6: anonymous-by-default. A fresh install has
 * `org: 'local', campus: 'default', user.isAnonymous: true` until the first-run wizard runs.
 */

import { DEFAULT_INSTALL_IDENTITY, InstallIdentitySchema, type InstallIdentity } from "../types/index.js"
import type { LyriCuePaths } from "./paths.js"
import { JsonFileStore } from "./json-file-store.js"

export class IdentityStore extends JsonFileStore<InstallIdentity> {
    constructor(paths: LyriCuePaths) {
        super({
            filePath: paths.identityFile,
            schema: InstallIdentitySchema,
            defaults: DEFAULT_INSTALL_IDENTITY
        })
    }
}
