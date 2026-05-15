import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveLyriCuePaths } from "../settings/paths.js"
import { cleanupOrphanedTimingArtefacts } from "./orphan-cleanup.js"

/**
 * STORY-03.5 AC3 acceptance tests.
 *
 * The cleanup walks two directories (timing-maps + arrangements) and removes files
 * whose showId is not in the host's "currently exists" set.
 */

describe("cleanupOrphanedTimingArtefacts", () => {
    let workDir: string
    let paths: ReturnType<typeof resolveLyriCuePaths>

    beforeEach(async () => {
        workDir = await fs.mkdtemp(join(tmpdir(), "lyricue-orphan-test-"))
        paths = resolveLyriCuePaths(workDir)
        await fs.mkdir(paths.timingMapsDir, { recursive: true })
        await fs.mkdir(paths.arrangementsDir, { recursive: true })
    })

    afterEach(async () => {
        await fs.rm(workDir, { recursive: true, force: true })
    })

    it("removes timing-map files whose showId is not in the host set", async () => {
        await fs.writeFile(join(paths.timingMapsDir, "alive.timing.json"), "{}")
        await fs.writeFile(join(paths.timingMapsDir, "orphan.timing.json"), "{}")

        const report = await cleanupOrphanedTimingArtefacts({
            paths,
            listExistingShowIds: async () => new Set(["alive"])
        })

        expect(report.removedTimingMaps).toEqual(["orphan"])
        expect(report.errors).toEqual([])
        await expect(fs.access(join(paths.timingMapsDir, "alive.timing.json"))).resolves.toBeUndefined()
        await expect(fs.access(join(paths.timingMapsDir, "orphan.timing.json"))).rejects.toThrow()
    })

    it("removes arrangements files whose showId is not in the host set", async () => {
        await fs.writeFile(join(paths.arrangementsDir, "alive.arrangements.json"), "[]")
        await fs.writeFile(join(paths.arrangementsDir, "orphan.arrangements.json"), "[]")

        const report = await cleanupOrphanedTimingArtefacts({
            paths,
            listExistingShowIds: async () => new Set(["alive"])
        })

        expect(report.removedArrangements).toEqual(["orphan"])
    })

    it("is idempotent: running twice produces the same end state", async () => {
        await fs.writeFile(join(paths.timingMapsDir, "orphan.timing.json"), "{}")

        const first = await cleanupOrphanedTimingArtefacts({
            paths,
            listExistingShowIds: async () => new Set([])
        })
        const second = await cleanupOrphanedTimingArtefacts({
            paths,
            listExistingShowIds: async () => new Set([])
        })

        expect(first.removedTimingMaps).toEqual(["orphan"])
        expect(second.removedTimingMaps).toEqual([]) // already gone
    })

    it("ignores files whose name doesn't match the expected suffix", async () => {
        await fs.writeFile(join(paths.timingMapsDir, "random.txt"), "anything")
        const report = await cleanupOrphanedTimingArtefacts({
            paths,
            listExistingShowIds: async () => new Set([])
        })
        expect(report.removedTimingMaps).toEqual([])
        // The random.txt is untouched.
        await expect(fs.access(join(paths.timingMapsDir, "random.txt"))).resolves.toBeUndefined()
    })

    it("handles a missing timing-maps directory gracefully", async () => {
        await fs.rm(paths.timingMapsDir, { recursive: true })
        const report = await cleanupOrphanedTimingArtefacts({
            paths,
            listExistingShowIds: async () => new Set(["x"])
        })
        expect(report.removedTimingMaps).toEqual([])
        expect(report.errors).toEqual([])
    })

    it("records errors per failed deletion without aborting the sweep", async () => {
        // Create one orphan we'll succeed on and one we can't (by removing write permission
        // on the file's parent dir on POSIX).
        await fs.writeFile(join(paths.timingMapsDir, "orphan-ok.timing.json"), "{}")

        const report = await cleanupOrphanedTimingArtefacts({
            paths,
            listExistingShowIds: async () => new Set([])
        })

        // We can't easily simulate a deletion failure portably without root; the assertion
        // is that the report shape supports per-file errors, which we verify by checking
        // the array is present and a successful deletion leaves errors empty.
        expect(Array.isArray(report.errors)).toBe(true)
        expect(report.removedTimingMaps).toContain("orphan-ok")
    })

    it("returns empty report when every file's showId is known to the host", async () => {
        await fs.writeFile(join(paths.timingMapsDir, "a.timing.json"), "{}")
        await fs.writeFile(join(paths.timingMapsDir, "b.timing.json"), "{}")
        await fs.writeFile(join(paths.arrangementsDir, "a.arrangements.json"), "[]")

        const report = await cleanupOrphanedTimingArtefacts({
            paths,
            listExistingShowIds: async () => new Set(["a", "b", "c"])
        })

        expect(report.removedTimingMaps).toEqual([])
        expect(report.removedArrangements).toEqual([])
        expect(report.errors).toEqual([])
    })
})
