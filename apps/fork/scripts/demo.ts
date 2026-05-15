/**
 * Fork-mode walking-skeleton demo entry.
 *
 * Per EP-02 STORY-02.4 AC2+AC4.
 *
 * Launches the FreeShow fork (with the LyriCue extension surface patches applied via
 * `apps/fork/freeshow/lyricue-integration` branch) and instructs the LyriCue main
 * process to push frames from the DemoSyncEngine + DEMO_TIMING_MAP through
 * ForkOutputAdapter. The same map + same engine are used by the sister-mode demo —
 * proving the OutputAdapter abstraction (STORY-02.4 AC4).
 *
 * Runtime prerequisite (documented limitation):
 *   FreeShow's native deps (NDI SDK, Blackmagic SDK, libltc-wrapper) must be installed
 *   on the developer's machine. These are external vendor SDKs the LyriCue build does
 *   not (and cannot) provide. The standard FreeShow developer setup at
 *   https://freeshow.app/docs covers this. If those deps are not installed, this
 *   demo will fail to launch with native-module errors from `grandiose` / `macadam` /
 *   `libltc-wrapper`. Sister-mode demo (apps/sister/scripts/demo.ts) has NO such
 *   prerequisite — it's the recommended path for architecture verification when
 *   FreeShow native SDKs are not installed.
 *
 * Invoke via `npm run demo:walking-skeleton:fork` from the monorepo root.
 *
 * Quit by closing the FreeShow window (Linux/Windows) or pressing Cmd+Q (macOS).
 */

import { existsSync } from "node:fs"
import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const FORK_ROOT = resolve(here, "..")
const FREESHOW_ROOT = resolve(FORK_ROOT, "freeshow")
const FREESHOW_PKG = resolve(FREESHOW_ROOT, "package.json")

function fail(message: string): never {
    console.error(`[lyricue:demo:fork] ${message}`)
    process.exit(1)
}

if (!existsSync(FREESHOW_PKG)) {
    fail(
        `FreeShow submodule not initialised at ${FREESHOW_ROOT}.\n` +
            `  Run: git submodule update --init --recursive apps/fork/freeshow`
    )
}

// Heuristic check for native deps — FreeShow's `grandiose` is the first one to break
// without the NDI SDK. We don't fail hard here because the user may have it installed
// system-wide via a different path; but we surface a clear warning before launching.
const GRANDIOSE_NATIVE = resolve(FREESHOW_ROOT, "node_modules", "grandiose", "build", "Release", "grandiose.node")
if (!existsSync(GRANDIOSE_NATIVE)) {
    console.warn("[lyricue:demo:fork] WARNING: FreeShow native deps may not be installed.")
    console.warn(`[lyricue:demo:fork]   expected: ${GRANDIOSE_NATIVE}`)
    console.warn("[lyricue:demo:fork]   if FreeShow fails to launch with native-module errors,")
    console.warn("[lyricue:demo:fork]   follow FreeShow's developer setup at https://freeshow.app/docs")
    console.warn("[lyricue:demo:fork]   or use `npm run demo:walking-skeleton:sister` instead.")
}

console.info("[lyricue:demo:fork] launching FreeShow fork in LyriCue demo mode…")
console.info("[lyricue:demo:fork]   close the FreeShow window to quit (Cmd+Q on macOS)")

// FreeShow's start script handles its own electron-builder/electron-forge flow.
// We launch it via npm with the LyriCue demo flag in env; the fork patches in
// FreeShow's electron/index.ts pick up the flag when calling `initLyriCueMain()`.
const child = spawn("npm", ["start"], {
    cwd: FREESHOW_ROOT,
    stdio: "inherit",
    env: {
        ...process.env,
        LC_DEPLOYMENT_MODE: "fork",
        LC_DEMO_MODE: "1"
    }
})

child.on("exit", (code, signal) => {
    if (signal) {
        console.info(`[lyricue:demo:fork] FreeShow exited via signal ${signal}`)
    } else {
        console.info(`[lyricue:demo:fork] FreeShow exited with code ${code ?? "null"}`)
    }
    process.exit(code ?? 0)
})

process.on("SIGINT", () => {
    if (!child.killed) child.kill("SIGINT")
})
