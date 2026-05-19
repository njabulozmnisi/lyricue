export function learnSongProgressLabel(progress: unknown, jobId: string): string | null {
    if (!progress || typeof progress !== "object") return null
    const payload = progress as { jobId?: unknown; stage?: unknown; message?: unknown; model?: unknown; cacheKey?: unknown; downloadedBytes?: unknown; totalBytes?: unknown }
    if (typeof payload.jobId === "string" && payload.jobId !== jobId) return null
    if (typeof payload.message === "string" && payload.message.trim()) return payload.message
    const modelName = typeof payload.cacheKey === "string" ? payload.cacheKey : typeof payload.model === "string" ? payload.model : "model"
    switch (payload.stage) {
        case "decode":
            return "Decoding and resampling audio"
        case "bpm":
            return "Estimating reference BPM"
        case "models":
            return "Checking required model cache"
        case "model_cached":
            return `Using cached ${modelName}`
        case "model_download_start":
            return `Downloading ${modelName}`
        case "model_download_progress":
            return formatModelDownloadProgress(modelName, payload.downloadedBytes, payload.totalBytes)
        case "model_installed":
            return `Installed ${modelName}`
        case "demucs":
            return typeof payload.model === "string" ? `Isolating vocal stem (${payload.model})` : "Isolating vocal stem"
        case "whisperx":
            return typeof payload.model === "string" ? `Aligning vocals (${payload.model})` : "Aligning vocals"
        case "alignment":
            return "Building timing alignment"
        case "timing_map":
            return "Assembling timing map"
        case "section_detection":
            return "Proposing section types"
        case "complete":
            return "Song learning complete"
        default:
            return null
    }
}

function formatModelDownloadProgress(modelName: string, downloadedBytes: unknown, totalBytes: unknown): string {
    if (typeof downloadedBytes === "number" && typeof totalBytes === "number" && totalBytes > 0) {
        return `Downloading ${modelName} (${Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))}%)`
    }
    if (typeof downloadedBytes === "number" && downloadedBytes > 0) {
        return `Downloading ${modelName} (${formatBytes(downloadedBytes)})`
    }
    return `Downloading ${modelName}`
}

function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
    return `${bytes} B`
}
