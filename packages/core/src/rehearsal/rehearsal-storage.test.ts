import { mkdir, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdtemp } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { deleteRehearsalRecording, deleteRehearsalRecordingsOlderThan, listRehearsalRecordings } from "./rehearsal-storage.js"

async function makePaths(): Promise<{ rehearsalsDir: string }> {
    const root = await mkdtemp(join(tmpdir(), "lyricue-rehearsals-"))
    const rehearsalsDir = join(root, "lyricue", "rehearsals")
    await mkdir(rehearsalsDir, { recursive: true })
    return { rehearsalsDir }
}

describe("rehearsal recording storage cleanup", () => {
    it("lists WAV recordings newest first and ignores non-WAV files", async () => {
        const paths = await makePaths()
        const older = join(paths.rehearsalsDir, "older.wav")
        const newer = join(paths.rehearsalsDir, "newer.wav")
        await writeFile(older, Buffer.alloc(4))
        await writeFile(newer, Buffer.alloc(8))
        await writeFile(join(paths.rehearsalsDir, "notes.txt"), "ignore")
        await utimes(older, new Date(1_000), new Date(1_000))
        await utimes(newer, new Date(2_000), new Date(2_000))

        const recordings = await listRehearsalRecordings(paths)

        expect(recordings.map((r) => r.fileName)).toEqual(["newer.wav", "older.wav"])
        expect(recordings[0]?.sizeBytes).toBe(8)
    })

    it("deletes a named recording idempotently and rejects traversal", async () => {
        const paths = await makePaths()
        await writeFile(join(paths.rehearsalsDir, "capture.wav"), Buffer.alloc(4))

        await expect(deleteRehearsalRecording(paths, "../capture.wav")).rejects.toThrow(/Invalid/)
        await expect(deleteRehearsalRecording(paths, "capture.wav")).resolves.toBe(true)
        await expect(deleteRehearsalRecording(paths, "capture.wav")).resolves.toBe(false)
    })

    it("sweeps files older than the requested age", async () => {
        const paths = await makePaths()
        const stale = join(paths.rehearsalsDir, "stale.wav")
        const fresh = join(paths.rehearsalsDir, "fresh.wav")
        await writeFile(stale, Buffer.alloc(4))
        await writeFile(fresh, Buffer.alloc(4))
        const now = 2 * 24 * 60 * 60 * 1000
        await utimes(stale, new Date(1_000), new Date(1_000))
        await utimes(fresh, new Date(now - 60 * 60 * 1000), new Date(now - 60 * 60 * 1000))

        const report = await deleteRehearsalRecordingsOlderThan(paths, 1, { now: () => now })

        expect(report.deleted.map((r) => r.fileName)).toEqual(["stale.wav"])
        expect(report.failed).toEqual([])
        await expect(stat(stale)).rejects.toMatchObject({ code: "ENOENT" })
        await expect(stat(fresh)).resolves.toBeTruthy()
    })
})
