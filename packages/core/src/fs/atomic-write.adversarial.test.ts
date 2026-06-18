/**
 * Adversarial atomic-write tests.
 *
 * The existing suite covers happy paths + crash-mid-write (SIGKILL). This suite attacks
 * failure modes that occur AFTER the write begins but BEFORE the rename completes:
 *
 *   1. Concurrent writes to the same path — last-write-wins, not interleave-corruption.
 *   2. Orphaned tempfile from a prior failed-but-not-killed write — must not block
 *      the next write.
 *   3. fs.rename failure path — must propagate cleanly so callers can react.
 *   4. Very large content — fsync must complete, not hang.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readFileIfExists, writeFileAtomic } from "./atomic-write.js"

describe("writeFileAtomic — concurrent writes to the same path", () => {
    let workDir: string
    beforeEach(async () => {
        workDir = await fs.mkdtemp(join(tmpdir(), "lyricue-fs-concurrent-"))
    })
    afterEach(async () => {
        await fs.rm(workDir, { recursive: true, force: true })
    })

    it("last write wins; no interleaved/corrupted content reaches the final path", async () => {
        const file = join(workDir, "settings.json")
        // Fire 20 concurrent writes with distinct content; the final content must be
        // EXACTLY one of the written payloads — never a mixture.
        const writes = Array.from({ length: 20 }, (_, i) =>
            writeFileAtomic(file, `content-${i}`.padEnd(1024, ".")) // pad so atomic-write actually buffers
        )
        await Promise.all(writes)
        const final = await fs.readFile(file, "utf-8")
        // Verify the final content is ONE of the writes' content, not a partial mix.
        const candidates = Array.from({ length: 20 }, (_, i) => `content-${i}`.padEnd(1024, "."))
        expect(candidates).toContain(final)
    })

    it("leaves no stray .tmp behind after concurrent writes", async () => {
        const file = join(workDir, "settings.json")
        await Promise.all(Array.from({ length: 10 }, (_, i) => writeFileAtomic(file, `c${i}`)))
        const entries = await fs.readdir(workDir)
        const tmpEntries = entries.filter((e) => e.endsWith(".tmp"))
        expect(tmpEntries, `unexpected .tmp leftovers: ${tmpEntries.join(", ")}`).toHaveLength(0)
    })
})

describe("writeFileAtomic — orphaned tempfile from prior failed write", () => {
    let workDir: string
    beforeEach(async () => {
        workDir = await fs.mkdtemp(join(tmpdir(), "lyricue-fs-orphan-"))
    })
    afterEach(async () => {
        await fs.rm(workDir, { recursive: true, force: true })
    })

    it("writes succeed even when a prior crash left an orphaned tempfile next to the target", async () => {
        const file = join(workDir, "settings.json")
        const stalePath = `${file}.tmp`
        // Simulate prior crash: orphaned fixed-suffix tempfile exists; final file absent.
        await fs.writeFile(stalePath, "STALE_FROM_PRIOR_CRASH")
        // New write must succeed regardless of the orphan (it uses its own unique tempfile).
        await writeFileAtomic(file, "FRESH")
        await expect(fs.readFile(file, "utf-8")).resolves.toBe("FRESH")
        // readFileIfExists will sweep the orphan on the next read.
        await readFileIfExists(file)
        await expect(fs.access(stalePath)).rejects.toThrow()
    })

    it("readFileIfExists cleans an orphaned tempfile next to the final", async () => {
        const file = join(workDir, "settings.json")
        const tmpPath = `${file}.tmp`
        await fs.writeFile(file, "real")
        await fs.writeFile(tmpPath, "stale")
        await readFileIfExists(file)
        await expect(fs.access(tmpPath)).rejects.toThrow()
    })
})

describe("writeFileAtomic — fs.rename failure surfaces to caller", () => {
    let workDir: string
    beforeEach(async () => {
        workDir = await fs.mkdtemp(join(tmpdir(), "lyricue-fs-rename-fail-"))
    })
    afterEach(async () => {
        await fs.rm(workDir, { recursive: true, force: true })
    })

    it("propagates ENOTDIR when target path's parent is suddenly a file", async () => {
        // Setup: the "directory" we're writing into is actually a file. mkdir({recursive:true})
        // on a path whose parent is a file fails with ENOTDIR.
        const fileAsDir = join(workDir, "blocker")
        await fs.writeFile(fileAsDir, "I am a file, not a dir")
        const target = join(fileAsDir, "settings.json")
        await expect(writeFileAtomic(target, "x")).rejects.toThrow()
    })

    it("propagates an error when target path is itself a directory", async () => {
        // Setup: the target path already exists as a directory. The rename of the tempfile
        // over a directory should fail (EISDIR / ENOTEMPTY depending on OS).
        const target = join(workDir, "settings.json")
        await fs.mkdir(target)
        await expect(writeFileAtomic(target, "x")).rejects.toThrow()
    })
})

describe("writeFileAtomic — content edge cases", () => {
    let workDir: string
    beforeEach(async () => {
        workDir = await fs.mkdtemp(join(tmpdir(), "lyricue-fs-edge-"))
    })
    afterEach(async () => {
        await fs.rm(workDir, { recursive: true, force: true })
    })

    it("writes empty content (string \"\")", async () => {
        const file = join(workDir, "empty.json")
        await writeFileAtomic(file, "")
        const stat = await fs.stat(file)
        expect(stat.size).toBe(0)
    })

    it("writes empty content (zero-length Buffer)", async () => {
        const file = join(workDir, "empty.bin")
        await writeFileAtomic(file, Buffer.alloc(0))
        const stat = await fs.stat(file)
        expect(stat.size).toBe(0)
    })

    it("writes content containing every byte 0x00–0xFF (UTF-8 boundary safety)", async () => {
        // A Buffer with all byte values: tests fsync + write contract regardless of payload.
        const file = join(workDir, "all-bytes.bin")
        const content = Buffer.from(Array.from({ length: 256 }, (_, i) => i))
        await writeFileAtomic(file, content)
        const read = await fs.readFile(file)
        expect(read.equals(content)).toBe(true)
    })

    it("handles a 5 MB payload (fsync must complete, not hang)", async () => {
        const file = join(workDir, "large.bin")
        const content = Buffer.alloc(5 * 1024 * 1024, 0x5a)
        await writeFileAtomic(file, content)
        const stat = await fs.stat(file)
        expect(stat.size).toBe(content.byteLength)
    }, 10_000)
})
