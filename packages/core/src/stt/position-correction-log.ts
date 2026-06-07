import { appendFile, mkdir, readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import type { TimingMap } from "../types/timing-map.js"
import type { PositionCorrectionDecision } from "./live-position-corrector.js"
import type { SttTranscript } from "./rolling-window-transcriber.js"

export interface PositionCorrectionLogEntry {
    timestamp: string
    showId: string
    recognizedText: string
    confidence: number
    from: {
        sectionId: string | null
        slideIndex: number
        wordIndex: number
        refMs: number
    }
    to: {
        sectionId: string
        slideIndex: number
        wordIndex: number
        refMs: number
    }
}

export interface AppendPositionCorrectionLogOptions {
    logsDir: string
    entry: PositionCorrectionLogEntry
}

export interface PrunePositionCorrectionLogsOptions {
    logsDir: string
    now?: Date
    retentionDays?: number
}

export interface CreatePositionCorrectionLogEntryOptions {
    map: TimingMap
    decision: PositionCorrectionDecision
    transcript: SttTranscript
    timestamp?: Date
}

const POSITION_LOG_RE = /^positions-(\d{4}-\d{2}-\d{2})\.jsonl$/

export function createPositionCorrectionLogEntry(options: CreatePositionCorrectionLogEntryOptions): PositionCorrectionLogEntry {
    return {
        timestamp: (options.timestamp ?? new Date()).toISOString(),
        showId: options.map.showId,
        recognizedText: options.transcript.text,
        confidence: normalizeConfidence(options.transcript.confidence),
        from: {
            sectionId: options.decision.from.sectionId,
            slideIndex: options.decision.from.slideIndex,
            wordIndex: options.decision.from.wordIndex,
            refMs: options.decision.from.refMs
        },
        to: {
            sectionId: options.decision.to.sectionId,
            slideIndex: options.decision.to.slideIndex,
            wordIndex: options.decision.to.wordIndex,
            refMs: options.decision.to.refMs
        }
    }
}

export async function appendPositionCorrectionLog(options: AppendPositionCorrectionLogOptions): Promise<string> {
    await mkdir(options.logsDir, { recursive: true })
    const filePath = positionCorrectionLogPath(options.logsDir, new Date(options.entry.timestamp))
    await appendFile(filePath, JSON.stringify(options.entry) + "\n", "utf8")
    return filePath
}

export async function prunePositionCorrectionLogs(options: PrunePositionCorrectionLogsOptions): Promise<string[]> {
    const now = options.now ?? new Date()
    const retentionDays = options.retentionDays ?? 30
    const cutoff = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - retentionDays * 24 * 60 * 60 * 1000
    let files: string[]
    try {
        files = await readdir(options.logsDir)
    } catch {
        return []
    }

    const removed: string[] = []
    for (const file of files) {
        const match = POSITION_LOG_RE.exec(file)
        if (!match) continue
        const date = Date.parse(`${match[1]}T00:00:00.000Z`)
        if (Number.isFinite(date) && date < cutoff) {
            const filePath = join(options.logsDir, file)
            await rm(filePath, { force: true })
            removed.push(filePath)
        }
    }
    return removed
}

export function positionCorrectionLogPath(logsDir: string, date: Date): string {
    return join(logsDir, `positions-${date.toISOString().slice(0, 10)}.jsonl`)
}

function normalizeConfidence(confidence: number): number {
    if (!Number.isFinite(confidence)) return 0
    return Math.max(0, Math.min(1, confidence))
}
