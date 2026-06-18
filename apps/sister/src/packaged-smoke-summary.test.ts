import { describe, expect, it } from "vitest"
import { parsePackagedSisterSmokeLog } from "./packaged-smoke-summary.js"

describe("parsePackagedSisterSmokeLog", () => {
    it("passes only when the packaged app, smoke harness, and bundled sidecar boundary all pass", () => {
        const summary = parsePackagedSisterSmokeLog(`
            file:///Example/LyriCue.app/Contents/Resources/app.asar/public/build/karaoke-output.bundle.js
            [lyricue:sister] [capture] wrote /tmp/ep10-operator-window-2026-05-15/08-settings-overlay-operator.png
            [lyricue:sister] [capture] wrote /tmp/ep10-operator-window-2026-05-15/09-publish-dialog-operator.png
            [lyricue:sister] [capture] wrote /tmp/ep10-operator-window-2026-05-15/10-project-source-picker-operator.png
            [lyricue:sister] [capture] operator persistence exercise result=persisted
            [lyricue:sister] [capture] operator settings bridge result={"status":"settings-bridge-persisted"}
            [lyricue:sister] [capture] stale operator payload guard result={"status":"stale-payloads-guarded"}
            [lyricue:sister] sidecar: [lyricue-sidecar:INFO] server loop started; 7 handlers registered
            [lyricue:sister] [capture] rehearsal capture exercise result={"status":"captured-approved","stopped":{"segmentation":{"stage":"segments_ready"}}}
            [lyricue:sister] [smoke] complete: pass
        `)

        expect(summary.status).toBe("pass")
        expect(summary.operatorSettingsOverlayCaptured).toBe(true)
        expect(summary.operatorPublishDialogCaptured).toBe(true)
        expect(summary.operatorProjectSourceCaptured).toBe(true)
        expect(summary.operatorSettingsBridgePassed).toBe(true)
        expect(summary.staleOperatorPayloadsGuarded).toBe(true)
        expect(summary.sidecarStarted).toBe(true)
        expect(summary.segmentationReady).toBe(true)
        expect(summary.sourcePythonFallback).toBe(false)
    })

    it("fails when the packaged host falls back to source Python", () => {
        const summary = parsePackagedSisterSmokeLog(`
            file:///Example/LyriCue.app/Contents/Resources/app.asar/public/build/karaoke-output.bundle.js
            [lyricue:sister] [capture] wrote /tmp/ep10-operator-window-2026-05-15/08-settings-overlay-operator.png
            [lyricue:sister] [capture] wrote /tmp/ep10-operator-window-2026-05-15/09-publish-dialog-operator.png
            [lyricue:sister] [capture] wrote /tmp/ep10-operator-window-2026-05-15/10-project-source-picker-operator.png
            [lyricue:sister] [capture] operator persistence exercise result=persisted
            [lyricue:sister] [capture] operator settings bridge result={"status":"settings-bridge-persisted"}
            [lyricue:sister] [capture] stale operator payload guard result={"status":"stale-payloads-guarded"}
            [lyricue:sister] [capture] rehearsal capture exercise result={"status":"captured-error","stopped":{"segmentation":{"error":"No usable Python interpreter found. Tried: python3, python"}}}
            [lyricue:sister] [smoke] complete: pass
        `)

        expect(summary.status).toBe("fail")
        expect(summary.sourcePythonFallback).toBe(true)
        expect(summary.sidecarStarted).toBe(false)
    })

    it("fails when the stale operator payload guard did not run", () => {
        const summary = parsePackagedSisterSmokeLog(`
            file:///Example/LyriCue.app/Contents/Resources/app.asar/public/build/karaoke-output.bundle.js
            [lyricue:sister] [capture] wrote /tmp/ep10-operator-window-2026-05-15/08-settings-overlay-operator.png
            [lyricue:sister] [capture] wrote /tmp/ep10-operator-window-2026-05-15/09-publish-dialog-operator.png
            [lyricue:sister] [capture] wrote /tmp/ep10-operator-window-2026-05-15/10-project-source-picker-operator.png
            [lyricue:sister] [capture] operator persistence exercise result=persisted
            [lyricue:sister] [capture] operator settings bridge result={"status":"settings-bridge-persisted"}
            [lyricue:sister] sidecar: [lyricue-sidecar:INFO] server loop started; 7 handlers registered
            [lyricue:sister] [capture] rehearsal capture exercise result={"status":"captured-approved","stopped":{"segmentation":{"stage":"segments_ready"}}}
            [lyricue:sister] [smoke] complete: pass
        `)

        expect(summary.status).toBe("fail")
        expect(summary.staleOperatorPayloadsGuarded).toBe(false)
    })

    it("fails when the settings bridge smoke did not run", () => {
        const summary = parsePackagedSisterSmokeLog(`
            file:///Example/LyriCue.app/Contents/Resources/app.asar/public/build/karaoke-output.bundle.js
            [lyricue:sister] [capture] wrote /tmp/ep10-operator-window-2026-05-15/08-settings-overlay-operator.png
            [lyricue:sister] [capture] wrote /tmp/ep10-operator-window-2026-05-15/09-publish-dialog-operator.png
            [lyricue:sister] [capture] wrote /tmp/ep10-operator-window-2026-05-15/10-project-source-picker-operator.png
            [lyricue:sister] [capture] operator persistence exercise result=persisted
            [lyricue:sister] [capture] stale operator payload guard result={"status":"stale-payloads-guarded"}
            [lyricue:sister] sidecar: [lyricue-sidecar:INFO] server loop started; 7 handlers registered
            [lyricue:sister] [capture] rehearsal capture exercise result={"status":"captured-approved","stopped":{"segmentation":{"stage":"segments_ready"}}}
            [lyricue:sister] [smoke] complete: pass
        `)

        expect(summary.status).toBe("fail")
        expect(summary.operatorSettingsBridgePassed).toBe(false)
    })

    it("fails when the Settings overlay screenshot was not captured", () => {
        const summary = parsePackagedSisterSmokeLog(`
            file:///Example/LyriCue.app/Contents/Resources/app.asar/public/build/karaoke-output.bundle.js
            [lyricue:sister] [capture] operator persistence exercise result=persisted
            [lyricue:sister] [capture] wrote /tmp/ep10-operator-window-2026-05-15/09-publish-dialog-operator.png
            [lyricue:sister] [capture] wrote /tmp/ep10-operator-window-2026-05-15/10-project-source-picker-operator.png
            [lyricue:sister] [capture] operator settings bridge result={"status":"settings-bridge-persisted"}
            [lyricue:sister] [capture] stale operator payload guard result={"status":"stale-payloads-guarded"}
            [lyricue:sister] sidecar: [lyricue-sidecar:INFO] server loop started; 7 handlers registered
            [lyricue:sister] [capture] rehearsal capture exercise result={"status":"captured-approved","stopped":{"segmentation":{"stage":"segments_ready"}}}
            [lyricue:sister] [smoke] complete: pass
        `)

        expect(summary.status).toBe("fail")
        expect(summary.operatorSettingsOverlayCaptured).toBe(false)
    })

    it("fails when the Publish dialog screenshot was not captured", () => {
        const summary = parsePackagedSisterSmokeLog(`
            file:///Example/LyriCue.app/Contents/Resources/app.asar/public/build/karaoke-output.bundle.js
            [lyricue:sister] [capture] wrote /tmp/ep10-operator-window-2026-05-15/08-settings-overlay-operator.png
            [lyricue:sister] [capture] wrote /tmp/ep10-operator-window-2026-05-15/10-project-source-picker-operator.png
            [lyricue:sister] [capture] operator persistence exercise result=persisted
            [lyricue:sister] [capture] operator settings bridge result={"status":"settings-bridge-persisted"}
            [lyricue:sister] [capture] stale operator payload guard result={"status":"stale-payloads-guarded"}
            [lyricue:sister] sidecar: [lyricue-sidecar:INFO] server loop started; 7 handlers registered
            [lyricue:sister] [capture] rehearsal capture exercise result={"status":"captured-approved","stopped":{"segmentation":{"stage":"segments_ready"}}}
            [lyricue:sister] [smoke] complete: pass
        `)

        expect(summary.status).toBe("fail")
        expect(summary.operatorPublishDialogCaptured).toBe(false)
    })

    it("fails when the Project Source picker screenshot was not captured", () => {
        const summary = parsePackagedSisterSmokeLog(`
            file:///Example/LyriCue.app/Contents/Resources/app.asar/public/build/karaoke-output.bundle.js
            [lyricue:sister] [capture] wrote /tmp/ep10-operator-window-2026-05-15/08-settings-overlay-operator.png
            [lyricue:sister] [capture] wrote /tmp/ep10-operator-window-2026-05-15/09-publish-dialog-operator.png
            [lyricue:sister] [capture] operator persistence exercise result=persisted
            [lyricue:sister] [capture] operator settings bridge result={"status":"settings-bridge-persisted"}
            [lyricue:sister] [capture] stale operator payload guard result={"status":"stale-payloads-guarded"}
            [lyricue:sister] sidecar: [lyricue-sidecar:INFO] server loop started; 7 handlers registered
            [lyricue:sister] [capture] rehearsal capture exercise result={"status":"captured-approved","stopped":{"segmentation":{"stage":"segments_ready"}}}
            [lyricue:sister] [smoke] complete: pass
        `)

        expect(summary.status).toBe("fail")
        expect(summary.operatorProjectSourceCaptured).toBe(false)
    })

    it("preserves smoke failure lines for release artifacts", () => {
        const summary = parsePackagedSisterSmokeLog("[lyricue:sister] [smoke] FAIL rehearsal capture exercise: bad\n")

        expect(summary.status).toBe("fail")
        expect(summary.smokeFailures).toEqual(["[smoke] FAIL rehearsal capture exercise: bad"])
    })
})
