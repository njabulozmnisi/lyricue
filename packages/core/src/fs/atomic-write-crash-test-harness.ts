/**
 * Crash-test harness for writeFileAtomic. NOT a production module.
 *
 * The simulated-crash test (STORY-03.2 AC3) spawns this script as a child process, lets
 * it begin a write of a large payload to a target path, then kills the child with SIGKILL
 * before the rename completes. The parent then inspects the target directory and verifies:
 *
 *   1. The final file does NOT exist (because the rename never ran), OR
 *   2. The final file exists with COMPLETE content (because the rename ran before SIGKILL).
 *
 * What MUST NOT happen: the final file existing with truncated/partial content. The whole
 * point of writeFileAtomic is that no observer ever sees a half-written file at the canonical
 * path — they see the old version, or the new version, never a corrupted in-between.
 *
 * The harness inlines writeFileAtomic rather than importing it because we run via
 * --experimental-strip-types which does not rewrite ./foo.js → ./foo.ts in the source. The
 * inlined version is a byte-for-byte mirror of `./atomic-write.ts` for the happy path.
 *
 * Usage from the test:
 *   node --experimental-strip-types <this-script>.ts <target-path> <payload-size-bytes>
 */
import { promises as fs, writeFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

const TEMP_SUFFIX = ".tmp"

async function writeFileAtomicInline(filePath: string, content: string | Buffer): Promise<void> {
    const dir = dirname(filePath)
    const tempPath = `${filePath}${TEMP_SUFFIX}`
    await fs.mkdir(dir, { recursive: true })
    const handle = await fs.open(tempPath, "w")
    try {
        await handle.writeFile(content)
        await handle.sync()
    } finally {
        await handle.close()
    }
    await fs.rename(tempPath, filePath)
    try {
        const dirHandle = await fs.open(dir, "r")
        try {
            await dirHandle.sync()
        } finally {
            await dirHandle.close()
        }
    } catch {
        // Directory fsync not supported on this platform — fine.
    }
}

async function main() {
    const target = process.argv[2]
    const sizeBytes = Number.parseInt(process.argv[3] ?? "0", 10)
    if (!target || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        process.stderr.write("usage: atomic-write-crash-test-harness <target> <payload-size>\n")
        process.exit(2)
    }

    mkdirSync(dirname(target), { recursive: true })

    // Sentinel: tell the parent "I am about to call writeFileAtomic now."
    writeFileSync(`${target}.sentinel`, "begin")

    // Generate a payload large enough that the kernel can't finish the write before SIGKILL.
    const payload = Buffer.alloc(sizeBytes, 0x61) // ASCII 'a'

    await writeFileAtomicInline(target, payload)

    // Sentinel: if we get here, the rename completed before SIGKILL hit us.
    writeFileSync(`${target}.sentinel`, "complete")
}

void main()
