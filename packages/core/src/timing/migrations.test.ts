import { describe, it, expect } from "vitest"
import {
    CURRENT_SCHEMA_VERSION,
    MIGRATIONS,
    extractSchemaVersion,
    migrateToCurrent,
    v0ToV1Migration
} from "./migrations.js"

/**
 * STORY-03.6 acceptance tests.
 *
 * AC1: migration functions are pure; this is enforced by inspection + the deep-equals
 *      check below (input is not mutated).
 * AC2: dispatcher detects version + applies migrations in sequence.
 * AC3: synthetic v0 demonstrates the migration path even before a real v2 exists.
 * AC4: storage tests cover "after migration, the file is re-saved" — see
 *      timing-map-storage.test.ts "applies v0 → v1 migration on legacy files".
 */

describe("extractSchemaVersion", () => {
    it("returns the version from metadata.schemaVersion", () => {
        expect(extractSchemaVersion({ metadata: { schemaVersion: "1" } })).toBe("1")
        expect(extractSchemaVersion({ metadata: { schemaVersion: "0" } })).toBe("0")
    })

    it("returns null when input is not an object", () => {
        expect(extractSchemaVersion(null)).toBeNull()
        expect(extractSchemaVersion("string")).toBeNull()
        expect(extractSchemaVersion(42)).toBeNull()
        expect(extractSchemaVersion(undefined)).toBeNull()
    })

    it("returns null when metadata.schemaVersion is missing", () => {
        expect(extractSchemaVersion({})).toBeNull()
        expect(extractSchemaVersion({ metadata: {} })).toBeNull()
        expect(extractSchemaVersion({ metadata: { other: "x" } })).toBeNull()
    })

    it("returns null when metadata.schemaVersion is not a string", () => {
        expect(extractSchemaVersion({ metadata: { schemaVersion: 1 } })).toBeNull()
        expect(extractSchemaVersion({ metadata: { schemaVersion: null } })).toBeNull()
    })
})

describe("v0ToV1Migration", () => {
    it("upgrades the schemaVersion from '0' to '1'", () => {
        const input = { metadata: { schemaVersion: "0", version: "1.0.0" }, showId: "x" }
        const output = v0ToV1Migration.migrate(input) as { metadata: { schemaVersion: string } }
        expect(output.metadata.schemaVersion).toBe("1")
    })

    it("is pure — does not mutate the input", () => {
        const input = { metadata: { schemaVersion: "0" } }
        const beforeJson = JSON.stringify(input)
        v0ToV1Migration.migrate(input)
        expect(JSON.stringify(input)).toBe(beforeJson)
    })

    it("preserves all other fields", () => {
        const input = {
            metadata: { schemaVersion: "0", version: "1.0.0", whisperxModel: "large-v2" },
            showId: "show-001",
            bpm: 120,
            extra: "preserved"
        }
        const output = v0ToV1Migration.migrate(input) as Record<string, unknown> & {
            metadata: Record<string, unknown>
        }
        expect(output.showId).toBe("show-001")
        expect(output.bpm).toBe(120)
        expect(output.extra).toBe("preserved")
        expect(output.metadata.version).toBe("1.0.0")
        expect(output.metadata.whisperxModel).toBe("large-v2")
    })
})

describe("migrateToCurrent", () => {
    it("returns the input unchanged when already at CURRENT_SCHEMA_VERSION", () => {
        const input = { metadata: { schemaVersion: CURRENT_SCHEMA_VERSION } }
        expect(migrateToCurrent(input)).toBe(input)
    })

    it("applies v0 → v1 when input is at v0", () => {
        const input = { metadata: { schemaVersion: "0", version: "1.0.0" }, showId: "x" }
        const output = migrateToCurrent(input) as { metadata: { schemaVersion: string } }
        expect(output.metadata.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    })

    it("throws when input has no detectable schemaVersion", () => {
        expect(() => migrateToCurrent({ noVersion: true })).toThrow(/Cannot determine schema version/)
    })

    it("throws when no migration registered for the input version", () => {
        const input = { metadata: { schemaVersion: "9999" } }
        expect(() => migrateToCurrent(input)).toThrow(/No migration registered/)
    })
})

describe("MIGRATIONS registry shape", () => {
    it("includes at least v0 → v1 (the synthetic baseline)", () => {
        const v0Entry = MIGRATIONS.find((m) => m.inputVersion === "0")
        expect(v0Entry).toBeDefined()
        expect(v0Entry?.outputVersion).toBe("1")
    })

    it("CURRENT_SCHEMA_VERSION is '1' (locks the contract for now)", () => {
        expect(CURRENT_SCHEMA_VERSION).toBe("1")
    })
})
