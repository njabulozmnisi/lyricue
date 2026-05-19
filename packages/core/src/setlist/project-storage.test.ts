import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resolveLyriCuePaths } from "../settings/paths.js"
import { ProjectStorage } from "./project-storage.js"

describe("ProjectStorage", () => {
    let dir = ""

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "lyricue-project-storage-"))
    })

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true })
    })

    it("returns null when no active project has been saved", async () => {
        const storage = new ProjectStorage({ paths: resolveLyriCuePaths(dir) })
        await expect(storage.loadActiveProject()).resolves.toBeNull()
    })

    it("saves and reloads the active project through the canonical project shape", async () => {
        const paths = resolveLyriCuePaths(dir)
        const storage = new ProjectStorage({ paths })

        await storage.saveActiveProject({
            id: "sunday-am",
            title: "Sunday AM",
            shows: [
                { id: "song-1", title: "Song One", artist: "A" },
                { id: "reading-1", title: "Scripture Reading" }
            ],
            source: { kind: "local" }
        })

        await expect(storage.loadActiveProject()).resolves.toEqual({
            id: "sunday-am",
            title: "Sunday AM",
            shows: [
                { id: "song-1", title: "Song One", artist: "A" },
                { id: "reading-1", title: "Scripture Reading" }
            ],
            source: { kind: "local" }
        })
        await expect(readFile(paths.activeProjectFile, "utf8")).resolves.toContain("\"Sunday AM\"")
    })

    it("rejects malformed stored projects instead of silently dropping setlist items", async () => {
        const storage = new ProjectStorage({ paths: resolveLyriCuePaths(dir) })
        await storage.saveActiveProject({ id: "p", title: "Project", shows: [] })
        const paths = resolveLyriCuePaths(dir)
        await writeFile(paths.activeProjectFile, "{\"id\":\"p\",\"title\":\"Broken\",\"shows\":[{}]}")

        await expect(storage.loadActiveProject()).rejects.toThrow(/project.shows\[0\].id/)
    })
})
