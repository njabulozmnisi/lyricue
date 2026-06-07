import { describe, expect, it } from "vitest"
import { DEFAULT_LYRICUE_SETTINGS, LyriCueSettingsSchema } from "./settings.js"

describe("LyriCueSettings sidecar manifest settings", () => {
    it("defaults model manifest controls to optional and unset", () => {
        expect(DEFAULT_LYRICUE_SETTINGS.sidecar.modelManifestPath).toBeNull()
        expect(DEFAULT_LYRICUE_SETTINGS.sidecar.modelMirrorUrl).toBeNull()
        expect(DEFAULT_LYRICUE_SETTINGS.sidecar.requireModelManifest).toBe(false)
    })

    it("persists valid installer manifest controls", () => {
        const settings = LyriCueSettingsSchema.parse({
            $schema: DEFAULT_LYRICUE_SETTINGS.$schema,
            sidecar: {
                modelManifestPath: "/opt/lyricue/models/manifest.json",
                modelMirrorUrl: "https://models.example.org/lyricue/",
                requireModelManifest: true
            }
        })

        expect(settings.sidecar.modelManifestPath).toBe("/opt/lyricue/models/manifest.json")
        expect(settings.sidecar.modelMirrorUrl).toBe("https://models.example.org/lyricue/")
        expect(settings.sidecar.requireModelManifest).toBe(true)
    })

    it("rejects malformed model mirror URLs", () => {
        expect(() =>
            LyriCueSettingsSchema.parse({
                $schema: DEFAULT_LYRICUE_SETTINGS.$schema,
                sidecar: {
                    modelMirrorUrl: "not-a-url"
                }
            })
        ).toThrow(/Invalid url/)
    })
})
