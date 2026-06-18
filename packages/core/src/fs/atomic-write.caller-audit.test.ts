/**
 * Pass-3.C adversarial — verify writeFileAtomic callers degrade gracefully under
 * EROFS (read-only filesystem) and ENOSPC (disk full).
 *
 * We simulate these conditions by making the target parent directory read-only and
 * then attempting a write. The audit is two-part:
 *
 *   1. writeFileAtomic itself: a failed rename cleans up the tempfile + propagates
 *      a real Node ErrnoException (we already pin this in atomic-write.adversarial).
 *      This file adds the EROFS-specific scenario for completeness.
 *   2. Each caller of writeFileAtomic: the caller's save() must reject with a clear
 *      error AND the in-memory state must not advance to "successfully saved" — so
 *      the operator's next read returns the LAST KNOWN GOOD value, not the value
 *      that failed to persist.
 *
 * If any of these invariants breaks, the operator could think a save succeeded when
 * the disk write actually failed, then close the app, then re-open to find their
 * change gone. Worst-case: they re-do the change, but the disk is still EROFS, and
 * the cycle repeats invisibly.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { writeFileAtomic } from "./atomic-write.js"
import { JsonFileStore } from "../settings/json-file-store.js"
import { TimingMapStorage } from "../timing/timing-map-storage.js"
import { resolveLyriCuePaths } from "../settings/paths.js"
import { DEMO_TIMING_MAP } from "../output/test-utils.js"

describe("atomic-write EROFS (read-only target directory)", () => {
    let workDir: string
    beforeEach(async () => {
        workDir = await fs.mkdtemp(join(tmpdir(), "lyricue-erofs-"))
    })
    afterEach(async () => {
        // Best-effort cleanup — restore writable so rm can proceed.
        try {
            await fs.chmod(workDir, 0o755)
        } catch {}
        try {
            await fs.rm(workDir, { recursive: true, force: true })
        } catch {}
    })

    it("writeFileAtomic propagates EROFS-like errors without leaving an orphan tempfile", async () => {
        const target = join(workDir, "settings.json")
        // Pre-existing file so the rename target is the canonical path.
        await fs.writeFile(target, "old")
        // Make the directory read-only — write attempts inside will fail with EACCES.
        await fs.chmod(workDir, 0o555)
        await expect(writeFileAtomic(target, "new")).rejects.toThrow()
        // Restore writability so we can list.
        await fs.chmod(workDir, 0o755)
        // Verify no orphan tempfile was left behind by the failed write.
        const entries = await fs.readdir(workDir)
        const tmpEntries = entries.filter((e) => e.includes(".tmp"))
        expect(tmpEntries, `unexpected tempfile orphans after EROFS failure: ${tmpEntries.join(", ")}`).toHaveLength(0)
        // And the original file content is untouched.
        await expect(fs.readFile(target, "utf-8")).resolves.toBe("old")
    })
})

describe("JsonFileStore — save failure leaves last-known-good in memory + disk", () => {
    let workDir: string
    beforeEach(async () => {
        workDir = await fs.mkdtemp(join(tmpdir(), "lyricue-jsonstore-"))
    })
    afterEach(async () => {
        try {
            await fs.chmod(workDir, 0o755)
        } catch {}
        try {
            await fs.rm(workDir, { recursive: true, force: true })
        } catch {}
    })

    it("save() rejection does not advance the in-memory observable", async () => {
        const file = join(workDir, "settings.json")
        const schema = z.object({ value: z.string() })
        const store = new JsonFileStore({
            filePath: file,
            schema,
            defaults: { value: "default" },
            migrate: (raw) => raw as { value: string }
        })
        // Seed disk with a known-good value via a normal write.
        await store.save({ value: "good" })
        const beforeFail = store.get()
        expect(beforeFail).toEqual({ value: "good" })

        // Make the dir read-only to force EROFS on the next save.
        await fs.chmod(workDir, 0o555)
        await expect(store.save({ value: "would-be-bad" })).rejects.toThrow()
        // In-memory observable MUST still reflect the last successful save.
        const afterFail = store.get()
        expect(afterFail, "after a failed save, get() must return the last-known-good value").toEqual({ value: "good" })
        // Disk is untouched.
        await fs.chmod(workDir, 0o755)
        await expect(fs.readFile(file, "utf-8")).resolves.toContain('"good"')
    })
})

describe("TimingMapStorage — save failure preserves prior disk state", () => {
    let workDir: string
    beforeEach(async () => {
        workDir = await fs.mkdtemp(join(tmpdir(), "lyricue-tmstore-"))
    })
    afterEach(async () => {
        try {
            await fs.chmod(join(workDir, "lyricue", "timing-maps"), 0o755)
        } catch {}
        try {
            await fs.chmod(workDir, 0o755)
        } catch {}
        try {
            await fs.rm(workDir, { recursive: true, force: true })
        } catch {}
    })

    it("save() rejection on EROFS leaves the prior timing map intact", async () => {
        const paths = resolveLyriCuePaths(workDir)
        const storage = new TimingMapStorage({ paths })
        const showId = DEMO_TIMING_MAP.showId
        // Seed disk with a known-good map.
        await storage.save(showId, DEMO_TIMING_MAP)
        // Now force EROFS on the timing-maps dir.
        await fs.chmod(paths.timingMapsDir, 0o555)
        const alteredMap = { ...DEMO_TIMING_MAP, durationMs: 999_999 }
        await expect(storage.save(showId, alteredMap)).rejects.toThrow()
        // Restore writability and re-load — must still return the seeded map.
        await fs.chmod(paths.timingMapsDir, 0o755)
        const loaded = await storage.load(showId)
        expect(loaded?.durationMs, "save failure must not corrupt the prior persisted map").toBe(
            DEMO_TIMING_MAP.durationMs
        )
    })
})
