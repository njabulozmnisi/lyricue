/**
 * LyriCue main-process init for fork mode.
 *
 * Called by FreeShow's `app.on('ready')` handler via the patch in
 * `apps/fork/freeshow/src/electron/index.ts`. See architecture.md §7.1 and STORY-02.2.
 *
 * STORY-02.2 scope: register the IPC handler skeleton for the LYRICUE channel and stand
 * up the SettingsStore / IdentityStore / LibraryConfigStore so the renderer can read them.
 * Real handlers (sidecar control, library, learn-song, etc.) land in EP-04 / EP-05 / EP-13.
 */

import { ipcMain, app } from "electron"
import { LYRICUE } from "@lyricue/core/types"
import {
    IdentityStore,
    LibraryConfigStore,
    SettingsStore,
    resolveLyriCuePaths
} from "@lyricue/core/settings"

let initialised = false

export async function initLyriCueMain(): Promise<void> {
    if (initialised) return
    initialised = true

    const paths = resolveLyriCuePaths(app.getPath("userData"))
    const settings = new SettingsStore(paths)
    const identity = new IdentityStore(paths)
    const libraryConfig = new LibraryConfigStore(paths)

    // Load all three so subsequent IPC reads return real data, not defaults.
    await Promise.all([settings.load(), identity.load(), libraryConfig.load()])

    // Register the LYRICUE channel listener. Sub-channel routing (settings, library,
    // sidecar, etc.) is filled in by later epics.
    ipcMain.on(LYRICUE, (event, msg) => {
        const channel = (msg as { channel?: string })?.channel ?? ""
        console.info(`[lyricue:main] LYRICUE channel received "${channel}" — no handler in STORY-02.2`)
        // Echo back a placeholder reply so the renderer can confirm the channel is wired up.
        event.reply(LYRICUE, { channel, data: { ok: true, stub: true } })
    })

    console.info("[lyricue:main] LyriCue main-process initialised in fork mode.")
}
