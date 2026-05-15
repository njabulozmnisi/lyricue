/**
 * Production SidecarSpawner + PythonResolver — wraps `child_process.spawn` and
 * `python --version` so the SidecarController can run against a real subprocess.
 *
 * Lives in @lyricue/core (not apps/) because it has no Electron dependency: pure Node
 * stdlib only. Both fork-mode (FreeShow's electron main) and sister-mode (LyriCue's own
 * electron main) wire it identically.
 *
 * Per EP-04 STORY-04.3.
 */

import { spawn as childSpawn, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"
import {
    SidecarLifecycleCode,
    SidecarLifecycleError
} from "./sidecar-protocol.js"
import type { PythonResolver, SidecarProcess, SidecarSpawner } from "./sidecar-controller.js"

/**
 * Wrap a Node ChildProcess in the minimal SidecarProcess interface the controller expects.
 * The readline conversion of stdout/stderr to per-line events isolates the controller
 * from buffering concerns.
 */
function wrap(child: ChildProcess): SidecarProcess {
    if (!child.stdin || !child.stdout || !child.stderr) {
        throw new Error("Child process must have stdio piped (stdin/stdout/stderr)")
    }
    const stdoutLines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    const stderrLines = createInterface({ input: child.stderr, crlfDelay: Infinity })

    return {
        get pid() {
            return child.pid
        },
        write(data: string): boolean {
            // child.stdin.write returns false on backpressure; the controller's frame size
            // is tiny (always <1 KB) so we don't drain — every frame fits in the pipe.
            return child.stdin!.write(data)
        },
        closeStdin(): void {
            child.stdin!.end()
        },
        kill(signal?: NodeJS.Signals): boolean {
            return child.kill(signal)
        },
        onStdoutLine(handler) {
            stdoutLines.on("line", handler)
            return () => stdoutLines.off("line", handler)
        },
        onStderrLine(handler) {
            stderrLines.on("line", handler)
            return () => stderrLines.off("line", handler)
        },
        onExit(handler) {
            const onExit = (code: number | null, signal: NodeJS.Signals | null) => handler(code, signal)
            child.on("exit", onExit)
            return () => child.off("exit", onExit)
        }
    }
}

/** Real spawner that wraps `child_process.spawn` for the sidecar subprocess. */
export const nodeSidecarSpawner: SidecarSpawner = async (opts) => {
    const spawnArgs = opts.moduleArgs
    const spawnOpts: Record<string, unknown> = {
        stdio: ["pipe", "pipe", "pipe"]
    }
    if (opts.cwd !== undefined) spawnOpts.cwd = opts.cwd
    if (opts.env !== undefined) spawnOpts.env = opts.env
    const child = childSpawn(opts.pythonPath, spawnArgs, spawnOpts as Parameters<typeof childSpawn>[2])

    // If spawn fails synchronously (ENOENT, EACCES), we get an `error` event.
    // Mirror it into a rejection so the controller surfaces it as SIDECAR_FAILED_TO_START.
    const wrapped = wrap(child)
    await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => {
            child.off("error", onError)
            reject(err)
        }
        child.once("error", onError)
        // We resolve on first spawn — `error` and `spawn` are mutually exclusive.
        // Node fires `spawn` once stdio is attached.
        child.once("spawn", () => {
            child.off("error", onError)
            resolve()
        })
    })

    return wrapped
}

/**
 * Resolve a usable Python ≥3.10 interpreter.
 *
 * Lookup chain:
 *   1. settings override (passed in as argument)
 *   2. PYTHON env var
 *   3. `python3` on PATH
 *   4. `python` on PATH
 *
 * Returns the resolved path + parsed version. Throws SidecarLifecycleError with
 * PYTHON_NOT_FOUND or PYTHON_VERSION_TOO_OLD on failure.
 */
export const nodePythonResolver: PythonResolver = async (settingsOverride: string | null) => {
    const candidates: string[] = []
    if (settingsOverride) candidates.push(settingsOverride)
    if (process.env.PYTHON) candidates.push(process.env.PYTHON)
    candidates.push("python3", "python")

    let lastError: Error | null = null
    for (const candidate of candidates) {
        try {
            const version = await probeVersion(candidate)
            if (versionAtLeast(version, [3, 10])) {
                return { pythonPath: candidate, version }
            }
            lastError = new SidecarLifecycleError(
                SidecarLifecycleCode.PYTHON_VERSION_TOO_OLD,
                `Python at '${candidate}' reports version ${version}; need ≥3.10.`
            )
        } catch (err) {
            lastError = err as Error
        }
    }

    if (lastError && lastError instanceof SidecarLifecycleError) throw lastError
    throw new SidecarLifecycleError(
        SidecarLifecycleCode.PYTHON_NOT_FOUND,
        "No usable Python interpreter found. Tried: " + candidates.join(", "),
        lastError ?? undefined
    )
}

/**
 * Run `<candidate> --version` and parse the version string.
 * Both `python --version` and `python3 --version` print "Python X.Y.Z" — on stdout
 * for modern versions, stderr for Python 2 (which we reject anyway).
 */
async function probeVersion(candidate: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const proc = childSpawn(candidate, ["--version"], { stdio: ["ignore", "pipe", "pipe"] })
        let stdout = ""
        let stderr = ""
        proc.stdout?.on("data", (chunk) => (stdout += chunk.toString()))
        proc.stderr?.on("data", (chunk) => (stderr += chunk.toString()))
        proc.on("error", (err) => reject(err))
        proc.on("exit", (code) => {
            if (code !== 0 && !stdout && !stderr) {
                reject(new Error(`'${candidate} --version' exited with code ${code}`))
                return
            }
            const text = stdout || stderr
            const match = text.match(/Python (\d+)\.(\d+)\.(\d+)/)
            if (!match) {
                reject(new Error(`Could not parse Python version from '${text.trim()}'`))
                return
            }
            resolve(`${match[1]}.${match[2]}.${match[3]}`)
        })
    })
}

function versionAtLeast(versionStr: string, [major, minor]: [number, number]): boolean {
    const parts = versionStr.split(".").map((x) => Number.parseInt(x, 10))
    if (parts[0]! > major) return true
    if (parts[0]! < major) return false
    return (parts[1] ?? 0) >= minor
}
