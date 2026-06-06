import { describe, expect, it } from "vitest"
import {
    DETERMINISTIC_LEARN_SONG_TIMEOUT_MS,
    PRODUCTION_LEARN_SONG_TIMEOUT_MS,
    learnSongTimeoutMs,
    resolveSourceSidecarPythonOverride
} from "./learn-song-sidecar-options.js"

describe("learnSongTimeoutMs", () => {
    it("keeps deterministic learning on the short operator budget", () => {
        expect(learnSongTimeoutMs("deterministic")).toBe(DETERMINISTIC_LEARN_SONG_TIMEOUT_MS)
    })

    it("gives production learning enough budget for packaged cold starts", () => {
        expect(learnSongTimeoutMs("production")).toBe(PRODUCTION_LEARN_SONG_TIMEOUT_MS)
        expect(PRODUCTION_LEARN_SONG_TIMEOUT_MS).toBeGreaterThan(300_000)
    })
})

describe("resolveSourceSidecarPythonOverride", () => {
    it("prefers an explicit source sidecar Python override", () => {
        expect(
            resolveSourceSidecarPythonOverride({
                sidecarRoot: "/repo/python-sidecar",
                envOverride: " /repo/python-sidecar/.venv-ml/bin/python ",
                exists: () => true
            })
        ).toBe("/repo/python-sidecar/.venv-ml/bin/python")
    })

    it("falls back to the development venv when it exists", () => {
        expect(
            resolveSourceSidecarPythonOverride({
                sidecarRoot: "/repo/python-sidecar",
                envOverride: undefined,
                exists: (path) => path === "/repo/python-sidecar/.venv/bin/python"
            })
        ).toBe("/repo/python-sidecar/.venv/bin/python")
    })

    it("uses auto-discovery when no override or venv exists", () => {
        expect(
            resolveSourceSidecarPythonOverride({
                sidecarRoot: "/repo/python-sidecar",
                envOverride: "",
                exists: () => false
            })
        ).toBeNull()
    })
})
