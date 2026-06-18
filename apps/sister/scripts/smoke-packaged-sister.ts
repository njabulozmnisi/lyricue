import { spawn } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parsePackagedSisterSmokeLog } from "../src/packaged-smoke-summary.ts"

interface Args {
    appExecutable: string
    outputDir: string
    timeoutMs: number
}

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, "..")
const repoRoot = resolve(appRoot, "..", "..")

function defaultAppExecutable(): string {
    if (process.platform === "darwin") {
        return resolve(appRoot, "release", `mac-${process.arch}`, "LyriCue.app", "Contents", "MacOS", "LyriCue")
    }
    if (process.platform === "win32") {
        return resolve(appRoot, "release", `win-${process.arch}-unpacked`, "LyriCue.exe")
    }
    return resolve(appRoot, "release", `linux-${process.arch}-unpacked`, "lyricue")
}

function parseArgs(argv: string[]): Args {
    let appExecutable = defaultAppExecutable()
    let outputDir = resolve(repoRoot, "docs", "qa-reports", "evidence", `gate-d-packaged-sister-smoke-${new Date().toISOString().slice(0, 10)}`)
    let timeoutMs = 300_000

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i]
        const next = argv[i + 1]
        if (arg === "--app-executable" && next) {
            appExecutable = resolve(next)
            i += 1
        } else if (arg === "--output-dir" && next) {
            outputDir = resolve(next)
            i += 1
        } else if (arg === "--timeout-ms" && next) {
            timeoutMs = Number(next)
            i += 1
        } else {
            throw new Error(`Unknown or incomplete argument: ${arg}`)
        }
    }

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error(`Invalid --timeout-ms value: ${timeoutMs}`)
    }

    return { appExecutable, outputDir, timeoutMs }
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2))
    if (!existsSync(args.appExecutable)) {
        throw new Error(`Packaged app executable not found: ${args.appExecutable}`)
    }

    mkdirSync(args.outputDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const logPath = resolve(args.outputDir, `packaged-sister-smoke-${stamp}.log`)
    const summaryPath = resolve(args.outputDir, `packaged-sister-smoke-${stamp}.json`)
    const screenshotDir = resolve(args.outputDir, "screenshots")

    process.stdout.write(`[packaged-sister-smoke] app=${args.appExecutable}\n`)
    process.stdout.write(`[packaged-sister-smoke] log=${logPath}\n`)
    process.stdout.write(`[packaged-sister-smoke] screenshots=${screenshotDir}\n`)

    let log = ""
    let timedOut = false
    const child = spawn(args.appExecutable, [], {
        cwd: repoRoot,
        env: {
            ...process.env,
            LC_DEPLOYMENT_MODE: "sister",
            LC_E2E_MODE: "1",
            LC_VERBOSE: "1",
            LC_SMOKE_TEST: "1",
            LC_CAPTURE_EVIDENCE: "1",
            LC_CAPTURE_EVIDENCE_DIR: screenshotDir
        },
        stdio: ["ignore", "pipe", "pipe"]
    })

    const timeout = setTimeout(() => {
        timedOut = true
        log += `\n[packaged-sister-smoke] timed out after ${args.timeoutMs}ms\n`
        child.kill("SIGTERM")
    }, args.timeoutMs)

    child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString()
        log += text
        process.stdout.write(text)
    })

    child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString()
        log += text
        process.stderr.write(text)
    })

    child.on("error", (err) => {
        log += `\n[packaged-sister-smoke] failed to launch: ${err.message}\n`
    })

    const exitInfo = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
        child.on("exit", (code, signal) => resolveExit({ code, signal }))
    })
    clearTimeout(timeout)

    const parsed = parsePackagedSisterSmokeLog(log)
    const status = !timedOut && exitInfo.code === 0 && parsed.status === "pass" ? "pass" : "fail"
    const summary = {
        ...parsed,
        status,
        appExecutable: args.appExecutable,
        logPath,
        screenshotDir,
        exitCode: exitInfo.code,
        signal: exitInfo.signal,
        timedOut,
        timeoutMs: args.timeoutMs
    }

    writeFileSync(logPath, log)
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
    process.stdout.write(`[packaged-sister-smoke] summary=${summaryPath}\n`)
    process.stdout.write(`[packaged-sister-smoke] status=${status}\n`)

    if (status !== "pass") process.exit(1)
}

main().catch((err) => {
    process.stderr.write(`[packaged-sister-smoke] ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
})
