import { describe, expect, it } from "vitest"
import { nextSaveErrorState, type OperatorSaveError } from "./operator-save-error.js"

describe("operator save-error tracker", () => {
    it("records a new error from a failure update", () => {
        const next = nextSaveErrorState(null, {
            kind: "failure",
            scope: "audio-device",
            error: new Error("EROFS"),
            atWallMs: 1000
        })
        expect(next).toEqual({ scope: "audio-device", message: "EROFS", atWallMs: 1000 })
    })

    it("coerces non-Error throwables to their string form", () => {
        const next = nextSaveErrorState(null, {
            kind: "failure",
            scope: "shortcuts",
            error: "raw-string-from-async",
            atWallMs: 1
        })
        expect(next?.message).toBe("raw-string-from-async")
    })

    it("clears the error when a later success arrives in the same scope", () => {
        const prior: OperatorSaveError = { scope: "audio-device", message: "EROFS", atWallMs: 1 }
        const next = nextSaveErrorState(prior, { kind: "success", scope: "audio-device" })
        expect(next).toBeNull()
    })

    it("preserves an unrelated prior error when success arrives in a different scope", () => {
        const prior: OperatorSaveError = { scope: "audio-device", message: "EROFS", atWallMs: 1 }
        const next = nextSaveErrorState(prior, { kind: "success", scope: "shortcuts" })
        expect(next).toBe(prior)
    })

    it("replaces a prior error in the same scope with the newer failure", () => {
        const prior: OperatorSaveError = { scope: "audio-device", message: "EROFS", atWallMs: 1 }
        const next = nextSaveErrorState(prior, {
            kind: "failure",
            scope: "audio-device",
            error: new Error("ENOSPC"),
            atWallMs: 2
        })
        expect(next).toEqual({ scope: "audio-device", message: "ENOSPC", atWallMs: 2 })
    })

    it("replaces a prior error in one scope with a failure in a different scope (single-slot)", () => {
        // The current host only surfaces one save-error at a time. A different-scope
        // failure displaces the prior one — the prior was already either fixed (and
        // cleared) or stale enough that the new failure is more relevant.
        const prior: OperatorSaveError = { scope: "audio-device", message: "EROFS", atWallMs: 1 }
        const next = nextSaveErrorState(prior, {
            kind: "failure",
            scope: "library-config",
            error: new Error("EACCES"),
            atWallMs: 2
        })
        expect(next).toEqual({ scope: "library-config", message: "EACCES", atWallMs: 2 })
    })
})
