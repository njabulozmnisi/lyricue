/**
 * TimingMapStorage — atomic CRUD for `<userData>/lyricue/timing-maps/<showId>.timing.json`.
 *
 * Per EP-03 STORY-03.3 and architecture.md §4.3. Other modules (Sync Engine, library import,
 * arrangement builder) persist and retrieve timing maps through this class — they never
 * touch the disk layout directly.
 *
 * Storage layout (see settings/paths.ts):
 *   <userData>/lyricue/timing-maps/<showId>.timing.json
 *
 * Why a class not free functions: we want to bind the `paths` and the schema-migrator
 * once at construction time so callers don't have to re-pass them on every load/save.
 * It also gives a place for future invariants — e.g. an in-memory cache, change events
 * for the Setlist Panel's "this show has timing data" badge.
 *
 * Error model:
 *   - load(): returns null when no file at the path (fresh state). Throws ValidationError[]
 *     wrapped in a TimingMapValidationError when the on-disk JSON fails schema validation
 *     (corrupt file or schema regression). Callers can surface the structured errors to
 *     the operator via the Timing Preview UI.
 *   - save(): validates before writing. Throws TimingMapValidationError if the input is
 *     invalid — never writes a bad map to disk. Atomic-rename guarantees no half-written
 *     final file (writeFileAtomic).
 *   - delete(): idempotent — deleting a nonexistent file is not an error.
 *   - exists(): pure status query — never throws on missing.
 *
 * `.show` integration: architecture.md §4.3 specifies that save() should also update the
 * host `.show` file's `meta.lyricue` pointer. That cross-cutting concern lives in
 * EP-15 (FreeShow integration) — TimingMapStorage exposes a hook (the optional
 * `onSaveMetaPointer` / `onDeleteMetaPointer` callbacks) so the integration layer can
 * wire it without coupling TimingMapStorage to FreeShow internals. At this stage of the
 * project, those callbacks are not provided and the pointer hygiene is a no-op.
 *
 * Schema migration: STORY-03.6 lands a forward-only migration framework. Until that's
 * in place, load() rejects any file whose schemaVersion is not "1" rather than silently
 * accepting future versions a future reader might write. Better to surface the version
 * mismatch loudly than to render a bad map.
 */

import { promises as fs } from "node:fs"
import { writeFileAtomic, readFileIfExists } from "../fs/atomic-write.js"
import {
    arrangementsPath,
    timingMapPath,
    timingMapVariantPath,
    type LyriCuePaths
} from "../settings/paths.js"
import {
    validateTimingMap,
    validateArrangements,
    type ValidationError
} from "../types/timing-map-schema.js"
import type { Arrangement, TimingMap } from "../types/timing-map.js"
import {
    CURRENT_SCHEMA_VERSION,
    extractSchemaVersion,
    migrateToCurrent
} from "./migrations.js"

/**
 * Thrown when on-disk JSON fails schema validation. Carries the full list of validation
 * errors so the caller can render them (e.g., Timing Preview UI in EP-11). Distinct from
 * raw fs errors so callers can handle "validation" and "I/O" separately.
 */
export class TimingMapValidationError extends Error {
    constructor(
        message: string,
        public readonly path: string,
        public readonly validationErrors: ValidationError[]
    ) {
        super(message)
        this.name = "TimingMapValidationError"
    }
}

/**
 * Optional callbacks for cross-cutting `.show` meta-pointer maintenance (EP-15).
 * The host integration layer provides these; TimingMapStorage calls them after a
 * successful save / delete but does not interpret their results. If they throw, the
 * underlying file operation has already committed — the error surfaces to the caller
 * as a soft warning, not a save failure.
 */
export interface TimingMapStorageHooks {
    onSaveMetaPointer?: (showId: string, map: TimingMap) => Promise<void>
    onDeleteMetaPointer?: (showId: string) => Promise<void>
}

export interface TimingMapStorageOptions {
    paths: LyriCuePaths
    hooks?: TimingMapStorageHooks
}

export type TimingMapStorageVariant = "studio" | "rehearsal"

export class TimingMapStorage {
    constructor(private readonly opts: TimingMapStorageOptions) {}

    private get paths() {
        return this.opts.paths
    }

    /**
     * Load the timing map for a show, or return null when no map exists for that ID.
     *
     * Validates the on-disk JSON against the schema. Bad JSON or a schema-failure surfaces
     * as TimingMapValidationError with the full ValidationError[] attached. This is
     * deliberately strict: we'd rather refuse to load a bad map than serve corrupted data
     * to the Sync Engine, where it would propagate to live worship.
     */
    async load(showId: string): Promise<TimingMap | null> {
        const path = timingMapPath(this.paths, showId)
        return this.#loadFromPath(path)
    }

    async loadVariant(showId: string, variant: TimingMapStorageVariant): Promise<TimingMap | null> {
        const path = timingMapVariantPath(this.paths, showId, variant)
        return this.#loadFromPath(path)
    }

    async #loadFromPath(path: string): Promise<TimingMap | null> {
        const buf = await readFileIfExists(path)
        if (buf === null) return null

        let parsed: unknown
        try {
            parsed = JSON.parse(buf.toString("utf-8"))
        } catch (err) {
            throw new TimingMapValidationError(
                `Timing map at ${path} is not valid JSON: ${(err as Error).message}`,
                path,
                [{ path: "", code: "invalid_json", message: (err as Error).message }]
            )
        }

        // Apply schema migrations BEFORE validation: if the file is on an older version,
        // bring it forward, then re-save so subsequent loads skip the migration path.
        const detectedVersion = extractSchemaVersion(parsed)
        const needsMigration = detectedVersion !== null && detectedVersion !== CURRENT_SCHEMA_VERSION
        let migrated: unknown = parsed
        if (needsMigration) {
            try {
                migrated = migrateToCurrent(parsed)
            } catch (err) {
                throw new TimingMapValidationError(
                    `Timing map at ${path} failed schema migration: ${(err as Error).message}`,
                    path,
                    [
                        {
                            path: "metadata.schemaVersion",
                            code: "migration_failed",
                            message: (err as Error).message
                        }
                    ]
                )
            }
        }

        const result = validateTimingMap(migrated)
        if (!result.ok) {
            throw new TimingMapValidationError(
                `Timing map at ${path} failed schema validation (${result.errors.length} issues)`,
                path,
                result.errors
            )
        }

        // If we just upgraded the file, persist the new shape so the next load is fast.
        // We do this AFTER validation so we never write an invalid migration result to disk.
        if (needsMigration) {
            const body = JSON.stringify(result.value, null, 2)
            await writeFileAtomic(path, body)
        }

        return result.value
    }

    /**
     * Persist a timing map for a show. Validates before writing. Atomic-renames so no
     * crash can leave a partial file at the canonical path.
     *
     * The `showId` argument and `map.showId` field MUST match — passing a mismatched
     * showId is a programmer error and throws synchronously (before the file write).
     * This prevents a footgun where saving under one ID but storing a different ID in
     * the JSON body would silently desync the disk layout from the data.
     */
    async save(showId: string, map: TimingMap): Promise<void> {
        await this.#saveToPath(timingMapPath(this.paths, showId), showId, map)

        if (this.opts.hooks?.onSaveMetaPointer) {
            await this.opts.hooks.onSaveMetaPointer(showId, map)
        }
    }

    async saveVariant(showId: string, variant: TimingMapStorageVariant, map: TimingMap): Promise<void> {
        if (map.learnedFrom.method !== variant) {
            throw new Error(
                `TimingMapStorage.saveVariant: variant="${variant}" does not match map.learnedFrom.method="${map.learnedFrom.method}"`
            )
        }
        await this.#saveToPath(timingMapVariantPath(this.paths, showId, variant), showId, map)
    }

    async #saveToPath(path: string, showId: string, map: TimingMap): Promise<void> {
        if (map.showId !== showId) {
            throw new Error(
                `TimingMapStorage.save: showId mismatch (path-key="${showId}", map.showId="${map.showId}")`
            )
        }

        const result = validateTimingMap(map)
        if (!result.ok) {
            throw new TimingMapValidationError(
                `Refusing to save timing map for show ${showId}: failed schema validation (${result.errors.length} issues)`,
                path,
                result.errors
            )
        }

        const body = JSON.stringify(map, null, 2)
        await writeFileAtomic(path, body)
    }

    /**
     * Delete the timing map for a show. Idempotent: deleting a nonexistent map does not
     * throw. Returns true when a file was actually removed; false when no map existed.
     * Callers that need to chain UI updates can branch on the return.
     */
    async delete(showId: string): Promise<boolean> {
        const path = timingMapPath(this.paths, showId)
        const deleted = await this.#deletePath(path)
        if (this.opts.hooks?.onDeleteMetaPointer) {
            await this.opts.hooks.onDeleteMetaPointer(showId)
        }
        return deleted
    }

    async deleteVariant(showId: string, variant: TimingMapStorageVariant): Promise<boolean> {
        return this.#deletePath(timingMapVariantPath(this.paths, showId, variant))
    }

    async #deletePath(path: string): Promise<boolean> {
        try {
            await fs.unlink(path)
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
                return false
            }
            throw err
        }

        return true
    }

    /**
     * True iff a timing map file exists for this show. Does NOT validate the contents —
     * exists() is the cheap status query the Setlist Panel uses to badge "this show has
     * timing data". Full validation happens at load() time.
     */
    async exists(showId: string): Promise<boolean> {
        const path = timingMapPath(this.paths, showId)
        return this.#existsPath(path)
    }

    async existsVariant(showId: string, variant: TimingMapStorageVariant): Promise<boolean> {
        return this.#existsPath(timingMapVariantPath(this.paths, showId, variant))
    }

    async #existsPath(path: string): Promise<boolean> {
        try {
            await fs.access(path)
            return true
        } catch {
            return false
        }
    }

    /**
     * Load arrangements for a show, or return [] when no arrangements file exists.
     *
     * STORY-03.4: arrangement persistence shares the same atomic-write contract and
     * validation discipline as the primary timing map.
     */
    async loadArrangements(showId: string): Promise<Arrangement[]> {
        const path = arrangementsPath(this.paths, showId)
        const buf = await readFileIfExists(path)
        if (buf === null) return []

        let parsed: unknown
        try {
            parsed = JSON.parse(buf.toString("utf-8"))
        } catch (err) {
            throw new TimingMapValidationError(
                `Arrangements at ${path} is not valid JSON: ${(err as Error).message}`,
                path,
                [{ path: "", code: "invalid_json", message: (err as Error).message }]
            )
        }

        const result = validateArrangements(parsed)
        if (!result.ok) {
            throw new TimingMapValidationError(
                `Arrangements at ${path} failed schema validation (${result.errors.length} issues)`,
                path,
                result.errors
            )
        }

        // Every arrangement under this path MUST point at this showId. Mismatches indicate
        // a copy-paste error in the file and we refuse to load to avoid surprising the
        // operator with another song's arrangements.
        for (let i = 0; i < result.value.length; i++) {
            if (result.value[i]!.showId !== showId) {
                throw new TimingMapValidationError(
                    `Arrangements at ${path} contain arrangement[${i}] with mismatched showId="${result.value[i]!.showId}"`,
                    path,
                    [
                        {
                            path: `${i}.showId`,
                            code: "showid_mismatch",
                            message: `expected showId="${showId}"`
                        }
                    ]
                )
            }
        }

        return result.value
    }

    async saveArrangements(showId: string, arrangements: Arrangement[]): Promise<void> {
        // Each arrangement must reference this showId — same invariant as load().
        for (let i = 0; i < arrangements.length; i++) {
            if (arrangements[i]!.showId !== showId) {
                throw new Error(
                    `TimingMapStorage.saveArrangements: arrangement[${i}].showId="${arrangements[i]!.showId}" does not match path-key="${showId}"`
                )
            }
        }

        const result = validateArrangements(arrangements)
        if (!result.ok) {
            const path = arrangementsPath(this.paths, showId)
            throw new TimingMapValidationError(
                `Refusing to save arrangements for show ${showId}: failed schema validation (${result.errors.length} issues)`,
                path,
                result.errors
            )
        }

        const path = arrangementsPath(this.paths, showId)
        const body = JSON.stringify(arrangements, null, 2)
        await writeFileAtomic(path, body)
    }
}
