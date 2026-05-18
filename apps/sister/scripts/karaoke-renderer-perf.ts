import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, "..")
const mainEntry = resolve(appRoot, "dist-electron", "main.js")
const electronBin = resolve(appRoot, "..", "..", "node_modules", ".bin", "electron")

const child = spawn(electronBin, [mainEntry], {
    cwd: resolve(appRoot, "..", ".."),
    env: {
        ...process.env,
        LC_DEPLOYMENT_MODE: "sister",
        LC_RENDERER_PERF_MODE: "1",
        LC_VERBOSE: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
})

let output = ""
const timeout = setTimeout(() => {
    process.stderr.write("[renderer-perf] timed out waiting for Electron summary\n")
    child.kill("SIGTERM")
}, 45_000)

child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString()
    output += text
    process.stdout.write(text)
})

child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString()
    output += text
    process.stderr.write(text)
})

child.on("error", (err) => {
    clearTimeout(timeout)
    process.stderr.write(`[renderer-perf] failed to launch Electron: ${err.message}\n`)
    process.exit(1)
})

child.on("exit", (code, signal) => {
    clearTimeout(timeout)
    const match = output.match(/renderer-perf frames=(\d+) delivered=(\d+) dropped=(\d+) elapsedMs=([0-9.]+) fps=([0-9.]+) threshold=(\d+) result=(pass|fail)/)
    if (!match) {
        process.stderr.write(`[renderer-perf] missing summary line; exit=${code ?? "null"} signal=${signal ?? "null"}\n`)
        process.exit(1)
    }

    const frames = Number(match[1])
    const delivered = Number(match[2])
    const dropped = Number(match[3])
    const fps = Number(match[5])
    const threshold = Number(match[6])
    const result = match[7]

    if (code !== 0 || result !== "pass" || delivered < frames || dropped !== 0 || fps < threshold) {
        process.stderr.write(`[renderer-perf] failed: frames=${frames} delivered=${delivered} dropped=${dropped} fps=${fps} threshold=${threshold} exit=${code ?? "null"}\n`)
        process.exit(1)
    }

    process.stdout.write(`[renderer-perf] passed: frames=${frames} delivered=${delivered} dropped=${dropped} fps=${fps}\n`)
})
