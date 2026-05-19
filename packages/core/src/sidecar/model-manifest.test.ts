import { describe, expect, it } from "vitest"
import { parseModelManifest, resolveSongLearningModelRequirements } from "./model-manifest.js"

const SHA_A = "a".repeat(64)
const SHA_B = "b".repeat(64)

describe("model manifest", () => {
    it("parses a valid model manifest", () => {
        const manifest = parseModelManifest({
            $schema: "lyricue-model-manifest-v1",
            mirrorUrl: "https://mirror.example/models/",
            models: [
                { kind: "demucs", model: "htdemucs", version: "2026.05", sha256: SHA_A },
                { kind: "whisperx", model: "small", version: "2026.05", sha256: SHA_B, artifactName: "small.bin", bytes: 123 }
            ]
        })

        expect(manifest.models).toHaveLength(2)
        expect(manifest.mirrorUrl).toBe("https://mirror.example/models/")
    })

    it("rejects malformed hashes before the sidecar sees them", () => {
        expect(() =>
            parseModelManifest({
                $schema: "lyricue-model-manifest-v1",
                models: [{ kind: "demucs", model: "htdemucs", version: "2026.05", sha256: "not-a-hash" }]
            })
        ).toThrow(/sha256/)
    })

    it("builds sidecar requiredModels from selected Demucs and WhisperX models", () => {
        const manifest = parseModelManifest({
            $schema: "lyricue-model-manifest-v1",
            mirrorUrl: "https://mirror.example/models/",
            models: [
                { kind: "demucs", model: "htdemucs", version: "2026.05", sha256: SHA_A },
                { kind: "demucs", model: "mdx_extra", version: "2026.05", sha256: "c".repeat(64) },
                { kind: "whisperx", model: "small", version: "2026.05", sha256: SHA_B, artifactName: "small.bin", bytes: 123 }
            ]
        })

        expect(
            resolveSongLearningModelRequirements(manifest, {
                demucsModel: "htdemucs",
                whisperxModel: "small"
            })
        ).toEqual({
            modelMirrorUrl: "https://mirror.example/models/",
            requiredModels: [
                { name: "htdemucs", version: "2026.05", sha256: SHA_A },
                { name: "small", version: "2026.05", sha256: SHA_B, artifactName: "small.bin", bytes: 123 }
            ]
        })
    })

    it("lets per-install mirror override manifest mirror", () => {
        const manifest = parseModelManifest({
            $schema: "lyricue-model-manifest-v1",
            mirrorUrl: "https://manifest.example/models/",
            models: [
                { kind: "demucs", model: "htdemucs", version: "2026.05", sha256: SHA_A },
                { kind: "whisperx", model: "small", version: "2026.05", sha256: SHA_B }
            ]
        })

        const requirements = resolveSongLearningModelRequirements(
            manifest,
            { demucsModel: "htdemucs", whisperxModel: "small" },
            "https://install.example/models/"
        )

        expect(requirements.modelMirrorUrl).toBe("https://install.example/models/")
    })

    it("fails when a selected model is missing from the manifest", () => {
        const manifest = parseModelManifest({
            $schema: "lyricue-model-manifest-v1",
            models: [
                { kind: "demucs", model: "htdemucs", version: "2026.05", sha256: SHA_A },
                { kind: "whisperx", model: "base", version: "2026.05", sha256: SHA_B }
            ]
        })

        expect(() =>
            resolveSongLearningModelRequirements(manifest, {
                demucsModel: "htdemucs",
                whisperxModel: "small"
            })
        ).toThrow("whisperx model 'small'")
    })
})
