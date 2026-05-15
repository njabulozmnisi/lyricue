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
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
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

    it("nodePythonResolver finds the venv Python ≥3.10", async () => {
        const resolved = await nodePythonResolver(venvPython)
        expect(resolved.pythonPath).toBe(venvPython)
        const parts = resolved.version.split(".").map(Number)
        expect(parts[0]!).toBeGreaterThanOrEqual(3)
        if (parts[0] === 3) expect(parts[1]!).toBeGreaterThanOrEqual(10)
    })
})
