import { describe, expect, it, vi } from "vitest"
import { createMemoryProjectAdapter, createRestProjectAdapter } from "./project-adapter.js"

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
