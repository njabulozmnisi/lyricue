import type { SyncEvent } from "../sync/sync-engine-state.js"
import type { TimingMap } from "../types/timing-map.js"
import { buildPhraseIndex, findPhraseMatch, type PhraseIndex, type PhraseMatch } from "./phrase-matcher.js"

export interface PositionCorrectionContext {
    currentSectionId?: string
    currentSlideIndex: number
    currentWordIndex: number
    currentRefMs: number
}

export interface PositionCorrectionDecision {
    event: Extract<SyncEvent, { kind: "positionCorrection" }>
    match: PhraseMatch
    from: {
        sectionId: string | null
        slideIndex: number
        wordIndex: number
        refMs: number
        globalWordOrdinal: number | null
    }
    to: {
        sectionId: string
        slideIndex: number
        wordIndex: number
        refMs: number
        globalWordOrdinal: number
    }
}

export interface EvaluatePositionCorrectionOptions {
    map: TimingMap
    phraseIndex?: PhraseIndex
    recognizedText: string
    context: PositionCorrectionContext
    wallTime: number
    sttEnabled: boolean
    minWords?: number
    requireDifferentSection?: boolean
}

export function evaluatePositionCorrection(options: EvaluatePositionCorrectionOptions): PositionCorrectionDecision | null {
    if (!options.sttEnabled) return null
    const minWords = Math.max(1, Math.floor(options.minWords ?? 3))
    if (countWords(options.recognizedText) < minWords) return null

    const current = resolveCurrentPhraseContext(options.map, options.context)
    const index = options.phraseIndex ?? buildPhraseIndex(options.map, minWords)
    const match = findPhraseMatch(index, options.recognizedText, {
        ...(current.sectionId ? { sectionId: current.sectionId } : {}),
        ...(current.globalWordOrdinal !== null ? { globalWordOrdinal: current.globalWordOrdinal } : {}),
        requireDifferentSection: options.requireDifferentSection ?? true
    })
    if (!match) return null

    return {
        event: { kind: "positionCorrection", targetRefMs: match.refMs, wallTime: options.wallTime },
        match,
        from: current,
        to: {
            sectionId: match.sectionId,
            slideIndex: match.slideIndex,
            wordIndex: match.wordIndex,
            refMs: match.refMs,
            globalWordOrdinal: match.globalWordOrdinal
        }
    }
}

export function resolveCurrentPhraseContext(map: TimingMap, context: PositionCorrectionContext): PositionCorrectionDecision["from"] {
    let ordinal = 0
    for (const section of map.sections) {
        const sectionMatches = context.currentSectionId ? section.id === context.currentSectionId : section.slideIndex === context.currentSlideIndex
        if (sectionMatches) {
            return {
                sectionId: section.id,
                slideIndex: section.slideIndex,
                wordIndex: context.currentWordIndex,
                refMs: context.currentRefMs,
                globalWordOrdinal: ordinal + Math.max(0, Math.min(context.currentWordIndex, Math.max(0, section.words.length - 1)))
            }
        }
        ordinal += section.words.length
    }
    return {
        sectionId: null,
        slideIndex: context.currentSlideIndex,
        wordIndex: context.currentWordIndex,
        refMs: context.currentRefMs,
        globalWordOrdinal: null
    }
}

function countWords(input: string): number {
    return input.split(/\s+/g).map((word) => word.trim()).filter(Boolean).length
}
