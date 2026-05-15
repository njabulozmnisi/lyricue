import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveLyriCuePaths, timingMapPath, arrangementsPath } from "../settings/paths.js"
import { SCHEMA_LYRICUE_TIMING_V1 } from "../types/schema-versions.js"
import { TimingMapStorage, TimingMapValidationError } from "./timing-map-storage.js"
import type { Arrangement, TimingMap } from "../types/timing-map.js"

/**
 * STORY-03.3 + 03.4 acceptance tests. The fixture builder produces a minimal valid map
 * we mutate per test; the storage instance is rebuilt per test against a fresh tmpdir to
 * keep the cases independent.
 */

function makeValidMap(showId = "show-001"): TimingMap {
    return {
        $schema: SCHEMA_LYRICUE_TIMING_V1,
        showId,
        learnedFrom: {
            method: "studio",
            filename: "amazing-grace.wav",
            duration: 240.5,
            learnedAt: "2026-05-15T00:00:00.000Z"
        },
        bpm: 76,
        timeSignature: "4/4",
        language: "en",
        sections: [
            {
                id: "v1",
                type: "verse",
                label: "Verse 1",
                slideIndex: 0,
                startMs: 0,
                endMs: 1000,
                words: [
                    {
                        text: "Hello",
                        startMs: 0,
                        endMs: 500,
                        confidence: 0.95,
                        lineIndex: 0
                    }
                ],
                lines: [{ startMs: 0, endMs: 500, wordStartIndex: 0, wordEndIndex: 1 }]
            }
        ],
        metadata: {
            schemaVersion: "1",
            version: "1.0.0"
        }
    }
}

function makeValidArrangement(showId = "show-001", id = "default"): Arrangement {
    return {
        id,
        name: `Arrangement ${id}`,
        showId,
        isDefault: id === "default",
        sequence: [{ sectionId: "v1" }],
        createdAt: "2026-05-15T00:00:00.000Z",
        updatedAt: "2026-05-15T00:00:00.000Z"
    }
}

describe("TimingMapStorage", () => {
    let workDir: string
    let storage: TimingMapStorage
    let paths: ReturnType<typeof resolveLyriCuePaths>

    beforeEach(async () => {
        workDir = await fs.mkdtemp(join(tmpdir(), "lyricue-tm-test-"))
        paths = resolveLyriCuePaths(workDir)
        storage = new TimingMapStorage({ paths })
    })

    afterEach(async () => {
        await fs.rm(workDir, { recursive: true, force: true })
    })

    describe("load()", () => {
        it("returns null when no map exists for the show", async () => {
            await expect(storage.load("missing-show")).resolves.toBeNull()
        })

        it("returns the parsed map when the file exists and is valid", async () => {
            const map = makeValidMap()
            await storage.save("show-001", map)
            const loaded = await storage.load("show-001")
            expect(loaded?.showId).toBe("show-001")
            expect(loaded?.bpm).toBe(76)
            expect(loaded?.sections).toHaveLength(1)
        })

        it("throws TimingMapValidationError when the JSON is malformed", async () => {
            const path = timingMapPath(paths, "show-001")
            await fs.mkdir(paths.timingMapsDir, { recursive: true })
            await fs.writeFile(path, "{ not: 'json' }")
            await expect(storage.load("show-001")).rejects.toThrow(TimingMapValidationError)
        })

        it("throws TimingMapValidationError when the schema is wrong", async () => {
            const path = timingMapPath(paths, "show-001")
            await fs.mkdir(paths.timingMapsDir, { recursive: true })
            await fs.writeFile(path, JSON.stringify({ wrong: "shape" }))
            try {
                await storage.load("show-001")
                throw new Error("should have thrown")
            } catch (err) {
                expect(err).toBeInstanceOf(TimingMapValidationError)
                const ve = err as TimingMapValidationError
                expect(ve.validationErrors.length).toBeGreaterThan(0)
                expect(ve.path).toBe(path)
            }
        })

        it("applies v0 → v1 migration on legacy files and re-saves them", async () => {
            const path = timingMapPath(paths, "show-001")
            await fs.mkdir(paths.timingMapsDir, { recursive: true })
            const legacy = makeValidMap()
            // Pretend this came from synthetic v0.
            const legacyDisk = JSON.parse(JSON.stringify(legacy))
            legacyDisk.metadata.schemaVersion = "0"
            await fs.writeFile(path, JSON.stringify(legacyDisk, null, 2))

            const loaded = await storage.load("show-001")
            expect(loaded?.metadata.schemaVersion).toBe("1")

            // The file on disk has been re-saved with the new version (no re-migration on next load).
            const reread = JSON.parse(await fs.readFile(path, "utf-8"))
            expect(reread.metadata.schemaVersion).toBe("1")
        })

        it("throws when the schemaVersion is unknown and unmigrable", async () => {
            const path = timingMapPath(paths, "show-001")
            await fs.mkdir(paths.timingMapsDir, { recursive: true })
            const map = makeValidMap()
            const future = JSON.parse(JSON.stringify(map))
            future.metadata.schemaVersion = "999"
            await fs.writeFile(path, JSON.stringify(future))

            try {
                await storage.load("show-001")
                throw new Error("should have thrown")
            } catch (err) {
                expect(err).toBeInstanceOf(TimingMapValidationError)
                const ve = err as TimingMapValidationError
                expect(ve.validationErrors[0]?.code).toBe("migration_failed")
            }
        })
    })

    describe("save()", () => {
        it("writes the file to <userData>/lyricue/timing-maps/<showId>.timing.json", async () => {
            const map = makeValidMap()
            await storage.save("show-001", map)
            const expectedPath = join(paths.timingMapsDir, "show-001.timing.json")
            const content = JSON.parse(await fs.readFile(expectedPath, "utf-8"))
            expect(content.showId).toBe("show-001")
        })

        it("validates before writing — rejects invalid maps without touching disk", async () => {
            const map = makeValidMap()
            // Corrupt: bpm must be positive.
            const corrupted = { ...map, bpm: -1 }
            await expect(storage.save("show-001", corrupted as TimingMap)).rejects.toThrow(
                TimingMapValidationError
            )
            // File never created.
            const expectedPath = join(paths.timingMapsDir, "show-001.timing.json")
            await expect(fs.access(expectedPath)).rejects.toThrow()
        })

        it("rejects when showId arg doesn't match map.showId (footgun guard)", async () => {
            const map = makeValidMap("show-001")
            await expect(storage.save("show-002", map)).rejects.toThrow(/showId mismatch/)
        })

        it("uses atomic writes — overwriting leaves no stray .tmp", async () => {
            const map = makeValidMap()
            await storage.save("show-001", map)
            await storage.save("show-001", { ...map, bpm: 120 })
            const tmpPath = join(paths.timingMapsDir, "show-001.timing.json.tmp")
            await expect(fs.access(tmpPath)).rejects.toThrow()
        })

        it("invokes onSaveMetaPointer hook when provided", async () => {
            const calls: Array<{ showId: string; map: TimingMap }> = []
            const storageWithHook = new TimingMapStorage({
                paths,
                hooks: {
                    onSaveMetaPointer: async (showId, map) => {
                        calls.push({ showId, map })
                    }
                }
            })
            const map = makeValidMap()
            await storageWithHook.save("show-001", map)
            expect(calls).toHaveLength(1)
            expect(calls[0]!.showId).toBe("show-001")
            expect(calls[0]!.map.bpm).toBe(76)
        })
    })

    describe("delete()", () => {
        it("removes an existing file and returns true", async () => {
            await storage.save("show-001", makeValidMap())
            const result = await storage.delete("show-001")
            expect(result).toBe(true)
            expect(await storage.exists("show-001")).toBe(false)
        })

        it("is idempotent: deleting a nonexistent map returns false, does not throw", async () => {
            await expect(storage.delete("never-existed")).resolves.toBe(false)
        })

        it("invokes onDeleteMetaPointer even when the file is absent", async () => {
            const calls: string[] = []
            const storageWithHook = new TimingMapStorage({
                paths,
                hooks: {
                    onDeleteMetaPointer: async (showId) => {
                        calls.push(showId)
                    }
                }
            })
            await storageWithHook.delete("absent-show")
            expect(calls).toEqual(["absent-show"])
        })
    })

    describe("exists()", () => {
        it("returns true after save, false after delete", async () => {
            expect(await storage.exists("show-001")).toBe(false)
            await storage.save("show-001", makeValidMap())
            expect(await storage.exists("show-001")).toBe(true)
            await storage.delete("show-001")
            expect(await storage.exists("show-001")).toBe(false)
        })
    })

    describe("loadArrangements() / saveArrangements()", () => {
        it("returns [] when no arrangements file exists for the show", async () => {
            await expect(storage.loadArrangements("missing")).resolves.toEqual([])
        })

        it("saves and reloads arrangements", async () => {
            const arr = makeValidArrangement("show-001", "sunday")
            await storage.saveArrangements("show-001", [arr])
            const loaded = await storage.loadArrangements("show-001")
            expect(loaded).toHaveLength(1)
            expect(loaded[0]!.id).toBe("sunday")
        })

        it("writes to <userData>/lyricue/arrangements/<showId>.arrangements.json", async () => {
            await storage.saveArrangements("show-001", [makeValidArrangement("show-001")])
            const path = arrangementsPath(paths, "show-001")
            await expect(fs.access(path)).resolves.toBeUndefined()
        })

        it("rejects when an arrangement's showId doesn't match the path key", async () => {
            const wrong = makeValidArrangement("show-002")
            await expect(storage.saveArrangements("show-001", [wrong])).rejects.toThrow(
                /showId/
            )
        })

        it("rejects when on-disk arrangements reference a different show", async () => {
            const path = arrangementsPath(paths, "show-001")
            await fs.mkdir(paths.arrangementsDir, { recursive: true })
            const wrong = makeValidArrangement("show-002")
            await fs.writeFile(path, JSON.stringify([wrong]))
            await expect(storage.loadArrangements("show-001")).rejects.toThrow(
                TimingMapValidationError
            )
        })

        it("validates arrangements on save — bad data does not reach disk", async () => {
            const bad = { ...makeValidArrangement("show-001"), createdAt: "not-iso" }
            await expect(
                storage.saveArrangements("show-001", [bad as unknown as Arrangement])
            ).rejects.toThrow(TimingMapValidationError)
            const path = arrangementsPath(paths, "show-001")
            await expect(fs.access(path)).rejects.toThrow()
        })
    })

    describe("STORY-03.5 meta-pointer hygiene", () => {
        it("save() then delete() invokes both hooks", async () => {
            const log: Array<{ op: "save" | "delete"; showId: string }> = []
            const storageWithHooks = new TimingMapStorage({
                paths,
                hooks: {
                    onSaveMetaPointer: async (showId) => {
                        log.push({ op: "save", showId })
                    },
                    onDeleteMetaPointer: async (showId) => {
                        log.push({ op: "delete", showId })
                    }
                }
            })
            await storageWithHooks.save("show-001", makeValidMap())
            await storageWithHooks.delete("show-001")
            expect(log).toEqual([
                { op: "save", showId: "show-001" },
                { op: "delete", showId: "show-001" }
            ])
        })
    })
})
