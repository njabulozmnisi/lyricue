/**
 * Sister-mode walking-skeleton demo entry.
 *
 * Per EP-02 STORY-02.4 AC1+AC3+AC4.
 *
 * Runs the LyriCue sister-mode Electron app with LC_DEMO_MODE=1, which triggers
 * `apps/sister/src/main.ts` to drive its OwnWindowOutputAdapter with the
 * DemoSyncEngine (from @lyricue/core/output/test-utils) walking DEMO_TIMING_MAP.
 *
 * Same map + same engine are used by the fork-mode demo (apps/fork/scripts/demo.ts),
 * so by construction the two modes receive identical SyncFrame streams — which is
 * STORY-02.4 AC4's "Both demos show identical visual output" claim.
 *
 * Invoke via `npm run demo:walking-skeleton:sister` from the monorepo root.
 *
 * Quit by closing the karaoke window (Linux/Windows) or pressing Cmd+Q (macOS).
 */

import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
// scripts/demo.ts → ../dist-electron/main.js
const MAIN_ENTRY = resolve(here, "..", "dist-electron", "main.js")
// scripts/demo.ts → ../../../node_modules/.bin/electron
const ELECTRON_BIN = resolve(here, "..", "..", "..", "node_modules", ".bin", "electron")

console.info("[lyricue:demo:sister] launching sister-mode Electron app in demo mode…")
console.info(`[lyricue:demo:sister]   electron: ${ELECTRON_BIN}`)
console.info(`[lyricue:demo:sister]   main:     ${MAIN_ENTRY}`)
console.info("[lyricue:demo:sister]   close the karaoke window to quit (Cmd+Q on macOS)")

const child = spawn(ELECTRON_BIN, [MAIN_ENTRY], {
    stdio: "inherit",
    env: {
        ...process.env,
        LC_DEPLOYMENT_MODE: "sister",
        LC_DEMO_MODE: "1"
    }
})

child.on("exit", (code, signal) => {
    if (signal) {
        console.info(`[lyricue:demo:sister] electron exited via signal ${signal}`)
    } else {
        console.info(`[lyricue:demo:sister] electron exited with code ${code ?? "null"}`)
    }
    process.exit(code ?? 0)
})

// Forward SIGINT (Ctrl+C) to the child so the user can stop cleanly from the terminal.
process.on("SIGINT", () => {
    if (!child.killed) child.kill("SIGINT")
})
