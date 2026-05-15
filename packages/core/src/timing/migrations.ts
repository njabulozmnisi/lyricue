/**
 * TimingMap schema migration framework.
 *
 * Per EP-03 STORY-03.6 and ADR-10. Forward-only migrations: each migration is a pure
 * function that takes the old shape and returns the new shape. The loader detects the
 * file's schemaVersion, applies migrations in sequence, then validates the result against
 * the current schema. After migration, the file is re-saved with the new version so
 * subsequent loads skip the migration step.
 *
 * Current state:
 *   - The only supported schemaVersion is "1" (lyricue-timing-v1).
 *   - The migration registry is empty. We ship the framework now so the NEXT schema
 *     change can land cleanly without a refactor — adding a migration is one new entry
 *     in `MIGRATIONS` plus its pure function.
 *
 * Why ship the framework before we need it: every operator-facing app has a moment where
 * a schema change can't be made because there's no migration path for existing user data.
 * Building the path in advance — and exercising it with a synthetic v0 → v1 test (AC3) —
 * prevents that wall.
 *
 * Migration safety:
 *   - Migrations are pure. They MUST NOT touch the filesystem or any global state.
 *   - Migrations MUST be idempotent in the sense that re-running a migration on its own
 *     output (somehow) is a no-op, not a corruption.
 *   - Migrations declare their inputVersion → outputVersion mapping. The dispatcher picks
 *     the chain of migrations to apply by version.
 */

/**
 * A migration function: takes an unknown blob (which the caller has confirmed has
 * `inputVersion` somewhere in its schema fields) and returns the post-migration blob.
 * The output blob's schema version MUST match the migration's declared `outputVersion`.
 */
export type MigrationFn = (input: unknown) => unknown

export interface SchemaMigration {
    inputVersion: string
    outputVersion: string
    /** Human-readable description for logs / error messages. */
    description: string
    migrate: MigrationFn
}

/**
 * Synthetic v0 → v1 migration. Demonstrates the pattern and exercises the dispatcher in
 * tests even though v0 was never a real shipped version. The migration is intentionally
 * a no-op-style transform: the v0 shape is identical to v1 except for the schemaVersion
 * field. Real migrations will do meaningful field renames or restructuring.
 */
export const v0ToV1Migration: SchemaMigration = {
    inputVersion: "0",
    outputVersion: "1",
    description: "Synthetic v0 → v1: bumps metadata.schemaVersion from '0' to '1'.",
    migrate: (input: unknown): unknown => {
        if (typeof input !== "object" || input === null) return input
        const blob = input as Record<string, unknown>
        const metadata = (blob.metadata ?? {}) as Record<string, unknown>
        return {
            ...blob,
            metadata: {
                ...metadata,
                schemaVersion: "1"
            }
        }
    }
}

/**
 * Migration registry. Ordered by inputVersion. The dispatcher walks the chain until it
 * reaches the current supported version (CURRENT_SCHEMA_VERSION).
 */
export const MIGRATIONS: readonly SchemaMigration[] = [v0ToV1Migration]

export const CURRENT_SCHEMA_VERSION = "1" as const

/**
 * Best-effort schemaVersion extractor. Returns null if the blob doesn't contain a
 * recognisable version field — in which case the loader should refuse to apply migrations.
 *
 * We look in `metadata.schemaVersion` (the canonical location). The redundancy is
 * deliberate: future schema iterations might move the field, and the extractor is
 * cheap enough to handle the union shapes without a separate type per version.
 */
export function extractSchemaVersion(input: unknown): string | null {
    if (typeof input !== "object" || input === null) return null
    const blob = input as Record<string, unknown>
    const metadata = blob.metadata
    if (typeof metadata === "object" && metadata !== null) {
        const sv = (metadata as Record<string, unknown>).schemaVersion
        if (typeof sv === "string") return sv
    }
    return null
}

/**
 * Run the migration chain from the input's detected version up to CURRENT_SCHEMA_VERSION.
 * Returns the migrated blob. Throws if no migration path exists.
 */
export function migrateToCurrent(input: unknown): unknown {
    let version = extractSchemaVersion(input)
    if (version === null) {
        throw new Error(
            "Cannot determine schema version of timing map — refusing to migrate. Expected metadata.schemaVersion to be a string."
        )
    }
    if (version === CURRENT_SCHEMA_VERSION) return input

    let current = input
    while (version !== CURRENT_SCHEMA_VERSION) {
        const step = MIGRATIONS.find((m) => m.inputVersion === version)
        if (!step) {
            throw new Error(
                `No migration registered for schemaVersion="${version}" → "${CURRENT_SCHEMA_VERSION}". Supported input versions: ${MIGRATIONS.map((m) => m.inputVersion).join(", ")}.`
            )
        }
        current = step.migrate(current)
        version = step.outputVersion
    }
    return current
}
