/**
 * Integration test: spawn the REAL Python sidecar and exercise it end-to-end.
 *
 * Per EP-04 STORY-04.3 — the TS controller and the Python sidecar must agree on the wire
 * protocol. Unit tests verify the controller against a mock subprocess; this test verifies
 * the controller against the actual subprocess, with the actual JSON-RPC server, on the
 * actual stdin/stdout pipe.
 *
 * Requires the python-sidecar venv to be populated. The test resolves the venv's Python
 * via the LYRICUE_PYTHON env var (set by the test setup below). If the venv isn't there,
 * the test is skipped with a clear message rather than failing — keeps CI flexible.
 */

import { describe, it, expect } from "vitest"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { validateTimingMap } from "../types/timing-map-schema.js"
import { SidecarController } from "./sidecar-controller.js"
import {
    nodePythonResolver,
    nodeSidecarSpawner
} from "./node-sidecar-spawner.js"

const here = dirname(fileURLToPath(import.meta.url))
// packages/core/src/sidecar → repo root is 4 levels up.
const repoRoot = join(here, "..", "..", "..", "..")
const sidecarRoot = join(repoRoot, "python-sidecar")
const venvPython = join(sidecarRoot, ".venv", "bin", "python")

const haveVenv = existsSync(venvPython)

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
        if (predicate()) return
        await new Promise((r) => setTimeout(r, 25))
    }
}

describe.skipIf(!haveVenv)("SidecarController ↔ Python sidecar (integration)", () => {
    it("spawns, receives ready, handles ping, shuts down cleanly", async () => {
        const controller = new SidecarController({
            spawn: nodeSidecarSpawner,
            resolvePython: async () => ({ pythonPath: venvPython, version: "3.14.0" }),
            pythonOverride: venvPython,
            readyTimeoutMs: 15_000,
            cwd: sidecarRoot
        })

        await controller.ensureRunning()
        expect(controller.statusSnapshot()).toBe("running")

        const pingResult = await controller.request<{ pong: true; echo: { trace: string } }>(
            "ping",
            { trace: "integration-test" }
        )
        expect(pingResult.pong).toBe(true)
        expect(pingResult.echo.trace).toBe("integration-test")

        await controller.shutdown()
        // Wait up to 5 seconds for the subprocess to fully exit. Python's stdin EOF
        // propagation can take a few hundred ms after closeStdin() in some kernels.
        await waitFor(() => controller.statusSnapshot() !== "running", 5000)
        expect(["idle", "crashed"]).toContain(controller.statusSnapshot())
    }, 30_000)

    it("surfaces unknown methods as -32601 SidecarRpcError", async () => {
        const controller = new SidecarController({
            spawn: nodeSidecarSpawner,
            resolvePython: async () => ({ pythonPath: venvPython, version: "3.14.0" }),
            pythonOverride: venvPython,
            readyTimeoutMs: 15_000,
            cwd: sidecarRoot
        })
        await controller.ensureRunning()
        try {
            await controller.request("never_registered", {})
            throw new Error("should have thrown")
        } catch (err) {
            expect((err as Error).message).toMatch(/never_registered/)
        }
        await controller.shutdown()
        await waitFor(() => controller.statusSnapshot() !== "running", 5000)
    }, 30_000)

    it("learn_song returns a TimingMap accepted by the TS validator", async () => {
        const tmp = mkdtempSync(join(tmpdir(), "lyricue-learn-song-"))
        const audioPath = join(tmp, "tone.wav")
        writeWavFixture(audioPath)

        const controller = new SidecarController({
            spawn: nodeSidecarSpawner,
            resolvePython: async () => ({ pythonPath: venvPython, version: "3.14.0" }),
            pythonOverride: venvPython,
            readyTimeoutMs: 15_000,
            cwd: sidecarRoot
        })

        try {
            await controller.ensureRunning()
            const result = await controller.request<{ timingMap: unknown; stage: string }>(
                "learn_song",
                {
                    jobId: "integration-learn",
                    showId: "integration-show",
                    audioPath,
                    lyrics: [
                        {
                            id: "verse-1",
                            type: "verse",
                            label: "Verse 1",
                            text: "Amazing grace\nHow sweet the sound",
                            lines: ["Amazing grace", "How sweet the sound"]
                        }
                    ],
                    options: { language: "en" }
                },
                { timeoutMs: 60_000 }
            )
            expect(result.stage).toBe("timing_map_ready")
            const parsed = validateTimingMap(result.timingMap)
            expect(parsed.ok).toBe(true)
            if (parsed.ok) {
                expect(parsed.value.showId).toBe("integration-show")
                expect(parsed.value.sections[0]?.words.map((word) => word.text)).toEqual([
                    "Amazing",
                    "grace",
                    "How",
                    "sweet",
                    "the",
                    "sound"
                ])
            }
        } finally {
            await controller.shutdown().catch(() => undefined)
            await waitFor(() => controller.statusSnapshot() !== "running", 5000).catch(() => undefined)
            rmSync(tmp, { recursive: true, force: true })
        }
    }, 90_000)

    it("nodePythonResolver finds the venv Python ≥3.10", async () => {
        const resolved = await nodePythonResolver(venvPython)
        expect(resolved.pythonPath).toBe(venvPython)
        const parts = resolved.version.split(".").map(Number)
        expect(parts[0]!).toBeGreaterThanOrEqual(3)
        if (parts[0] === 3) expect(parts[1]!).toBeGreaterThanOrEqual(10)
    })
})

function writeWavFixture(path: string): void {
    const sampleRate = 44_100
    const durationSeconds = 1
    const sampleCount = sampleRate * durationSeconds
    const dataSize = sampleCount * 2
    const buffer = Buffer.alloc(44 + dataSize)
    buffer.write("RIFF", 0)
    buffer.writeUInt32LE(36 + dataSize, 4)
    buffer.write("WAVE", 8)
    buffer.write("fmt ", 12)
    buffer.writeUInt32LE(16, 16)
    buffer.writeUInt16LE(1, 20)
    buffer.writeUInt16LE(1, 22)
    buffer.writeUInt32LE(sampleRate, 24)
    buffer.writeUInt32LE(sampleRate * 2, 28)
    buffer.writeUInt16LE(2, 32)
    buffer.writeUInt16LE(16, 34)
    buffer.write("data", 36)
    buffer.writeUInt32LE(dataSize, 40)
    for (let i = 0; i < sampleCount; i++) {
        const value = Math.round(12_000 * Math.sin(2 * Math.PI * 440 * (i / sampleRate)))
        buffer.writeInt16LE(value, 44 + i * 2)
    }
    writeFileSync(path, buffer)
}
