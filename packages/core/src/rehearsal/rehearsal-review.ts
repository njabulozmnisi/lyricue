import type { TimingMap, TimingSection, TimingLine, TimingWord } from "../types/timing-map.js"

export interface RehearsalReviewSegment {
    showId: string
    startSec: number
    endSec: number
    sourceAudioPath?: string
}

export interface BuildRehearsalTimingMapVariantOptions {
    baseMap: TimingMap
    segment: RehearsalReviewSegment
    skippedWordKeys?: Iterable<string>
    learnedAt?: string
    sourceFilename?: string
}

export function wordReviewKey(sectionId: string, wordIndex: number): string {
    return `${sectionId}:${wordIndex}`
}

export function buildRehearsalTimingMapVariant(opts: BuildRehearsalTimingMapVariantOptions): TimingMap {
    const startMs = finiteNonNegative(opts.segment.startSec) * 1000
    const endMs = finiteNonNegative(opts.segment.endSec) * 1000
    const targetDurationMs = Math.max(1, endMs - startMs)
    const baseDurationMs = Math.max(1, maxMapEndMs(opts.baseMap))
    const scale = targetDurationMs / baseDurationMs
    const skipped = new Set(opts.skippedWordKeys ?? [])

    return {
        ...opts.baseMap,
        learnedFrom: {
            method: "rehearsal",
            ...(opts.sourceFilename ? { filename: opts.sourceFilename } : {}),
            duration: targetDurationMs / 1000,
            learnedAt: opts.learnedAt ?? new Date().toISOString()
        },
        sections: opts.baseMap.sections.map((section) => scaleSection(section, scale, skipped)),
        metadata: {
            ...opts.baseMap.metadata,
            version: nextRehearsalVersion(opts.baseMap.metadata.version)
        }
    }
}

function scaleSection(section: TimingSection, scale: number, skipped: Set<string>): TimingSection {
    return {
        ...section,
        startMs: scaleMs(section.startMs, scale),
        endMs: scaleMs(section.endMs, scale),
        lines: section.lines.map((line) => scaleLine(line, scale)),
        words: section.words.map((word, index) => scaleWord(section.id, word, index, scale, skipped))
    }
}

function scaleLine(line: TimingLine, scale: number): TimingLine {
    return {
        ...line,
        startMs: scaleMs(line.startMs, scale),
        endMs: scaleMs(line.endMs, scale)
    }
}

function scaleWord(sectionId: string, word: TimingWord, index: number, scale: number, skipped: Set<string>): TimingWord {
    const next: TimingWord = {
        ...word,
        startMs: scaleMs(word.startMs, scale),
        endMs: scaleMs(word.endMs, scale),
        confidence: skipped.has(wordReviewKey(sectionId, index)) ? null : word.confidence
    }
    return next
}

function scaleMs(value: number, scale: number): number {
    return Math.max(0, Math.round(value * scale))
}

function finiteNonNegative(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0
}

function maxMapEndMs(map: TimingMap): number {
    return Math.max(
        1,
        ...map.sections.flatMap((section) => [
            section.endMs,
            ...section.words.map((word) => word.endMs),
            ...section.lines.map((line) => line.endMs)
        ])
    )
}

function nextRehearsalVersion(version: string): string {
    return version.includes("+rehearsal") ? version : `${version}+rehearsal`
}
