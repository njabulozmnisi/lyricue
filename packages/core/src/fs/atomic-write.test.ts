import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
