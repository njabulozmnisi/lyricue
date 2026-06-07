import { describe, expect, it } from "vitest"
import { parseModelManifest } from "@lyricue/core/sidecar"
import { resolveModelManifestConfig, withRequiredModelSpecs } from "./model-manifest.js"

const SHA_A = "a".repeat(64)
const SHA_B = "b".repeat(64)

const manifest = parseModelManifest({
    $schema: "lyricue-model-manifest-v1",
    mirrorUrl: "https://manifest.example/models/",
    models: [
        { kind: "demucs", model: "htdemucs", version: "2026.05", sha256: SHA_A },
        { kind: "whisperx", model: "small", version: "2026.05", sha256: SHA_B, artifactName: "small.bin" }
    ]
})

describe("withRequiredModelSpecs", () => {
    it("leaves deterministic song learning payloads unchanged", () => {
        const payload = {
            options: { alignmentMode: "deterministic", detectSections: true }
        }

        expect(withRequiredModelSpecs(payload, { manifest })).toBe(payload)
    })

    it("leaves production payloads unchanged when no manifest is configured and manifest is optional", () => {
        const payload = {
            options: { alignmentMode: "production" }
        }

        expect(withRequiredModelSpecs(payload, { manifest: null })).toBe(payload)
    })

    it("throws for production mode when the install requires a manifest", () => {
        expect(() =>
            withRequiredModelSpecs(
                { options: { alignmentMode: "production" } },
                { manifest: null, requireManifest: true }
            )
        ).toThrow("model manifest")
    })

    it("injects selected model specs for production song learning", () => {
        const payload = {
            showId: "show-1",
            options: { alignmentMode: "production", language: "zu" }
        }

        expect(withRequiredModelSpecs(payload, { manifest })).toEqual({
            showId: "show-1",
            options: {
                alignmentMode: "production",
                language: "zu",
                demucsModel: "htdemucs",
                whisperxModel: "small",
                modelMirrorUrl: "https://manifest.example/models/",
                requiredModels: [
                    { name: "htdemucs", version: "2026.05", sha256: SHA_A },
                    { name: "small", version: "2026.05", sha256: SHA_B, artifactName: "small.bin" }
                ]
            }
        })
    })

    it("uses the install mirror override when present", () => {
        const result = withRequiredModelSpecs(
            { options: { alignmentMode: "production" } },
            { manifest, modelMirrorUrl: "https://install.example/models/" }
        ) as { options: { modelMirrorUrl: string } }

        expect(result.options.modelMirrorUrl).toBe("https://install.example/models/")
    })
})

describe("resolveModelManifestConfig", () => {
    it("uses persisted sidecar settings when env values are absent", () => {
        expect(
            resolveModelManifestConfig({
                settings: {
                    modelManifestPath: " /opt/lyricue/models/manifest.json ",
                    modelMirrorUrl: " https://mirror.example/models/ ",
                    requireModelManifest: true
                }
            })
        ).toEqual({
            manifestPath: "/opt/lyricue/models/manifest.json",
            modelMirrorUrl: "https://mirror.example/models/",
            requireManifest: true
        })
    })

    it("lets env values override persisted sidecar settings for release jobs", () => {
        expect(
            resolveModelManifestConfig({
                envManifestPath: "/release/manifest.json",
                envMirrorUrl: "https://release.example/models/",
                envRequireManifest: "0",
                settings: {
                    modelManifestPath: "/settings/manifest.json",
                    modelMirrorUrl: "https://settings.example/models/",
                    requireModelManifest: true
                }
            })
        ).toEqual({
            manifestPath: "/release/manifest.json",
            modelMirrorUrl: "https://release.example/models/",
            requireManifest: false
        })
    })

    it("treats blank values as unset", () => {
        expect(
            resolveModelManifestConfig({
                envManifestPath: "  ",
                envMirrorUrl: "",
                envRequireManifest: " ",
                settings: {
                    modelManifestPath: "",
                    modelMirrorUrl: "  "
                }
            })
        ).toEqual({
            manifestPath: null,
            modelMirrorUrl: null,
            requireManifest: false
        })
    })
})
