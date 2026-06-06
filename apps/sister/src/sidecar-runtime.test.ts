import { describe, expect, it } from "vitest"
import { sidecarResolverNodeEnv } from "./sidecar-runtime.js"

describe("sidecarResolverNodeEnv", () => {
    it("forces production sidecar resolution in packaged Electron even when NODE_ENV is unset", () => {
        expect(sidecarResolverNodeEnv({ isPackaged: true, nodeEnv: undefined })).toBe("production")
    })

    it("preserves explicit development mode for source launches", () => {
        expect(sidecarResolverNodeEnv({ isPackaged: false, nodeEnv: "development" })).toBe("development")
    })
})
