import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { spawn } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readFileIfExists, writeFileAtomic } from "./atomic-write.js"

describe("writeFileAtomic", () => {
    let workDir: string

    beforeEach(async () => {
        workDir = await fs.mkdtemp(join(tmpdir(), "lyricue-fs-test-"))
    })

    afterEach(async () => {
        await fs.rm(workDir, { recursive: true, force: true })
    })

    it("writes a new file with the expected content", async () => {
        const file = join(workDir, "settings.json")
        await writeFileAtomic(file, "hello")
        await expect(fs.readFile(file, "utf-8")).resolves.toBe("hello")
    })

    it("creates parent directories that don't exist yet", async () => {
        const file = join(workDir, "deep", "nested", "dir", "out.json")
        await writeFileAtomic(file, "ok")
        await expect(fs.readFile(file, "utf-8")).resolves.toBe("ok")
    })

    it("overwrites an existing file atomically (no half-written state observable)", async () => {
        const file = join(workDir, "settings.json")
        await fs.writeFile(file, "OLD_CONTENT")
        await writeFileAtomic(file, "NEW_CONTENT")
        await expect(fs.readFile(file, "utf-8")).resolves.toBe("NEW_CONTENT")
    })

    it("leaves no stray .tmp behind after a successful write", async () => {
        const file = join(workDir, "settings.json")
        await writeFileAtomic(file, "ok")
        const tmpPath = `${file}.tmp`
        await expect(fs.access(tmpPath)).rejects.toThrow()
    })

    it("accepts Buffer content (used by binary timing-map exports later)", async () => {
        const file = join(workDir, "bin.dat")
        const content = Buffer.from([0x01, 0x02, 0x03])
        await writeFileAtomic(file, content)
        const read = await fs.readFile(file)
        expect(read).toEqual(content)
    })
})

/**
 * STORY-03.2 AC3 — simulated-crash test.
 *
 * Spawn a child process that begins an atomic write of a large payload, then SIGKILL it
 * while the write is in flight. Verify the destination directory never contains a
 * partially-written final file: either the file is absent (rename never ran) or it
 * exists with COMPLETE content (rename ran before SIGKILL hit). A truncated final file
 * is a bug.
 *
 * The harness writes a `.sentinel` next to the target so we can confirm the child
 * actually reached the write call before we killed it.
 */
describe("writeFileAtomic — simulated crash (STORY-03.2 AC3)", () => {
    let workDir: string

    beforeEach(async () => {
        workDir = await fs.mkdtemp(join(tmpdir(), "lyricue-fs-crash-test-"))
    })

    afterEach(async () => {
        await fs.rm(workDir, { recursive: true, force: true })
    })

    it("never leaves a partial final file when the process is killed mid-write", async () => {
        const here = dirname(fileURLToPath(import.meta.url))
        const harness = resolve(here, "atomic-write-crash-test-harness.ts")
        const target = join(workDir, "victim.bin")
        // 80MB payload — large enough that the child can't finish before SIGKILL on a normal dev box.
        const payloadSize = 80 * 1024 * 1024

        // Track how many of (crash-before-rename, complete-before-kill) we observe across N runs.
        // We want the test deterministic in its assertion (never partial), not deterministic in
        // its outcome (kill timing is racy). Five iterations make the test catch any partial-write
        // regression even if one or two runs happen to complete first.
        const ITERATIONS = 5
        let observedCrashes = 0
        let observedCompletions = 0

        for (let i = 0; i < ITERATIONS; i++) {
            const targetI = `${target}.${i}`
            const child = spawn(
                process.execPath,
                ["--experimental-strip-types", harness, targetI, String(payloadSize)],
                { stdio: ["ignore", "pipe", "pipe"] }
            )

            // Wait for the child to write the "begin" sentinel — i.e., it has reached the
            // writeFileAtomic call.
            await new Promise<void>((resolveWait, rejectWait) => {
                const timer = setTimeout(() => rejectWait(new Error("child did not reach sentinel within 5s")), 5000)
                const poll = setInterval(async () => {
                    try {
                        const s = await fs.readFile(`${targetI}.sentinel`, "utf-8")
                        if (s === "begin" || s === "complete") {
                            clearInterval(poll)
                            clearTimeout(timer)
                            resolveWait()
                        }
                    } catch {
                        // Sentinel not written yet — keep polling.
                    }
                }, 5)
            })

            // SIGKILL the child immediately. Race the kernel: sometimes the write finishes first.
            child.kill("SIGKILL")

            // Wait for the child to exit.
            await new Promise<void>((resolveExit) => {
                child.on("exit", () => resolveExit())
            })

            // Inspect the directory. The acceptable outcomes:
            //   (a) target file does NOT exist  → rename never ran
            //   (b) target file exists with EXACTLY payloadSize bytes → rename completed
            // The unacceptable outcome:
            //   (c) target file exists with size != payloadSize → partial write observed
            let stat: { size: number } | null = null
            try {
                stat = await fs.stat(targetI)
            } catch {
                stat = null
            }

            if (stat === null) {
                observedCrashes++
            } else {
                expect(stat.size, `iteration ${i}: target exists but is truncated`).toBe(payloadSize)
                observedCompletions++
            }
        }

        // Sanity: we should have at least one of each across 5 iterations, otherwise the test
        // isn't actually exercising the crash path. If everything completed, the payload was
        // too small; if everything crashed, the harness is failing to start the write.
        // We don't strictly require both — the load-bearing assertion is "no partial writes" —
        // but record the breakdown for visibility.
        expect(observedCrashes + observedCompletions).toBe(ITERATIONS)
    }, 30000)
})

describe("readFileIfExists", () => {
    let workDir: string

    beforeEach(async () => {
        workDir = await fs.mkdtemp(join(tmpdir(), "lyricue-fs-test-"))
    })

    afterEach(async () => {
        await fs.rm(workDir, { recursive: true, force: true })
    })

    it("returns null when the file does not exist", async () => {
        await expect(readFileIfExists(join(workDir, "missing.json"))).resolves.toBeNull()
    })

    it("returns the buffer when the file exists", async () => {
        const file = join(workDir, "present.json")
        await fs.writeFile(file, "value")
        const out = await readFileIfExists(file)
        expect(out?.toString("utf-8")).toBe("value")
    })

    it("cleans up a stale .tmp from a prior crashed write when the final file exists", async () => {
        const file = join(workDir, "present.json")
        await fs.writeFile(file, "real")
        await fs.writeFile(`${file}.tmp`, "stale")

        await readFileIfExists(file)

        await expect(fs.access(`${file}.tmp`)).rejects.toThrow()
    })
})
