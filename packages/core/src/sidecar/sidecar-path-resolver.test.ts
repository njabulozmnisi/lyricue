import { describe, it, expect } from "vitest"
import { resolveSidecarLaunch } from "./sidecar-path-resolver.js"
import { SidecarLifecycleError } from "./sidecar-protocol.js"

describe("resolveSidecarLaunch — development mode", () => {
    it("returns source mode when NODE_ENV is not production", () => {
        const result = resolveSidecarLaunch({
            appPath: "/repo",
            nodeEnv: "development"
        })
        expect(result.mode).toBe("source")
        if (result.mode === "source") {
            expect(result.sourceDir).toBe("/repo/python-sidecar")
        }
    })

    it("treats undefined NODE_ENV as development", () => {
        const result = resolveSidecarLaunch({
            appPath: "/repo",
            nodeEnv: undefined
        })
        expect(result.mode).toBe("source")
    })

    it("treats 'test' NODE_ENV as development", () => {
        const result = resolveSidecarLaunch({
            appPath: "/repo",
            nodeEnv: "test"
        })
        expect(result.mode).toBe("source")
    })

    it("does NOT verify file existence in source mode (source dir may not exist in some test configs)", () => {
        const result = resolveSidecarLaunch({
            appPath: "/does-not-exist",
            nodeEnv: "development",
            exists: () => false
        })
        expect(result.mode).toBe("source")
    })
})

describe("resolveSidecarLaunch — production mode", () => {
    it("returns the platform-specific binary path on macOS arm64", () => {
        const result = resolveSidecarLaunch({
            appPath: "/Applications/LyriCue.app/Contents/Resources/app",
            nodeEnv: "production",
            platform: "darwin",
            arch: "arm64",
            exists: () => true
        })
        expect(result.mode).toBe("bundled")
        if (result.mode === "bundled") {
            expect(result.binaryPath).toBe(
                "/Applications/LyriCue.app/Contents/Resources/app/resources/sidecar/darwin-arm64/lyricue-sidecar"
            )
        }
    })

    it("uses .exe suffix on Windows", () => {
        const result = resolveSidecarLaunch({
            appPath: "C:\\app",
            nodeEnv: "production",
            platform: "win32",
            arch: "x64",
            exists: () => true
        })
        expect(result.mode).toBe("bundled")
        if (result.mode === "bundled") {
            expect(result.binaryPath).toMatch(/lyricue-sidecar\.exe$/)
        }
    })

    it("uses linux-x64 directory naming on Linux", () => {
        const result = resolveSidecarLaunch({
            appPath: "/opt/lyricue",
            nodeEnv: "production",
            platform: "linux",
            arch: "x64",
            exists: () => true
        })
        expect(result.mode).toBe("bundled")
        if (result.mode === "bundled") {
            expect(result.binaryPath).toBe("/opt/lyricue/resources/sidecar/linux-x64/lyricue-sidecar")
        }
    })

    it("throws SidecarLifecycleError with user-friendly message when the binary is missing", () => {
        try {
            resolveSidecarLaunch({
                appPath: "/Applications/LyriCue.app/Contents/Resources/app",
                nodeEnv: "production",
                platform: "darwin",
                arch: "arm64",
                exists: () => false
            })
            throw new Error("should have thrown")
        } catch (err) {
            expect(err).toBeInstanceOf(SidecarLifecycleError)
            expect((err as Error).message).toMatch(/please reinstall LyriCue/)
            expect((err as Error).message).toMatch(/darwin-arm64/)
        }
    })
})
