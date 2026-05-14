/**
 * LyriCue renderer-process init for fork mode.
 *
 * Called by FreeShow's frontend bootstrap via the patch in
 * `apps/fork/freeshow/src/frontend/main.ts`. See architecture.md §7.1.
 *
 * Responsibilities:
 *   - Install `window.__lyricue__` namespace with mount helpers FreeShow's templates
 *     can call to hand off DOM rendering to LyriCue components (e.g., the Settings tab).
 *   - Register the shortcut handler so LyriCue's sync engine intercepts keys when active
 *     (the hook is the `setLyricueSyncShortcutHandler` function added to FreeShow's
 *     `src/frontend/utils/shortcuts.ts`).
 *
 * STORY-02.2 scope is the SettingsTab mount + a stub shortcut handler that's a no-op
 * (returns false for every key). EP-09 STORY-09.5 / EP-10 STORY-10.3 wire the real
 * sync-engine handler.
 */

import { SettingsTab } from "@lyricue/ui"
import {
    IdentityStore,
    LibraryConfigStore,
    SettingsStore,
    resolveLyriCuePaths
} from "@lyricue/core/settings"

/** Stores held by the renderer for the lifetime of the app. Lazy because settings are async. */
interface LyriCueRendererState {
    settings: SettingsStore | null
    identity: IdentityStore | null
    libraryConfig: LibraryConfigStore | null
}

const state: LyriCueRendererState = {
    settings: null,
    identity: null,
    libraryConfig: null
}

let initialised = false

export async function initLyriCueFrontend(): Promise<void> {
    if (initialised) return
    initialised = true

    // In fork mode the renderer doesn't have `app.getPath()`, but Electron exposes userData
    // via the legacy preload bridge that FreeShow uses. For STORY-02.2 we fall back to a
    // best-effort path; the real wiring uses an IPC fetch from main.
    // For now we use the same path the main process would resolve.
    const userDataDir = await fetchUserDataDir()
    const paths = resolveLyriCuePaths(userDataDir)

    state.settings = new SettingsStore(paths)
    state.identity = new IdentityStore(paths)
    state.libraryConfig = new LibraryConfigStore(paths)
    await Promise.all([
        state.settings.load(),
        state.identity.load(),
        state.libraryConfig.load()
    ])

    ;(window as unknown as { __lyricue__?: unknown }).__lyricue__ = {
        mountSettingsTab(node: HTMLElement) {
            if (!state.settings || !state.identity || !state.libraryConfig) {
                node.textContent = "LyriCue not ready"
                return () => undefined
            }
            const component = new SettingsTab({
                target: node,
                props: {
                    settingsStore: state.settings,
                    identityStore: state.identity,
                    libraryConfigStore: state.libraryConfig
                }
            })
            return () => component.$destroy()
        }
    }

    console.info("[lyricue:frontend] LyriCue renderer initialised in fork mode.")
}

/**
 * Bridge to the main process for the userData directory. STORY-02.2 stub: we hard-code
 * `~/.lyricue-fork-dev` so the renderer-side stores have *somewhere* to land during the
 * walking-skeleton demo. EP-04 STORY-04.3 replaces this with a real IPC call once the
 * main-process IPC bridge is established.
 */
async function fetchUserDataDir(): Promise<string> {
    // The renderer doesn't have direct filesystem access; in a real Electron setup we'd
    // ask the main process. For STORY-02.2 stub we fall back to a constant.
    return "/tmp/lyricue-fork-dev"
}
