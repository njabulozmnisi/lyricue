// LyriCue fork-mode Electron main entry — STUB.
//
// In fork mode, FreeShow's own electron main is the actual app entry; this file is the
// LyriCue-side companion entry that gets compiled but not invoked directly by Electron.
// FreeShow's main process invokes our exports via the dynamic imports patched into
// apps/fork/freeshow/src/electron/index.ts (`initLyriCueMain`) and
// apps/fork/freeshow/src/frontend/main.ts (`initLyriCueFrontend`).
//
// Why we keep this file: the apps/fork workspace's package.json declares "main": "./dist-electron/electron-main.js",
// which makes the workspace structurally valid even though the entry isn't directly used.
// EP-04 and later will use this file to host LyriCue's main-process bootstrap when it grows
// beyond what `initLyriCueMain` does standalone.

import { DEPLOYMENT_MODE } from "@lyricue/core/types"

if (DEPLOYMENT_MODE !== "fork") {
    console.error(
        `[lyricue:fork] Refusing to start: LC_DEPLOYMENT_MODE is "${DEPLOYMENT_MODE}", expected "fork". ` +
            `Build with LC_DEPLOYMENT_MODE=fork, or use the sister-mode entry instead.`
    )
    process.exit(1)
}

console.info("[lyricue:fork] electron-main.ts reached. FreeShow's own electron main owns the BrowserWindow lifecycle in fork mode.")
