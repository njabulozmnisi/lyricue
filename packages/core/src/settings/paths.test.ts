import { describe, it, expect } from "vitest"
import { resolveLyriCuePaths, timingMapPath, timingMapVariantPath, arrangementsPath } from "./paths.js"

describe("paths — showId sandboxing", () => {
    const userData = "/tmp/userdata"
    const paths = resolveLyriCuePaths(userData)

    /**
     * The historical assumption was that `showId` came from FreeShow and was already
     * filesystem-safe. In sister mode the operator window can send `selectSong`/save IPC
     * commands carrying arbitrary `showId` strings, and `learn-song` payloads from the
     * sidecar also flow through these helpers. Untrusted IDs must be rejected — they
     * must never resolve to a path outside `<userData>/lyricue/timing-maps`.
     */

    it("rejects parent-directory traversal segments in showId", () => {
        expect(() => timingMapPath(paths, "../../../etc/passwd")).toThrow(/invalid showId/i)
    })

    it("rejects forward-slash segments in showId", () => {
        expect(() => timingMapPath(paths, "songs/../../etc/passwd")).toThrow(/invalid showId/i)
    })

    it("rejects backslash segments in showId (Windows traversal)", () => {
        expect(() => timingMapPath(paths, "songs\\..\\etc")).toThrow(/invalid showId/i)
    })

    it("rejects absolute paths in showId", () => {
        expect(() => timingMapPath(paths, "/etc/passwd")).toThrow(/invalid showId/i)
    })

    it("rejects empty showId", () => {
        expect(() => timingMapPath(paths, "")).toThrow(/invalid showId/i)
    })

    it("rejects whitespace-only showId", () => {
        expect(() => timingMapPath(paths, "   ")).toThrow(/invalid showId/i)
    })

    it("rejects showId with NUL byte", () => {
        expect(() => timingMapPath(paths, "show\0name")).toThrow(/invalid showId/i)
    })

    it("rejects showId with control characters (newline)", () => {
        expect(() => timingMapPath(paths, "show\nname")).toThrow(/invalid showId/i)
    })

    it("accepts a typical FreeShow ID (uuid-like)", () => {
        const p = timingMapPath(paths, "1234-5678-abcd")
        expect(p.startsWith(paths.timingMapsDir)).toBe(true)
    })

    it("accepts dots within a showId (not as path segments)", () => {
        const p = timingMapPath(paths, "v1.0-song")
        expect(p.startsWith(paths.timingMapsDir)).toBe(true)
    })

    it("rejects a showId that's just a single dot", () => {
        expect(() => timingMapPath(paths, ".")).toThrow(/invalid showId/i)
    })

    it("rejects a showId that's just two dots", () => {
        expect(() => timingMapPath(paths, "..")).toThrow(/invalid showId/i)
    })

    it("rejects unreasonably long showIds", () => {
        expect(() => timingMapPath(paths, "a".repeat(300))).toThrow(/invalid showId/i)
    })

    it("variant path enforces the same sandbox", () => {
        expect(() => timingMapVariantPath(paths, "../escape", "rehearsal")).toThrow(/invalid showId/i)
    })

    it("arrangements path enforces the same sandbox", () => {
        expect(() => arrangementsPath(paths, "../escape")).toThrow(/invalid showId/i)
    })
})
