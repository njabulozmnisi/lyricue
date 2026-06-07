import { describe, expect, it } from "vitest"
import { resolveOperatorModelManifestStatus } from "./model-manifest-status.js"

describe("resolveOperatorModelManifestStatus", () => {
    it("reports configured when a manifest path is set and available", () => {
        expect(
            resolveOperatorModelManifestStatus({
                manifestPath: "/opt/lyricue/models.json",
                requireManifest: true,
                pathExists: () => true
            })
        ).toEqual({
            status: "configured",
            label: "Model manifest configured",
            detail: "/opt/lyricue/models.json"
        })
    })

    it("reports missing when the install requires a manifest but no path is configured", () => {
        expect(resolveOperatorModelManifestStatus({ manifestPath: undefined, requireManifest: true })).toEqual({
            status: "missing",
            label: "Model manifest required",
            detail: "Set LC_MODEL_MANIFEST_PATH before using production learning."
        })
    })

    it("reports missing when the configured manifest path is unavailable", () => {
        expect(
            resolveOperatorModelManifestStatus({
                manifestPath: "/missing/models.json",
                requireManifest: false,
                pathExists: () => false
            })
        ).toEqual({
            status: "missing",
            label: "Model manifest path is not available",
            detail: "/missing/models.json"
        })
    })

    it("reports optional when production learning can use sidecar defaults", () => {
        expect(resolveOperatorModelManifestStatus({ manifestPath: "", requireManifest: false })).toEqual({
            status: "optional",
            label: "Model manifest not configured",
            detail: "Production learning will use sidecar defaults unless this install requires a manifest."
        })
    })
})
