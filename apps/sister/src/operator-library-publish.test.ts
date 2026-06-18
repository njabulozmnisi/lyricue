import { describe, expect, it } from "vitest"
import { readBundle } from "@lyricue/core/library"
import { DEMO_TIMING_MAP } from "@lyricue/core/output/test-utils"
import type { Project } from "@lyricue/core/setlist"
import { prepareOperatorSongBundle } from "./operator-library-publish.js"

const project: Project = {
    id: "p1",
    title: "Sunday",
    shows: [{ id: DEMO_TIMING_MAP.showId, title: "Demo Song", artist: "LyriCue" }]
}

describe("prepareOperatorSongBundle", () => {
    it("exports the active learned song and annotates the project with bundle metadata", () => {
        const result = prepareOperatorSongBundle({
            project,
            activeShowId: DEMO_TIMING_MAP.showId,
            timingMap: DEMO_TIMING_MAP,
            arrangements: [],
            request: { title: "Demo Song", exportedAt: "2026-06-18T12:00:00.000Z" },
            now: new Date("2026-06-18T12:00:00.000Z")
        })

        const bundle = readBundle(result.bytes)
        expect(bundle.manifest).toMatchObject({
            songId: "demo-song",
            title: "Demo Song",
            bundleVersion: "20260618T120000Z"
        })
        expect(result.project.shows[0]).toMatchObject({
            songId: "demo-song",
            bundleVersion: "20260618T120000Z"
        })
    })

    it("rejects stale active timing maps before exporting", () => {
        expect(() =>
            prepareOperatorSongBundle({
                project,
                activeShowId: "other-show",
                timingMap: DEMO_TIMING_MAP,
                arrangements: [],
                request: { title: "Demo Song" }
            })
        ).toThrow("Active timing map does not match the selected song.")
    })
})
