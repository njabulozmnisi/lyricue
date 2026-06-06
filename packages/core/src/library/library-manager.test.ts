import { createServer, type Server } from "node:http"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEMO_TIMING_MAP } from "../output/test-utils.js"
import type { Arrangement, TimingMap } from "../types/timing-map.js"
import {
    diffCatalog,
    downloadBundle,
    exportBundle,
    fetchCatalog,
    importBundle,
    fetchProject,
    loadProjectPlanBundles,
    listProjects,
    publishBundle,
    publishProjectPlan,
    readBundle,
    sha256,
    testPublishCredential,
    type LibraryCatalog
} from "./library-manager.js"

const servers: Server[] = []

function makeMap(showId = "show-1"): TimingMap {
    return { ...DEMO_TIMING_MAP, showId, learnedFrom: { ...DEMO_TIMING_MAP.learnedFrom } }
}

function makeCatalog(songs: LibraryCatalog["songs"]): LibraryCatalog {
    return {
        $schema: "lyricue-catalog-v1",
        catalogVersion: "1",
        generatedAt: "2026-05-17T00:00:00.000Z",
        songs
    }
}

async function serve(routes: Record<string, { status?: number; body: string | Uint8Array; contentType?: string }>): Promise<string> {
    const server = createServer((req, res) => {
        const route = routes[req.url ?? ""]
        if (!route) {
            res.writeHead(404)
            res.end("missing")
            return
        }
        res.writeHead(route.status ?? 200, { "content-type": route.contentType ?? "application/octet-stream" })
        res.end(route.body)
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("server did not bind to TCP")
    return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe("library catalog", () => {
    it("fetches catalog.json and falls back to mirror on primary failure", async () => {
        const mirrorCatalog = makeCatalog([
            { songId: "s1", title: "Song One", bundleVersion: "1.0.0", bundleUrl: "https://x/s1.lcbundle", sha256: "abc" }
        ])
        const primary = await serve({ "/catalog.json": { status: 500, body: "nope" } })
        const mirror = await serve({ "/catalog.json": { body: JSON.stringify(mirrorCatalog), contentType: "application/json" } })

        const result = await fetchCatalog(primary, { mirrorUrl: mirror })

        expect(result.usedMirror).toBe(true)
        expect(result.catalog.songs[0]?.songId).toBe("s1")
    })

    it("diffs catalog entries by songId and bundleVersion", () => {
        const remote = makeCatalog([
            { songId: "new", title: "New", bundleVersion: "1", bundleUrl: "u", sha256: "h" },
            { songId: "changed", title: "Changed", bundleVersion: "2", bundleUrl: "u", sha256: "h" }
        ])
        const local = makeCatalog([
            { songId: "changed", title: "Changed", bundleVersion: "1", bundleUrl: "u", sha256: "h" },
            { songId: "removed", title: "Removed", bundleVersion: "1", bundleUrl: "u", sha256: "h" }
        ])

        expect(diffCatalog(remote, local)).toEqual({
            added: [remote.songs[0]],
            updated: [remote.songs[1]],
            removed: [local.songs[1]]
        })
    })
})

describe("library bundles", () => {
    it("exports, reads, downloads with SHA256 verification, and imports a bundle", async () => {
        const timingMap = makeMap("show-1")
        const arrangement: Arrangement = {
            id: "default",
            name: "Default",
            showId: "show-1",
            isDefault: true,
            sequence: [{ sectionId: timingMap.sections[0]!.id }],
            createdAt: "2026-05-17T00:00:00.000Z",
            updatedAt: "2026-05-17T00:00:00.000Z"
        }
        const bytes = exportBundle({
            songId: "song-1",
            title: "Song One",
            bundleVersion: "1.0.0",
            show: { id: "show-1", title: "Song One" },
            timingMap,
            arrangements: [arrangement],
            exportedAt: "2026-05-17T00:00:00.000Z"
        })
        expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
        const decoded = readBundle(bytes)
        expect(decoded.manifest.songId).toBe("song-1")
        expect(decoded.timingMap.showId).toBe("show-1")

        const base = await serve({ "/song-1.lcbundle": { body: bytes } })
        const downloaded = await downloadBundle({
            songId: "song-1",
            title: "Song One",
            bundleVersion: "1.0.0",
            bundleUrl: `${base}/song-1.lcbundle`,
            sha256: sha256(bytes)
        })
        expect(downloaded.byteLength).toBe(bytes.byteLength)

        const savedMaps: TimingMap[] = []
        const savedArrangements: Arrangement[][] = []
        const result = await importBundle(downloaded, {
            createShow: async () => undefined,
            saveTimingMap: async (_showId, map) => {
                savedMaps.push(map)
            },
            saveArrangements: async (_showId, arrangements) => {
                savedArrangements.push(arrangements)
            }
        })

        expect(result).toEqual({ songId: "song-1", showId: "show-1", title: "Song One" })
        expect(savedMaps[0]?.learnedFrom.method).toBe("imported")
        expect(savedMaps[0]?.learnedFrom.source).toBe("library:song-1@1.0.0")
        expect(savedArrangements[0]).toHaveLength(1)
    })

    it("rejects SHA256 mismatches before import", async () => {
        const base = await serve({ "/bad.lcbundle": { body: new TextEncoder().encode("{}") } })

        await expect(
            downloadBundle({
                songId: "bad",
                title: "Bad",
                bundleVersion: "1",
                bundleUrl: `${base}/bad.lcbundle`,
                sha256: "not-the-hash"
            })
        ).rejects.toThrow(/SHA256 mismatch/)
    })
})

describe("library publishing", () => {
    it("tests a publish credential with the Worker whoami endpoint", async () => {
        const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
            expect(String(url)).toBe("https://worker.example/publish/whoami")
            expect(init?.headers).toMatchObject({ "X-LC-Credential": "secret" })
            return new Response(
                JSON.stringify({
                    ok: true,
                    credential: { orgId: "hillside", campusId: "central", role: "central", keyId: "central-1" }
                }),
                { status: 200, headers: { "content-type": "application/json" } }
            )
        }) as typeof fetch

        await expect(testPublishCredential("https://worker.example/", "secret", { fetchImpl })).resolves.toEqual({
            orgId: "hillside",
            campusId: "central",
            role: "central",
            keyId: "central-1"
        })
    })

    it("publishes a bundle with identity and credential headers", async () => {
        const bytes = new Uint8Array([1, 2, 3])
        const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
            expect(init?.method).toBe("PUT")
            expect(init?.headers).toMatchObject({
                "content-type": "application/vnd.lyricue.bundle+zip",
                "X-LC-Org": "hillside",
                "X-LC-Campus": "central",
                "X-LC-Credential": "secret",
                "X-LC-Target": "central"
            })
            expect(new Uint8Array(init?.body as ArrayBuffer)).toEqual(bytes)
            return new Response(
                JSON.stringify({ ok: true, songId: "song-1", bundleUrl: "https://cdn/s.lcbundle", catalogVersion: "v1" }),
                { status: 200, headers: { "content-type": "application/json" } }
            )
        }) as typeof fetch

        await expect(
            publishBundle(bytes, {
                workerUrl: "https://worker.example",
                credential: "secret",
                orgId: "hillside",
                campusId: "central",
                target: "central",
                fetchImpl
            })
        ).resolves.toMatchObject({ ok: true, songId: "song-1" })
    })
})

describe("library project plans", () => {
    it("lists and fetches central project plans from library project paths", async () => {
        const project = { id: "sunday", name: "Sunday", songs: [{ songId: "song-1", bundleVersion: "1.0.0" }] }
        const fetchImpl = vi.fn(async (url: string | URL | Request) => {
            if (String(url).endsWith("/projects/central/index.json")) {
                return new Response(JSON.stringify({ projects: [project] }), { status: 200, headers: { "content-type": "application/json" } })
            }
            return new Response(JSON.stringify(project), { status: 200, headers: { "content-type": "application/json" } })
        }) as typeof fetch

        await expect(listProjects("https://library.example", {}, { fetchImpl })).resolves.toEqual([project])
        await expect(fetchProject("https://library.example", "sunday", {}, { fetchImpl })).resolves.toEqual(project)
        expect(fetchImpl).toHaveBeenCalledWith("https://library.example/projects/central/sunday.json")
    })

    it("publishes campus project plans to the Worker", async () => {
        const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
            expect(init?.method).toBe("PUT")
            expect(init?.headers).toMatchObject({
                "X-LC-Campus": "pretoria-north",
                "X-LC-Target": "campus"
            })
            expect(JSON.parse(String(init?.body))).toMatchObject({ id: "conference", name: "Conference" })
            return new Response(JSON.stringify({ ok: true, projectId: "conference", projectUrl: "https://cdn/projects/conference.json" }), {
                status: 200,
                headers: { "content-type": "application/json" }
            })
        }) as typeof fetch

        await expect(
            publishProjectPlan(
                { id: "conference", name: "Conference", songs: [{ songId: "song-1", bundleVersion: "1.0.0" }] },
                {
                    workerUrl: "https://worker.example",
                    credential: "secret",
                    orgId: "hillside",
                    campusId: "pretoria-north",
                    target: "campus",
                    fetchImpl
                }
            )
        ).resolves.toMatchObject({ ok: true, projectId: "conference" })
    })

    it("loads a central project plan by skipping local bundles and importing missing bundles", async () => {
        const localSong = { songId: "song-local", bundleVersion: "1.0.0" }
        const remoteSong = { songId: "song-remote", bundleVersion: "2.0.0", arrangementId: "main" }
        const remoteBundle = exportBundle({
            songId: remoteSong.songId,
            title: "Remote Song",
            bundleVersion: remoteSong.bundleVersion,
            show: { id: "show-remote", title: "Remote Song" },
            timingMap: makeMap("show-remote"),
            arrangements: [
                {
                    id: "main",
                    name: "Main",
                    showId: "show-remote",
                    isDefault: true,
                    sequence: [{ sectionId: "verse1" }],
                    createdAt: "2026-06-06T00:00:00.000Z",
                    updatedAt: "2026-06-06T00:00:00.000Z"
                }
            ]
        })
        const catalog = makeCatalog([
            {
                songId: remoteSong.songId,
                title: "Remote Song",
                bundleVersion: remoteSong.bundleVersion,
                bundleUrl: "https://cdn.example/song-remote.lcbundle",
                sha256: sha256(remoteBundle)
            }
        ])
        const fetchImpl = vi.fn(async () => new Response(remoteBundle, { status: 200 })) as typeof fetch
        const savedTiming: string[] = []
        const savedArrangements: string[] = []
        const createdShows: unknown[] = []

        const result = await loadProjectPlanBundles(
            {
                id: "sunday",
                name: "Sunday",
                date: "2026-06-07",
                songs: [localSong, remoteSong]
            },
            {
                catalog,
                fetchImpl,
                resolveLocalShow: (song) => (song.songId === localSong.songId ? { id: "show-local", title: "Local Song" } : null),
                saveTimingMap: async (showId) => {
                    savedTiming.push(showId)
                },
                saveArrangements: async (showId) => {
                    savedArrangements.push(showId)
                },
                createShow: async (show) => {
                    createdShows.push(show)
                }
            }
        )

        expect(fetchImpl).toHaveBeenCalledWith("https://cdn.example/song-remote.lcbundle")
        expect(savedTiming).toEqual(["show-remote"])
        expect(savedArrangements).toEqual(["show-remote"])
        expect(createdShows).toEqual([{ id: "show-remote", title: "Remote Song" }])
        expect(result.imported).toEqual([{ songId: "song-remote", bundleVersion: "2.0.0", showId: "show-remote", title: "Remote Song" }])
        expect(result.skipped).toEqual([{ id: "show-local", title: "Local Song" }])
        expect(result.project).toEqual({
            id: "sunday",
            title: "Sunday",
            date: "2026-06-07",
            source: { kind: "central", planId: "sunday", diverged: false },
            shows: [
                { id: "show-local", title: "Local Song", songId: "song-local", bundleVersion: "1.0.0" },
                { id: "show-remote", title: "Remote Song", songId: "song-remote", bundleVersion: "2.0.0", arrangementId: "main" }
            ]
        })
    })

    it("loads campus plans with campus source metadata", async () => {
        const result = await loadProjectPlanBundles(
            { id: "conference", name: "Conference", songs: [{ songId: "song-1", bundleVersion: "1.0.0" }] },
            {
                catalog: makeCatalog([]),
                filter: { scope: "campus", campusId: "pretoria-north" },
                resolveLocalShow: () => ({ id: "show-1", title: "Song One" }),
                saveTimingMap: async () => undefined,
                saveArrangements: async () => undefined
            }
        )

        expect(result.project.source).toEqual({
            kind: "campus",
            planId: "conference",
            campusId: "pretoria-north",
            diverged: false
        })
    })

    it("fails closed when a project plan references a bundle missing from the catalog", async () => {
        await expect(
            loadProjectPlanBundles(
                { id: "sunday", name: "Sunday", songs: [{ songId: "missing", bundleVersion: "1.0.0" }] },
                {
                    catalog: makeCatalog([]),
                    saveTimingMap: async () => undefined,
                    saveArrangements: async () => undefined
                }
            )
        ).rejects.toThrow("Catalog does not contain missing@1.0.0")
    })
})
