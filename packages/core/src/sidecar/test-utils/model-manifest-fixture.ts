import type { ModelManifest } from "../model-manifest.js"

export const FIXTURE_DEMUCS_SHA256 = "7d12dac6600a2aacee79c3d089d39582f8b27b1e367fa2342cdd74023773f26a"
export const FIXTURE_WHISPERX_SHA256 = "661ac7dd2def9073f07ab09c9d4c34bfb8b51bff9f169eb16557bc49ce3d21ed"
export const FIXTURE_WHISPERCPP_SHA256 = "36ba39eb656c693168227e70814551080d52af30d006857a6d9a07d94194ae83"

export const FIXTURE_MODEL_MANIFEST: ModelManifest = {
    $schema: "lyricue-model-manifest-v1",
    mirrorUrl: "file:///tmp/lyricue-model-fixture/",
    models: [
        {
            kind: "demucs",
            model: "fixture-demucs",
            version: "v1",
            sha256: FIXTURE_DEMUCS_SHA256,
            bytes: 20
        },
        {
            kind: "whisperx",
            model: "fixture-whisperx",
            version: "v1",
            sha256: FIXTURE_WHISPERX_SHA256,
            artifactName: "weights.bin",
            bytes: 22
        },
        {
            kind: "whispercpp",
            model: "fixture-base.en",
            version: "v1",
            sha256: FIXTURE_WHISPERCPP_SHA256,
            artifactName: "ggml-base.en.bin",
            bytes: 24
        }
    ]
}
