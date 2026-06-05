/**
 * resolveSidecarLaunch — locates how to launch the sidecar (PyInstaller binary in
 * production, `python -m lyricue_sidecar` against source in development).
 *
 * Per EP-04 STORY-04.4 and architecture.md §4.2 / §8.6.
 *
 * Lookup logic:
 *   1. NODE_ENV === "development" → source mode (python -m lyricue_sidecar against the
 *      `python-sidecar/` directory). The caller's PythonResolver picks the interpreter.
 *   2. NODE_ENV === "production" → bundled binary at
 *      `<resourcesPath>/sidecar/<platform>-<arch>/lyricue-sidecar`.
 *      Verifies the file exists. Throws SIDECAR_BINARY_MISSING otherwise.
 *
 * The caller (Electron main) provides:
 *   - `appPath`: the repo root in development, or Electron's app.getAppPath() in
 *      production for diagnostics.
 *   - `resourcesPath`: Electron's process.resourcesPath in production.
 *   - `nodeEnv`: process.env.NODE_ENV (or undefined). Anything other than "production"
 *      is treated as development.
 *
 * Why a function not a class: pure path resolution + filesystem stat. No state.
 *
 * Why we don't import `electron`: this file lives in @lyricue/core, which is
 * mode-agnostic. The Electron host injects the appPath.
 */

import { existsSync } from "node:fs"
import { join } from "node:path"
import {
    SidecarLifecycleCode,
    SidecarLifecycleError
} from "./sidecar-protocol.js"

export interface SidecarLaunchSource {
    /** `python -m lyricue_sidecar` against source in development. */
    mode: "source"
    /** The directory containing python-sidecar/. */
    sourceDir: string
}

export interface SidecarLaunchBundled {
    /** PyInstaller binary in production. */
    mode: "bundled"
    /** Absolute path to the bundled executable. */
    binaryPath: string
}

export type SidecarLaunch = SidecarLaunchSource | SidecarLaunchBundled

export interface ResolveSidecarLaunchOptions {
    /** Production: Electron's app.getAppPath(). Development: the monorepo root. */
    appPath: string
    /** Production: Electron's process.resourcesPath, where extraResources are copied. */
    resourcesPath?: string
    /** process.env.NODE_ENV (or undefined). */
    nodeEnv: string | undefined
    /** Override the auto-detected platform — used by tests. Defaults to process.platform. */
    platform?: NodeJS.Platform
    /** Override the auto-detected architecture — used by tests. Defaults to process.arch. */
    arch?: string
    /** Override the binary-exists check — used by tests. Defaults to fs.existsSync. */
    exists?: (path: string) => boolean
}

/**
 * Returns enough information to launch the sidecar. Throws SidecarLifecycleError when
 * production mode is requested but the binary is missing.
 */
export function resolveSidecarLaunch(opts: ResolveSidecarLaunchOptions): SidecarLaunch {
    const isProduction = opts.nodeEnv === "production"
    const exists = opts.exists ?? existsSync

    if (!isProduction) {
        return { mode: "source", sourceDir: join(opts.appPath, "python-sidecar") }
    }

    const platform = opts.platform ?? process.platform
    const arch = opts.arch ?? process.arch
    const platformDir = `${platformKey(platform)}-${arch}`
    const binaryName = platform === "win32" ? "lyricue-sidecar.exe" : "lyricue-sidecar"
    const resourcesPath = opts.resourcesPath ?? join(opts.appPath, "resources")
    const binaryPath = join(resourcesPath, "sidecar", platformDir, binaryName)

    if (!exists(binaryPath)) {
        throw new SidecarLifecycleError(
            SidecarLifecycleCode.SIDECAR_FAILED_TO_START,
            `Bundled sidecar binary missing at ${binaryPath}. ` +
                `This usually means the installer is corrupt — please reinstall LyriCue. ` +
                `(Platform=${platform}, arch=${arch})`
        )
    }

    return { mode: "bundled", binaryPath }
}

/**
 * Map Node's `process.platform` to the PyInstaller output directory name LyriCue uses.
 * PyInstaller's own platform naming differs slightly; we standardise via this map.
 */
function platformKey(platform: NodeJS.Platform): string {
    switch (platform) {
        case "darwin":
            return "darwin"
        case "win32":
            return "win32"
        case "linux":
            return "linux"
        default:
            // Best-effort for FreeBSD / AIX / etc. — these aren't supported targets but
            // the path resolver shouldn't crash if the developer runs on one.
            return platform
    }
}
