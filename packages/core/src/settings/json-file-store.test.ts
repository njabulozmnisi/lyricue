import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { JsonFileStore } from "./json-file-store.js"

// A minimal toy schema for testing the store machinery without dragging in our real schemas.
const ToySchema = z.object({
    $schema: z.literal("toy-v1"),
    name: z.string().min(1),
    count: z.number().int().nonnegative()
})
type Toy = z.infer<typeof ToySchema>

const defaultToy: Toy = { $schema: "toy-v1", name: "default", count: 0 }

describe("JsonFileStore", () => {
    let workDir: string
    let filePath: string
    let silentLogger: { warn: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> }

    beforeEach(async () => {
        workDir = await fs.mkdtemp(join(tmpdir(), "lyricue-store-test-"))
        filePath = join(workDir, "toy.json")
        silentLogger = { warn: vi.fn(), info: vi.fn() }
    })

    afterEach(async () => {
        await fs.rm(workDir, { recursive: true, force: true })
    })

    describe("load()", () => {
        it("returns defaults when the file does not exist (fresh install)", async () => {
            const store = new JsonFileStore({ filePath, schema: ToySchema, defaults: defaultToy, logger: silentLogger })
            const loaded = await store.load()
            expect(loaded).toEqual(defaultToy)
            expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining("not found"))
            expect(store.isLoaded).toBe(true)
        })

        it("returns defaults + logs a warning when the file is malformed JSON (corrupt file)", async () => {
            await fs.writeFile(filePath, "{ this is not JSON")
            const store = new JsonFileStore({ filePath, schema: ToySchema, defaults: defaultToy, logger: silentLogger })

            const loaded = await store.load()

            expect(loaded).toEqual(defaultToy)
            expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining("malformed JSON"))
        })

        it("returns defaults + logs a warning when the file fails schema validation (schema mismatch)", async () => {
            await fs.writeFile(
                filePath,
                JSON.stringify({ $schema: "toy-v1", name: "", count: -5 }) // both fields invalid
            )
            const store = new JsonFileStore({ filePath, schema: ToySchema, defaults: defaultToy, logger: silentLogger })

            const loaded = await store.load()

            expect(loaded).toEqual(defaultToy)
            expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining("failed schema validation"))
        })

        it("returns the parsed value on a valid file", async () => {
            const valid: Toy = { $schema: "toy-v1", name: "hi", count: 7 }
            await fs.writeFile(filePath, JSON.stringify(valid))
            const store = new JsonFileStore({ filePath, schema: ToySchema, defaults: defaultToy, logger: silentLogger })

            const loaded = await store.load()

            expect(loaded).toEqual(valid)
        })

        it("runs the migrate hook before validation when provided", async () => {
            // Simulate an older shape that lacked the `count` field.
            await fs.writeFile(filePath, JSON.stringify({ $schema: "toy-v1", name: "legacy" }))
            const migrate = vi.fn((raw: unknown) => ({ ...(raw as object), count: 42 }))
            const store = new JsonFileStore({ filePath, schema: ToySchema, defaults: defaultToy, logger: silentLogger, migrate })

            const loaded = await store.load()

            expect(migrate).toHaveBeenCalledOnce()
            expect(loaded).toEqual({ $schema: "toy-v1", name: "legacy", count: 42 })
        })
    })

    describe("save()", () => {
        it("persists a valid value and re-loading returns the same", async () => {
            const store = new JsonFileStore({ filePath, schema: ToySchema, defaults: defaultToy, logger: silentLogger })
            await store.load()

            const updated: Toy = { $schema: "toy-v1", name: "after-save", count: 12 }
            await store.save(updated)

            // Round-trip through a fresh store reading from disk.
            const fresh = new JsonFileStore({ filePath, schema: ToySchema, defaults: defaultToy, logger: silentLogger })
            const reloaded = await fresh.load()
            expect(reloaded).toEqual(updated)
        })

        it("refuses to save an invalid value (caller passed something the schema rejects)", async () => {
            const store = new JsonFileStore({ filePath, schema: ToySchema, defaults: defaultToy, logger: silentLogger })
            await store.load()

            const bad = { $schema: "toy-v1", name: "", count: -1 } as Toy
            await expect(store.save(bad)).rejects.toThrow(/Refusing to save invalid/)
        })

        it("notifies subscribers on each successful save", async () => {
            const store = new JsonFileStore({ filePath, schema: ToySchema, defaults: defaultToy, logger: silentLogger })
            await store.load()

            const seen: Toy[] = []
            const unsubscribe = store.subscribe((v) => seen.push(v))

            await store.save({ $schema: "toy-v1", name: "first", count: 1 })
            await store.save({ $schema: "toy-v1", name: "second", count: 2 })

            unsubscribe()

            // Subscriber gets the initial value synchronously, then each save.
            expect(seen).toHaveLength(3)
            expect(seen[0]).toEqual(defaultToy)
            expect(seen[1]?.name).toBe("first")
            expect(seen[2]?.name).toBe("second")
        })
    })

    describe("subscribe()", () => {
        it("delivers the current value immediately on subscribe", async () => {
            await fs.writeFile(filePath, JSON.stringify({ $schema: "toy-v1", name: "preset", count: 3 }))
            const store = new JsonFileStore({ filePath, schema: ToySchema, defaults: defaultToy, logger: silentLogger })
            await store.load()

            const seen: Toy[] = []
            const unsubscribe = store.subscribe((v) => seen.push(v))
            unsubscribe()

            expect(seen).toHaveLength(1)
            expect(seen[0]?.name).toBe("preset")
        })
    })
})
