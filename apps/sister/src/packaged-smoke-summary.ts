export interface PackagedSisterSmokeSummary {
    status: "pass" | "fail"
    smokePassed: boolean
    smokeFailures: string[]
    packagedAppLoaded: boolean
    operatorPersistencePassed: boolean
    operatorSettingsOverlayCaptured: boolean
    operatorPublishDialogCaptured: boolean
    operatorProjectSourceCaptured: boolean
    operatorSettingsBridgePassed: boolean
    operatorCredentialBridgePassed: boolean
    staleOperatorPayloadsGuarded: boolean
    sidecarStarted: boolean
    segmentationReady: boolean
    capturedApproved: boolean
    sourcePythonFallback: boolean
}

export function parsePackagedSisterSmokeLog(log: string): PackagedSisterSmokeSummary {
    const smokeFailures = Array.from(log.matchAll(/\[smoke\] FAIL [^\n\r]+/g)).map((match) => match[0])
    const smokePassed = log.includes("[smoke] complete: pass")
    const packagedAppLoaded = log.includes("Contents/Resources/app.asar")
    const operatorPersistencePassed = log.includes("operator persistence exercise result=persisted")
    const operatorSettingsOverlayCaptured = log.includes("08-settings-overlay-operator.png")
    const operatorPublishDialogCaptured = log.includes("09-publish-dialog-operator.png")
    const operatorProjectSourceCaptured = log.includes("10-project-source-picker-operator.png")
    const operatorSettingsBridgePassed = log.includes('"status":"settings-bridge-persisted"')
    const operatorCredentialBridgePassed = log.includes('"status":"credential-bridge-secure"')
    const staleOperatorPayloadsGuarded = log.includes('"status":"stale-payloads-guarded"')
    const sidecarStarted = log.includes("sidecar: [lyricue-sidecar:INFO] server loop started")
    const segmentationReady = log.includes('"stage":"segments_ready"')
    const capturedApproved = log.includes('"status":"captured-approved"')
    const sourcePythonFallback = log.includes("No usable Python interpreter found")
    const status = smokePassed && smokeFailures.length === 0 && packagedAppLoaded && operatorPersistencePassed && operatorSettingsOverlayCaptured && operatorPublishDialogCaptured && operatorProjectSourceCaptured && operatorSettingsBridgePassed && operatorCredentialBridgePassed && staleOperatorPayloadsGuarded && sidecarStarted && segmentationReady && capturedApproved && !sourcePythonFallback ? "pass" : "fail"

    return {
        status,
        smokePassed,
        smokeFailures,
        packagedAppLoaded,
        operatorPersistencePassed,
        operatorSettingsOverlayCaptured,
        operatorPublishDialogCaptured,
        operatorProjectSourceCaptured,
        operatorSettingsBridgePassed,
        operatorCredentialBridgePassed,
        staleOperatorPayloadsGuarded,
        sidecarStarted,
        segmentationReady,
        capturedApproved,
        sourcePythonFallback
    }
}
