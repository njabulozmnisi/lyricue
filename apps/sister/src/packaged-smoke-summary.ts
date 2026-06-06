export interface PackagedSisterSmokeSummary {
    status: "pass" | "fail"
    smokePassed: boolean
    smokeFailures: string[]
    packagedAppLoaded: boolean
    operatorPersistencePassed: boolean
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
    const sidecarStarted = log.includes("sidecar: [lyricue-sidecar:INFO] server loop started")
    const segmentationReady = log.includes('"stage":"segments_ready"')
    const capturedApproved = log.includes('"status":"captured-approved"')
    const sourcePythonFallback = log.includes("No usable Python interpreter found")
    const status = smokePassed && smokeFailures.length === 0 && packagedAppLoaded && operatorPersistencePassed && sidecarStarted && segmentationReady && capturedApproved && !sourcePythonFallback ? "pass" : "fail"

    return {
        status,
        smokePassed,
        smokeFailures,
        packagedAppLoaded,
        operatorPersistencePassed,
        sidecarStarted,
        segmentationReady,
        capturedApproved,
        sourcePythonFallback
    }
}
