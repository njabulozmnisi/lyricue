import { resolveSongLearningModelRequirements, type ModelManifest } from "@lyricue/core/sidecar"

export interface LearnSongModelManifestOptions {
    manifest: ModelManifest | null
    modelMirrorUrl?: string
    requireManifest?: boolean
}

export function withRequiredModelSpecs(payload: Record<string, unknown>, opts: LearnSongModelManifestOptions): Record<string, unknown> {
    const options = payload.options
    if (!options || typeof options !== "object" || Array.isArray(options)) return payload
    const optionRecord = options as Record<string, unknown>
    if (optionRecord.alignmentMode !== "production") return payload

    if (!opts.manifest) {
        if (opts.requireManifest === true) {
            throw new Error("Production song learning requires a model manifest.")
        }
        return payload
    }

    const demucsModel = typeof optionRecord.demucsModel === "string" && optionRecord.demucsModel.trim() ? optionRecord.demucsModel.trim() : "htdemucs"
    const whisperxModel = typeof optionRecord.whisperxModel === "string" && optionRecord.whisperxModel.trim() ? optionRecord.whisperxModel.trim() : "small"
    const requirements = resolveSongLearningModelRequirements(opts.manifest, { demucsModel, whisperxModel }, opts.modelMirrorUrl)
    return {
        ...payload,
        options: {
            ...optionRecord,
            demucsModel,
            whisperxModel,
            ...requirements
        }
    }
}
