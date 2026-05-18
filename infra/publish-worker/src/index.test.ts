import { afterEach, describe, expect, it, vi } from "vitest"
import { exportBundle } from "../../../packages/core/src/library/library-manager.js"
import { DEMO_TIMING_MAP } from "../../../packages/core/src/output/test-utils.js"
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

function makeEnv(): Env & { objects: Map<string, Uint8Array>; rateLimits: Map<string, string> } {
    const objects = new Map<string, Uint8Array>()
    const rateLimits = new Map<string, string>()
    return {
        objects,
        rateLimits,
        PUBLIC_BASE_URL: "https://cdn.example.test",
        CREDENTIALS: {
            async get(key: string) {
                if (key !== "central-token") return null
                return JSON.stringify({ orgId: "hillside", campusId: "central", role: "central", keyId: "central-1" })
            }
        },
        RATE_LIMITS: {
            async get(key: string) {
                return rateLimits.get(key) ?? null
            },
            async put(key: string, value: string) {
                rateLimits.set(key, value)
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

function bundle(songId = "song-1", version = "1.0.0"): Uint8Array {
    return exportBundle({
        songId,
        title: "Song One",
        bundleVersion: version,
        show: { id: "show-1", title: "Song One" },
        timingMap: {
            ...DEMO_TIMING_MAP,
            showId: "show-1",
            learnedFrom: { ...DEMO_TIMING_MAP.learnedFrom }
        },
        arrangements: [],
        exportedAt: "2026-05-17T00:00:00.000Z"
    })
}

function legacyJsonBundle(songId = "song-1", version = "1.0.0"): string {
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

afterEach(() => {
    vi.unstubAllGlobals()
})

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

    it("keeps legacy JSON bundle compatibility during catalog regeneration", async () => {
        const env = makeEnv()
        const response = await worker.fetch(
            new Request("https://worker.test/publish", {
                method: "PUT",
                headers: { "X-LC-Credential": "central-token", "X-LC-Target": "central" },
                body: legacyJsonBundle("legacy-song")
            }),
            env
        )

        expect(response.status).toBe(200)
        const catalog = JSON.parse(new TextDecoder().decode(env.objects.get("catalog.json")!))
        expect(catalog.songs[0]).toMatchObject({ songId: "legacy-song", bundleVersion: "1.0.0" })
    })

    it("rate-limits publish writes by credential", async () => {
        const env = makeEnv()
        env.RATE_LIMIT_WRITES_PER_HOUR = "1"

        const first = await worker.fetch(
            new Request("https://worker.test/publish", {
                method: "PUT",
                headers: { "X-LC-Credential": "central-token" },
                body: bundle("song-1")
            }),
            env
        )
        const second = await worker.fetch(
            new Request("https://worker.test/publish", {
                method: "PUT",
                headers: { "X-LC-Credential": "central-token" },
                body: bundle("song-2")
            }),
            env
        )

        expect(first.status).toBe(200)
        expect(second.status).toBe(429)
    })

    it("mirrors successful writes to GitHub when configured", async () => {
        const env = makeEnv()
        env.GITHUB_MIRROR_REPO = "hillside/lyricue-library"
        env.GITHUB_MIRROR_TOKEN = "github-token"
        env.GITHUB_MIRROR_BRANCH = "main"
        const requests: Array<{ url: string; init?: RequestInit }> = []
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
                requests.push({ url: String(url), init })
                return new Response(init?.method === "PUT" ? JSON.stringify({ content: { sha: "new-sha" } }) : "{}", {
                    status: init?.method === "PUT" ? 201 : 404,
                    headers: { "content-type": "application/json" }
                })
            })
        )

        const response = await worker.fetch(
            new Request("https://worker.test/publish", {
                method: "PUT",
                headers: { "X-LC-Credential": "central-token", "X-LC-Target": "central" },
                body: bundle()
            }),
            env
        )

        expect(response.status).toBe(200)
        const putRequests = requests.filter((request) => request.init?.method === "PUT")
        expect(putRequests.some((request) => request.url.endsWith("/contents/songs/song-1/1.0.0.lcbundle"))).toBe(true)
        expect(JSON.parse(String(putRequests[0]?.init?.body))).toMatchObject({
            branch: "main",
            message: "publish(song-1): version 1.0.0 by central"
        })
    })

    it("does not fail publish when the GitHub mirror fails", async () => {
        const env = makeEnv()
        env.GITHUB_MIRROR_REPO = "hillside/lyricue-library"
        env.GITHUB_MIRROR_TOKEN = "github-token"
        vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })))
        vi.spyOn(console, "warn").mockImplementation(() => undefined)

        const response = await worker.fetch(
            new Request("https://worker.test/publish", {
                method: "PUT",
                headers: { "X-LC-Credential": "central-token", "X-LC-Target": "central" },
                body: bundle()
            }),
            env
        )

        expect(response.status).toBe(200)
        expect(console.warn).toHaveBeenCalled()
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
