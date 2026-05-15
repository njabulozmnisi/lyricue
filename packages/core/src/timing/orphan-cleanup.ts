/**
 * Orphan cleanup — removes per-show LyriCue artefacts (timing map + arrangements) when
 * the corresponding host show no longer exists.
 *
 * Per EP-03 STORY-03.5 AC3 and architecture.md §7.1. Runs once at app launch, NOT during
 * live worship: scanning the timing-maps directory and stat'ing every show file is cheap
 * but not free, and a startup pass is the cleanest place for it.
 *
 * The host (Electron main, fork OR sister) provides a `listExistingShowIds` callback that
 * enumerates the IDs FreeShow knows about. LyriCue compares this set against the IDs that
 * have on-disk artefacts. Anything LyriCue has that the host doesn't is an orphan and gets
 * removed. The reverse (the host knowing about shows LyriCue has no map for) is normal and
 * not an orphan.
 *
 * Idempotency: running this twice in a row produces the same end state. Safe.
 *
 * Failure handling: each file deletion is independent — a permission error on one file
 * doesn't abort the sweep, it logs and continues. The function returns a structured report
 * so the host can decide whether to surface a warning.
 */

import { promises as fs } from "node:fs"
import { join } from "node:path"
import type { LyriCuePaths } from "../settings/paths.js"

export interface OrphanCleanupReport {
    /** Show IDs whose timing map was removed. */
    removedTimingMaps: string[]
    /** Show IDs whose arrangements file was removed. */
    removedArrangements: string[]
    /** Show IDs we attempted to remove but failed (permission, busy, etc.). One per failure. */
    errors: { showId: string; kind: "timing-map" | "arrangements"; message: string }[]
}

export interface OrphanCleanupOptions {
    paths: LyriCuePaths
    /**
     * Async predicate that returns the set of show IDs that currently exist in the host
     * (FreeShow). Called ONCE per cleanup invocation. Implementations typically delegate
     * to FreeShow's shows directory enumeration.
     */
    listExistingShowIds(): Promise<Set<string>>
}

/**
 * Suffix patterns used by TimingMapStorage. Kept in sync with `settings/paths.ts`.
 */
const TIMING_MAP_SUFFIX = ".timing.json"
const ARRANGEMENTS_SUFFIX = ".arrangements.json"

/**
 * Walk the timing-maps and arrangements directories, deleting files whose showId is not
 * in the host's set. Returns a report of everything removed + any errors encountered.
 */
export async function cleanupOrphanedTimingArtefacts(
    opts: OrphanCleanupOptions
): Promise<OrphanCleanupReport> {
    const existing = await opts.listExistingShowIds()
    const report: OrphanCleanupReport = {
        removedTimingMaps: [],
        removedArrangements: [],
        errors: []
    }

    await sweepDir({
        dir: opts.paths.timingMapsDir,
        suffix: TIMING_MAP_SUFFIX,
        existing,
        kind: "timing-map",
        report
    })

    await sweepDir({
        dir: opts.paths.arrangementsDir,
        suffix: ARRANGEMENTS_SUFFIX,
        existing,
        kind: "arrangements",
        report
    })

    return report
}

interface SweepDirOptions {
    dir: string
    suffix: string
    existing: Set<string>
    kind: "timing-map" | "arrangements"
    report: OrphanCleanupReport
}

async function sweepDir(opts: SweepDirOptions): Promise<void> {
    let entries: string[]
    try {
        entries = await fs.readdir(opts.dir)
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return
        // Other read errors leave the report empty for this dir and surface in errors.
        opts.report.errors.push({
            showId: "(directory read)",
            kind: opts.kind,
            message: (err as Error).message
        })
        return
    }

    for (const name of entries) {
        if (!name.endsWith(opts.suffix)) continue
        const showId = name.slice(0, name.length - opts.suffix.length)
        if (opts.existing.has(showId)) continue

        const path = join(opts.dir, name)
        try {
            await fs.unlink(path)
            if (opts.kind === "timing-map") opts.report.removedTimingMaps.push(showId)
            else opts.report.removedArrangements.push(showId)
        } catch (err) {
            opts.report.errors.push({
                showId,
                kind: opts.kind,
                message: (err as Error).message
            })
        }
    }
}
