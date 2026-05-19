import { describe, expect, it } from "vitest"
import { learnSongProgressLabel } from "./learn-song-progress.js"

describe("learnSongProgressLabel", () => {
    it("ignores progress for another job", () => {
        expect(learnSongProgressLabel({ jobId: "other", stage: "decode" }, "current")).toBeNull()
    })

    it("uses explicit sidecar messages when present", () => {
        expect(learnSongProgressLabel({ jobId: "job", stage: "decode", message: "Custom progress" }, "job")).toBe("Custom progress")
    })

    it("maps model download stages to operator labels", () => {
        expect(learnSongProgressLabel({ jobId: "job", stage: "models" }, "job")).toBe("Checking required model cache")
        expect(learnSongProgressLabel({ jobId: "job", stage: "model_download_start", cacheKey: "htdemucs-v1" }, "job")).toBe("Downloading htdemucs-v1")
        expect(learnSongProgressLabel({ jobId: "job", stage: "model_download_progress", cacheKey: "htdemucs-v1", downloadedBytes: 50, totalBytes: 200 }, "job")).toBe("Downloading htdemucs-v1 (25%)")
        expect(learnSongProgressLabel({ jobId: "job", stage: "model_installed", cacheKey: "htdemucs-v1" }, "job")).toBe("Installed htdemucs-v1")
        expect(learnSongProgressLabel({ jobId: "job", stage: "model_cached", cacheKey: "htdemucs-v1" }, "job")).toBe("Using cached htdemucs-v1")
    })
})
