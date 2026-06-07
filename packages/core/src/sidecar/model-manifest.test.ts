import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { loadModelManifestFile, parseModelManifest, resolveLiveSttModelRequirements, resolveSongLearningModelRequirements } from "./model-manifest.js"
import {
    FIXTURE_DEMUCS_SHA256,
    FIXTURE_MODEL_MANIFEST,
    FIXTURE_WHISPERCPP_SHA256,
    FIXTURE_WHISPERX_SHA256
} from "./test-utils/model-manifest-fixture.js"

const SHA_A = "a".repeat(64)
const SHA_B = "b".repeat(64)
const FIXTURE_MANIFEST_FILE = fileURLToPath(new URL("./test-utils/model-manifest-fixture.json", import.meta.url))

describe("model manifest", () => {
    it("parses a valid model manifest", () => {
        const manifest = parseModelManifest({
            $schema: "lyricue-model-manifest-v1",
            mirrorUrl: "https://mirror.example/models/",
            models: [
                { kind: "demucs", model: "htdemucs", version: "2026.05", sha256: SHA_A },
                { kind: "whisperx", model: "small", version: "2026.05", sha256: SHA_B, artifactName: "small.bin", bytes: 123 },
                { kind: "whispercpp", model: "base.en", version: "ggml-v3", sha256: "c".repeat(64), artifactName: "ggml-base.en.bin", bytes: 78_000_000 }
            ]
        })

        expect(manifest.models).toHaveLength(3)
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

    it("builds live STT model requirements for the Whisper.cpp base.en model", () => {
        const manifest = parseModelManifest({
            $schema: "lyricue-model-manifest-v1",
            mirrorUrl: "https://mirror.example/models/",
            models: [
                {
                    kind: "whispercpp",
                    model: "base.en",
                    version: "ggml-v3",
                    sha256: SHA_A,
                    artifactName: "ggml-base.en.bin",
                    bytes: 78_000_000
                }
            ]
        })

        expect(resolveLiveSttModelRequirements(manifest, { whispercppModel: "base.en" })).toEqual({
            modelMirrorUrl: "https://mirror.example/models/",
            requiredModels: [
                {
                    name: "base.en",
                    version: "ggml-v3",
                    sha256: SHA_A,
                    artifactName: "ggml-base.en.bin",
                    bytes: 78_000_000
                }
            ]
        })
    })

    it("fails when a selected live STT model is missing from the manifest", () => {
        const manifest = parseModelManifest({
            $schema: "lyricue-model-manifest-v1",
            models: [{ kind: "whispercpp", model: "base", version: "ggml-v3", sha256: SHA_A }]
        })

        expect(() => resolveLiveSttModelRequirements(manifest, { whispercppModel: "base.en" })).toThrow("whispercpp model 'base.en'")
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

    it("keeps the fixture manifest valid for installer and subprocess smoke tests", () => {
        const manifest = parseModelManifest(FIXTURE_MODEL_MANIFEST)
        expect(
            resolveSongLearningModelRequirements(manifest, {
                demucsModel: "fixture-demucs",
                whisperxModel: "fixture-whisperx"
            })
        ).toEqual({
            modelMirrorUrl: "file:///tmp/lyricue-model-fixture/",
            requiredModels: [
                { name: "fixture-demucs", version: "v1", sha256: FIXTURE_DEMUCS_SHA256, bytes: 20 },
                {
                    name: "fixture-whisperx",
                    version: "v1",
                    sha256: FIXTURE_WHISPERX_SHA256,
                    artifactName: "weights.bin",
                    bytes: 22
                }
            ]
        })
        expect(resolveLiveSttModelRequirements(manifest, { whispercppModel: "fixture-base.en" })).toEqual({
            modelMirrorUrl: "file:///tmp/lyricue-model-fixture/",
            requiredModels: [
                {
                    name: "fixture-base.en",
                    version: "v1",
                    sha256: FIXTURE_WHISPERCPP_SHA256,
                    artifactName: "ggml-base.en.bin",
                    bytes: 24
                }
            ]
        })
    })

    it("loads the installer fixture manifest through the production file parser", () => {
        const manifest = loadModelManifestFile(FIXTURE_MANIFEST_FILE)

        expect(manifest).toEqual(FIXTURE_MODEL_MANIFEST)
        expect(
            resolveSongLearningModelRequirements(manifest, {
                demucsModel: "fixture-demucs",
                whisperxModel: "fixture-whisperx"
            }).requiredModels
        ).toHaveLength(2)
        expect(resolveLiveSttModelRequirements(manifest, { whispercppModel: "fixture-base.en" }).requiredModels).toHaveLength(1)
    })
})
