import { readFileSync } from "node:fs"
import { z } from "zod"

const Sha256 = z.string().regex(/^[0-9a-fA-F]{64}$/, "sha256 must be 64 hex characters")

const ModelKindSchema = z.enum(["demucs", "whisperx", "whispercpp"])

const ModelManifestEntrySchema = z.object({
    kind: ModelKindSchema,
    model: z.string().min(1),
    version: z.string().min(1),
    sha256: Sha256,
    artifactName: z.string().min(1).optional(),
    bytes: z.number().int().min(0).optional(),
    url: z.string().url().optional()
})

const ModelManifestSchema = z.object({
    $schema: z.literal("lyricue-model-manifest-v1"),
    mirrorUrl: z.string().url().optional(),
    models: z.array(ModelManifestEntrySchema).min(1)
})

export type ModelKind = z.infer<typeof ModelKindSchema>
export type ModelManifestEntry = z.infer<typeof ModelManifestEntrySchema>
export type ModelManifest = z.infer<typeof ModelManifestSchema>

export interface SidecarModelSpec {
    name: string
    version: string
    sha256: string
    artifactName?: string
    bytes?: number
    url?: string
}

export interface SongLearningModelSelection {
    demucsModel: string
    whisperxModel: string
}

export interface LiveSttModelSelection {
    whispercppModel: string
}

export interface SongLearningModelRequirements {
    requiredModels: SidecarModelSpec[]
    modelMirrorUrl?: string
}

export interface LiveSttModelRequirements {
    requiredModels: SidecarModelSpec[]
    modelMirrorUrl?: string
}

export function parseModelManifest(input: unknown): ModelManifest {
    return ModelManifestSchema.parse(input)
}

export function loadModelManifestFile(filePath: string): ModelManifest {
    return parseModelManifest(JSON.parse(readFileSync(filePath, "utf8")))
}

export function resolveSongLearningModelRequirements(
    manifest: ModelManifest,
    selection: SongLearningModelSelection,
    mirrorUrlOverride?: string | null
): SongLearningModelRequirements {
    const demucs = findModel(manifest, "demucs", selection.demucsModel)
    const whisperx = findModel(manifest, "whisperx", selection.whisperxModel)
    const mirrorUrl = mirrorUrlOverride?.trim() || manifest.mirrorUrl
    return {
        requiredModels: [toSidecarSpec(demucs), toSidecarSpec(whisperx)],
        ...(mirrorUrl ? { modelMirrorUrl: mirrorUrl } : {})
    }
}

export function resolveLiveSttModelRequirements(
    manifest: ModelManifest,
    selection: LiveSttModelSelection,
    mirrorUrlOverride?: string | null
): LiveSttModelRequirements {
    const whispercpp = findModel(manifest, "whispercpp", selection.whispercppModel)
    const mirrorUrl = mirrorUrlOverride?.trim() || manifest.mirrorUrl
    return {
        requiredModels: [toSidecarSpec(whispercpp)],
        ...(mirrorUrl ? { modelMirrorUrl: mirrorUrl } : {})
    }
}

function findModel(manifest: ModelManifest, kind: ModelKind, model: string): ModelManifestEntry {
    const match = manifest.models.find((entry) => entry.kind === kind && entry.model === model)
    if (!match) {
        throw new Error(`Model manifest does not contain ${kind} model '${model}'.`)
    }
    return match
}

function toSidecarSpec(entry: ModelManifestEntry): SidecarModelSpec {
    return {
        name: entry.model,
        version: entry.version,
        sha256: entry.sha256.toLowerCase(),
        ...(entry.artifactName ? { artifactName: entry.artifactName } : {}),
        ...(typeof entry.bytes === "number" ? { bytes: entry.bytes } : {}),
        ...(entry.url ? { url: entry.url } : {})
    }
}
