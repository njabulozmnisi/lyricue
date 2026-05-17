import { describe, expect, it } from "vitest"
import worker, { type Env, type R2ObjectBody } from "./index.js"

class MemoryObject implements R2ObjectBody {
    constructor(private readonly bytes: Uint8Array) {}
    async text(): Promise<string> {
        return new TextDecoder().decode(this.bytes)
    }
    async arrayBuffer(): Promise<ArrayBuffer> {
        return this.bytes.buffer.slice(this.bytes.byteOffset, this.bytes.byteOffset + this.bytes.byteLength)
    }
}

function makeEnv(): Env & { objects: Map<string, Uint8Array> } {
    const objects = new Map<string, Uint8Array>()
    return {
        objects,
        PUBLIC_BASE_URL: "https://cdn.example.test",
        CREDENTIALS: {
            async get(key: string) {
                if (key !== "central-token") return null
                return JSON.stringify({ orgId: "hillside", campusId: "central", role: "central", keyId: "central-1" })
            }
        },
        LIBRARY: {
            async put(key, value) {
                const bytes =
                    typeof value === "string"
                        ? new TextEncoder().encode(value)
                        : value instanceof Uint8Array
                          ? value
                          : new Uint8Array(value)
                objects.set(key, bytes)
            },
            async get(key) {
                const bytes = objects.get(key)
                return bytes ? new MemoryObject(bytes) : null
            },
            async list(opts) {
                const prefix = opts?.prefix ?? ""
                return { objects: [...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) }
            }
        }
    }
}

function bundle(songId = "song-1", version = "1.0.0"): string {
    return JSON.stringify({
        manifest: {
            songId,
            title: "Song One",
            bundleVersion: version
        },
        show: {},
        timingMap: {},
        arrangements: []
    })
}

describe("publish worker", () => {
    it("validates credentials with whoami", async () => {
        const env = makeEnv()
        const response = await worker.fetch(
            new Request("https://worker.test/publish/whoami", { headers: { "X-LC-Credential": "central-token" } }),
            env
        )

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toMatchObject({
            ok: true,
            credential: { orgId: "hillside", campusId: "central", role: "central", keyId: "central-1" }
        })
    })

    it("publishes a bundle, regenerates catalog, and appends audit log", async () => {
        const env = makeEnv()
        const response = await worker.fetch(
            new Request("https://worker.test/publish", {
                method: "PUT",
                headers: { "X-LC-Credential": "central-token", "X-LC-Target": "central" },
                body: bundle()
            }),
            env
        )

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toMatchObject({
            ok: true,
            songId: "song-1",
            bundleUrl: "https://cdn.example.test/songs/song-1/1.0.0.lcbundle"
        })
        expect(env.objects.has("songs/song-1/1.0.0.lcbundle")).toBe(true)
        const catalog = JSON.parse(new TextDecoder().decode(env.objects.get("catalog.json")!))
        expect(catalog.songs).toHaveLength(1)
        expect(catalog.songs[0]).toMatchObject({ songId: "song-1", bundleVersion: "1.0.0" })
        const log = new TextDecoder().decode(env.objects.get("meta/publish-log.jsonl")!)
        expect(log).toContain("\"songId\":\"song-1\"")
    })

    it("rejects unknown credentials", async () => {
        const env = makeEnv()
        const response = await worker.fetch(
            new Request("https://worker.test/publish", {
                method: "PUT",
                headers: { "X-LC-Credential": "bad-token" },
                body: bundle()
            }),
            env
        )

        expect(response.status).toBe(403)
    })
})
