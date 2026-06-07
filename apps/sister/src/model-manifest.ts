import { resolveSongLearningModelRequirements, type ModelManifest } from "@lyricue/core/sidecar"

export interface LearnSongModelManifestOptions {
    manifest: ModelManifest | null
    modelMirrorUrl?: string
    requireManifest?: boolean
}

export interface ModelManifestSettingsSource {
    modelManifestPath?: string | null
    modelMirrorUrl?: string | null
    requireModelManifest?: boolean
}

export interface ResolveModelManifestConfigOptions {
    envManifestPath?: string | undefined
    envMirrorUrl?: string | undefined
    envRequireManifest?: string | undefined
    settings?: ModelManifestSettingsSource | null
}

export interface ModelManifestConfig {
    manifestPath: string | null
    modelMirrorUrl: string | null
    requireManifest: boolean
}

export function resolveModelManifestConfig(opts: ResolveModelManifestConfigOptions): ModelManifestConfig {
    const envRequire = parseEnvBoolean(opts.envRequireManifest)
    return {
        manifestPath: nonBlank(opts.envManifestPath) ?? nonBlank(opts.settings?.modelManifestPath) ?? null,
        modelMirrorUrl: nonBlank(opts.envMirrorUrl) ?? nonBlank(opts.settings?.modelMirrorUrl) ?? null,
        requireManifest: envRequire ?? opts.settings?.requireModelManifest ?? false
    }
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

function nonBlank(value: string | null | undefined): string | undefined {
    const trimmed = value?.trim()
    return trimmed ? trimmed : undefined
}

function parseEnvBoolean(value: string | undefined): boolean | undefined {
    if (value === undefined) return undefined
    const normalized = value.trim().toLowerCase()
    if (normalized === "1" || normalized === "true") return true
    if (normalized === "0" || normalized === "false") return false
    return undefined
}
