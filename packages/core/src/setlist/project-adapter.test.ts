import { describe, expect, it, vi } from "vitest"
import { createMemoryProjectAdapter, createRestProjectAdapter, forkProject, markProjectDiverged, projectFromPlan } from "./project-adapter.js"

describe("createMemoryProjectAdapter", () => {
    it("publishes active project updates", () => {
        const adapter = createMemoryProjectAdapter()
        const seen: Array<string | null> = []
        const unsubscribe = adapter.activeProject.subscribe((project) => seen.push(project?.id ?? null))
        adapter.setActiveProject({ id: "p1", title: "Sunday", shows: [] })
        unsubscribe()
        expect(seen).toEqual([null, "p1"])
        expect(adapter.getActiveProject()?.title).toBe("Sunday")
    })
})

describe("project plans", () => {
    it("converts central project plans into linked local projects", () => {
        const project = projectFromPlan(
            {
                id: "sunday-2026-05-24",
                name: "Sunday Morning",
                date: "2026-05-24",
                songs: [{ songId: "song-1", bundleVersion: "1.0.0", arrangementId: "default" }]
            },
            (song) => ({ id: `show-${song.songId}`, title: "Song One" })
        )

        expect(project).toEqual({
            id: "sunday-2026-05-24",
            title: "Sunday Morning",
            date: "2026-05-24",
            source: { kind: "central", planId: "sunday-2026-05-24", diverged: false },
            shows: [
                {
                    id: "show-song-1",
                    title: "Song One",
                    songId: "song-1",
                    bundleVersion: "1.0.0",
                    arrangementId: "default"
                }
            ]
        })
    })

    it("converts campus project plans into linked local projects with campus source metadata", () => {
        const project = projectFromPlan(
            {
                id: "conference",
                name: "Regional Conference",
                songs: [{ songId: "song-1", bundleVersion: "1.0.0" }]
            },
            (song) => ({ id: `show-${song.songId}`, title: "Song One" }),
            { sourceKind: "campus", campusId: "pretoria-north" }
        )

        expect(project.source).toEqual({
            kind: "campus",
            planId: "conference",
            campusId: "pretoria-north",
            diverged: false
        })
    })

    it("tracks central divergence and can fork back to fully local", () => {
        const linked = projectFromPlan({ id: "p1", name: "Plan", songs: [] }, () => ({ id: "s1", title: "Song" }))
        expect(markProjectDiverged(linked).source).toMatchObject({ kind: "central", diverged: true })
        expect(forkProject(linked, { id: "local-1", title: "Local Plan" })).toMatchObject({
            id: "local-1",
            title: "Local Plan",
            source: { kind: "local" }
        })
    })
})

describe("createRestProjectAdapter", () => {
    it("normalizes active project REST responses and notifies subscribers", async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => ({
                project: {
                    id: "p1",
                    name: "Sunday",
                    items: [
                        { showId: "s1", name: "Song One", artist: "A" },
                        { id: "s2", title: "Reading" }
                    ]
                }
            })
        })) as unknown as typeof fetch
        const adapter = createRestProjectAdapter({ baseUrl: "https://freeshow.local/", fetchImpl })
        const seen: Array<string | null> = []
        adapter.activeProject.subscribe((project) => seen.push(project?.id ?? null))

        const project = await adapter.refresh!()

        expect(fetchImpl).toHaveBeenCalledWith("https://freeshow.local/v1/projects/active")
        expect(project).toEqual({
            id: "p1",
            title: "Sunday",
            shows: [
                { id: "s1", title: "Song One", artist: "A" },
                { id: "s2", title: "Reading" }
            ]
        })
        expect(seen).toEqual([null, "p1"])
    })

    it("throws on non-2xx responses", async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: false,
            status: 500,
            statusText: "Server Error",
            json: async () => ({})
        })) as unknown as typeof fetch
        const adapter = createRestProjectAdapter({ baseUrl: "https://freeshow.local", fetchImpl })

        await expect(adapter.refresh!()).rejects.toThrow(/500 Server Error/)
    })
})
