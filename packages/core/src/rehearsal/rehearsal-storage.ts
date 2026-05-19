import { readdir, rm, stat } from "node:fs/promises"
import { basename, join } from "node:path"
import type { LyriCuePaths } from "../settings/paths.js"

export interface RehearsalRecordingInfo {
    fileName: string
    filePath: string
    sizeBytes: number
    modifiedAtMs: number
}

export interface RehearsalCleanupReport {
    deleted: RehearsalRecordingInfo[]
    failed: Array<{ fileName: string; message: string }>
}

export async function listRehearsalRecordings(paths: Pick<LyriCuePaths, "rehearsalsDir">): Promise<RehearsalRecordingInfo[]> {
    let entries: string[]
    try {
        entries = await readdir(paths.rehearsalsDir)
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return []
        throw err
    }

    const recordings: RehearsalRecordingInfo[] = []
    for (const fileName of entries) {
        if (!fileName.endsWith(".wav")) continue
        const filePath = rehearsalRecordingPath(paths, fileName)
        const s = await stat(filePath)
        if (!s.isFile()) continue
        recordings.push({
            fileName,
            filePath,
            sizeBytes: s.size,
            modifiedAtMs: s.mtimeMs
        })
    }
    return recordings.sort((a, b) => b.modifiedAtMs - a.modifiedAtMs)
}

export async function deleteRehearsalRecording(paths: Pick<LyriCuePaths, "rehearsalsDir">, fileName: string): Promise<boolean> {
    const filePath = rehearsalRecordingPath(paths, fileName)
    try {
        await rm(filePath)
        return true
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return false
        throw err
    }
}

export async function deleteRehearsalRecordingsOlderThan(
    paths: Pick<LyriCuePaths, "rehearsalsDir">,
    olderThanDays: number,
    opts: { now?: () => number } = {}
): Promise<RehearsalCleanupReport> {
    if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
        throw new Error("olderThanDays must be a non-negative number.")
    }
    const now = opts.now ?? Date.now
    const cutoffMs = now() - olderThanDays * 24 * 60 * 60 * 1000
    const recordings = await listRehearsalRecordings(paths)
    const report: RehearsalCleanupReport = { deleted: [], failed: [] }
    for (const recording of recordings) {
        if (recording.modifiedAtMs >= cutoffMs) continue
        try {
            await deleteRehearsalRecording(paths, recording.fileName)
            report.deleted.push(recording)
        } catch (err) {
            report.failed.push({ fileName: recording.fileName, message: (err as Error).message })
        }
    }
    return report
}

function rehearsalRecordingPath(paths: Pick<LyriCuePaths, "rehearsalsDir">, fileName: string): string {
    if (basename(fileName) !== fileName || !fileName.endsWith(".wav")) {
        throw new Error("Invalid rehearsal recording filename.")
    }
    return join(paths.rehearsalsDir, fileName)
}
