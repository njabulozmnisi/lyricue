export interface RehearsalSegmentForUi {
    index: number
    showId?: string | null
    title?: string | null
    status: "matched" | "review" | "failed"
    confidence?: number
    startSec?: number
    endSec?: number
    sourceAudioPath?: string | null
}

export function normalizeRehearsalSegments(value: unknown, sourceAudioPath: string | null): RehearsalSegmentForUi[] {
    if (!value || typeof value !== "object") return []
    const row = value as Record<string, unknown>
    const maybeSegments = row.segments
    if (!Array.isArray(maybeSegments)) {
        const error = readString(row.error)
        return error ? [fallbackSegment(`Segmentation failed: ${error}`, sourceAudioPath, "failed")] : []
    }
    if (maybeSegments.length === 0) {
        const error = readString(row.error)
        if (error) return [fallbackSegment(`Segmentation failed: ${error}`, sourceAudioPath, "failed")]
        const audio = row.audio && typeof row.audio === "object" ? (row.audio as Record<string, unknown>) : null
        const duration = typeof audio?.durationSeconds === "number" && Number.isFinite(audio.durationSeconds) ? audio.durationSeconds : null
        const title = duration ? `No song segments detected in ${formatSeconds(duration)} recording` : "No song segments detected"
        return [fallbackSegment(title, sourceAudioPath, "review")]
    }
    return maybeSegments.map((segment, fallbackIndex): RehearsalSegmentForUi => {
        const segmentRow = segment && typeof segment === "object" ? (segment as Record<string, unknown>) : {}
        const status = segmentRow.status === "matched" || segmentRow.status === "review" || segmentRow.status === "failed" ? segmentRow.status : "failed"
        return {
            index: typeof segmentRow.index === "number" && Number.isFinite(segmentRow.index) ? segmentRow.index : fallbackIndex,
            showId: readString(segmentRow.showId),
            title: readString(segmentRow.title) ?? `Segment ${fallbackIndex + 1}`,
            status,
            ...(finiteNumber(segmentRow.startSec) ? { startSec: segmentRow.startSec } : {}),
            ...(finiteNumber(segmentRow.endSec) ? { endSec: segmentRow.endSec } : {}),
            ...(sourceAudioPath ? { sourceAudioPath } : {}),
            ...(finiteNumber(segmentRow.confidence) ? { confidence: segmentRow.confidence } : {})
        }
    })
}

function fallbackSegment(title: string, sourceAudioPath: string | null, status: "review" | "failed"): RehearsalSegmentForUi {
    return {
        index: 0,
        title,
        status,
        confidence: 0,
        ...(sourceAudioPath ? { sourceAudioPath } : {})
    }
}

function readString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value : null
}

function finiteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value)
}

function formatSeconds(value: number): string {
    if (value < 60) return `${Math.round(value)}s`
    const minutes = Math.floor(value / 60)
    const seconds = Math.round(value % 60).toString().padStart(2, "0")
    return `${minutes}:${seconds}`
}
