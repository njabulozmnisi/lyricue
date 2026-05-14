/**
 * Crash-safe file write. Writes content to `<path>.tmp`, fsyncs, then renames over the
 * target path. The rename is atomic on POSIX and near-atomic on Windows (no other process
 * can observe a half-written final file).
 *
 * Per ADR-7 (architecture.md). Every persisted LyriCue artifact uses this — settings,
 * timing maps, arrangements, identity, library config — because a power loss or process
 * kill mid-write must not corrupt user data (NFR2.1: zero crashes during live worship).
 *
 * Implementation notes:
 *   - The temp file lives in the same directory as the final path so the rename is on the
 *     same filesystem (cross-filesystem renames degrade to copy-and-delete, which is not atomic).
 *   - We fsync the file descriptor *and* the parent directory (where supported) to flush
 *     the rename through journaling.
 *   - On Windows, `fs.rename` over an existing file is supported in Node ≥10 — this is fine
 *     for our Node ≥20 requirement.
 *   - If the temp file from a previous crashed write is left behind, the next write
 *     overwrites it (`flag: 'w'` is default).
 */

import { promises as fs } from "node:fs"
import { dirname } from "node:path"

const TEMP_SUFFIX = ".tmp"

/**
 * Write `content` to `filePath` atomically. Creates parent directories if needed.
 *
 * @param filePath  Absolute path to the destination file.
 * @param content   String or Buffer to write.
 * @throws Node fs errors (EACCES, ENOSPC, etc.) propagate to caller.
 */
export async function writeFileAtomic(filePath: string, content: string | Buffer): Promise<void> {
    const dir = dirname(filePath)
    const tempPath = `${filePath}${TEMP_SUFFIX}`

    await fs.mkdir(dir, { recursive: true })

    // Write to temp + fsync the file body.
    const handle = await fs.open(tempPath, "w")
    try {
        await handle.writeFile(content)
        await handle.sync()
    } finally {
        await handle.close()
    }

    // Rename is atomic on POSIX; on Windows it's effectively atomic for our purposes.
    await fs.rename(tempPath, filePath)

    // Best-effort: fsync the directory so the rename itself is persisted on journaled FS.
    // fs.open on a directory is POSIX-only; on Windows this throws EISDIR and we skip.
    try {
        const dirHandle = await fs.open(dir, "r")
        try {
            await dirHandle.sync()
        } finally {
            await dirHandle.close()
        }
    } catch {
        // Directory fsync not supported on this platform — acceptable; the file-level
        // sync above is the load-bearing one for crash safety.
    }
}

/**
 * Read a previously-atomically-written file. Returns null when the file does not exist
 * (so callers can branch on "fresh install" without try/catch). Other I/O errors propagate.
 *
 * Also opportunistically cleans up any orphaned `<path>.tmp` left from a prior crash —
 * if the final file exists and the tmp exists, the tmp is stale and we remove it.
 */
export async function readFileIfExists(filePath: string): Promise<Buffer | null> {
    try {
        const content = await fs.readFile(filePath)

        // Clean any stale temp from a prior crashed write.
        const tempPath = `${filePath}${TEMP_SUFFIX}`
        try {
            await fs.unlink(tempPath)
        } catch {
            // No stale temp, or we lack permission — both are fine.
        }

        return content
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
        throw err
    }
}
