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
import { randomBytes } from "node:crypto"
import { dirname } from "node:path"

const TEMP_SUFFIX = ".tmp"

/**
 * Unique-per-call tempfile suffix. The previous fixed `.tmp` suffix collided when two
 * writers raced for the same final path: writer A renamed tmp → final, then writer B
 * tried to rename the same tmp path and got ENOENT — silently losing the write.
 * Appending crypto-random bytes makes every in-flight write target its own tempfile
 * so concurrent writes serialise only at the final rename (which is naturally
 * last-write-wins on POSIX/Windows).
 */
function uniqueTempSuffix(): string {
    return `${TEMP_SUFFIX}.${process.pid}.${randomBytes(6).toString("hex")}`
}

/**
 * Write `content` to `filePath` atomically. Creates parent directories if needed.
 *
 * @param filePath  Absolute path to the destination file.
 * @param content   String or Buffer to write.
 * @throws Node fs errors (EACCES, ENOSPC, etc.) propagate to caller.
 */
export async function writeFileAtomic(filePath: string, content: string | Buffer): Promise<void> {
    const dir = dirname(filePath)
    const tempPath = `${filePath}${uniqueTempSuffix()}`

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
    // If the rename fails (cross-device, permission, target-is-a-directory) the tempfile
    // is left behind; clean it up so we don't leak disk space on a hot retry loop.
    try {
        await fs.rename(tempPath, filePath)
    } catch (err) {
        try {
            await fs.unlink(tempPath)
        } catch {
            // The tempfile may already be gone (rename partially succeeded on some FS,
            // or another concurrent cleanup got there first). Either way the rename
            // error is the actionable one — propagate it.
        }
        throw err
    }

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
 * Also opportunistically cleans up any orphaned `<path>.tmp*` left from a prior crash —
 * scans the file's directory for any tempfile whose name starts with `<basename>.tmp`
 * and removes it. Pre-fix tempfiles used a fixed `.tmp` suffix; post-fix they use a
 * unique per-write suffix (`.tmp.<pid>.<rand>`). The glob covers both.
 */
export async function readFileIfExists(filePath: string): Promise<Buffer | null> {
    try {
        const content = await fs.readFile(filePath)
        // Clean any stale temps (fixed-suffix or unique-suffix) left from prior crashes.
        await cleanOrphanedTempfiles(filePath)
        return content
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
        throw err
    }
}

async function cleanOrphanedTempfiles(filePath: string): Promise<void> {
    const dir = dirname(filePath)
    const basename = filePath.slice(dir.length + 1)
    const prefix = `${basename}${TEMP_SUFFIX}`
    try {
        const entries = await fs.readdir(dir)
        for (const entry of entries) {
            if (entry === prefix || entry.startsWith(`${prefix}.`)) {
                try {
                    await fs.unlink(`${dir}/${entry}`)
                } catch {
                    // Permission / already-gone — best-effort cleanup.
                }
            }
        }
    } catch {
        // Directory listing failed — non-fatal for the read.
    }
}
