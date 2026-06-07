export type OperatorModelManifestStatus =
    | { status: "configured"; label: string; detail: string }
    | { status: "missing"; label: string; detail: string }
    | { status: "optional"; label: string; detail: string }

export interface ResolveOperatorModelManifestStatusOptions {
    manifestPath: string | undefined
    requireManifest: boolean
    pathExists?: (path: string) => boolean
}

export function resolveOperatorModelManifestStatus(options: ResolveOperatorModelManifestStatusOptions): OperatorModelManifestStatus {
    const manifestPath = options.manifestPath?.trim() ?? ""
    const pathExists = options.pathExists ?? (() => true)
    if (manifestPath.length > 0) {
        if (!pathExists(manifestPath)) {
            return {
                status: "missing",
                label: "Model manifest path is not available",
                detail: manifestPath
            }
        }
        return {
            status: "configured",
            label: "Model manifest configured",
            detail: manifestPath
        }
    }
    if (options.requireManifest) {
        return {
            status: "missing",
            label: "Model manifest required",
            detail: "Set LC_MODEL_MANIFEST_PATH before using production learning."
        }
    }
    return {
        status: "optional",
        label: "Model manifest not configured",
        detail: "Production learning will use sidecar defaults unless this install requires a manifest."
    }
}
