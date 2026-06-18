import type { TimingMap } from "../types/timing-map.js"

export interface PhraseIndexEntry {
    phrase: string[]
    sectionId: string
    slideIndex: number
    wordIndex: number
    globalWordOrdinal: number
    refMs: number
}

export interface PhraseIndex {
    windowSize: number
    totalWords: number
    entries: PhraseIndexEntry[]
}

export interface PhraseMatch extends PhraseIndexEntry {
    confidence: number
    recognizedWords: string[]
}

export interface PhraseMatchContext {
    sectionId?: string
    globalWordOrdinal?: number
    requireDifferentSection?: boolean
}

export function buildPhraseIndex(map: TimingMap, windowSize = 3): PhraseIndex {
    const entries: PhraseIndexEntry[] = []
    let globalWordOrdinal = 0
    for (const section of map.sections) {
        for (let wordIndex = 0; wordIndex <= section.words.length - windowSize; wordIndex++) {
            const words = section.words.slice(wordIndex, wordIndex + windowSize)
            entries.push({
                phrase: words.map((word) => normalizeWord(word.text)).filter(Boolean),
                sectionId: section.id,
                slideIndex: section.slideIndex,
                wordIndex,
                globalWordOrdinal: globalWordOrdinal + wordIndex,
                refMs: words[0]?.startMs ?? section.startMs
            })
        }
        globalWordOrdinal += section.words.length
    }
    return { windowSize, totalWords: globalWordOrdinal, entries }
}

export function findPhraseMatch(
    index: PhraseIndex,
    recognizedText: string,
    context: PhraseMatchContext = {}
): PhraseMatch | null {
    const words = tokenize(recognizedText)
    if (words.length < index.windowSize) return null
    const candidates: PhraseMatch[] = []
    for (let i = 0; i <= words.length - index.windowSize; i++) {
        const window = words.slice(i, i + index.windowSize)
        for (const entry of index.entries) {
            if (context.requireDifferentSection && context.sectionId === entry.sectionId) continue
            const confidence = phraseConfidence(window, entry.phrase)
            if (confidence >= 0.75) candidates.push({ ...entry, confidence, recognizedWords: window })
        }
    }
    if (candidates.length === 0) return null
    return candidates.sort((a, b) => {
        const jumpA = forwardJump(a.globalWordOrdinal, context.globalWordOrdinal, index.totalWords)
        const jumpB = forwardJump(b.globalWordOrdinal, context.globalWordOrdinal, index.totalWords)
        if (jumpA !== jumpB) return jumpA - jumpB
        return b.confidence - a.confidence
    })[0]!
}

export function phraseConfidence(recognized: string[], expected: string[]): number {
    if (recognized.length !== expected.length || recognized.length === 0) return 0
    let total = 0
    for (let i = 0; i < expected.length; i++) {
        const score = levenshteinSimilarity(recognized[i] ?? "", expected[i] ?? "")
        if (score < 0.75) return 0
        total += score
    }
    return total / expected.length
}

export function levenshteinSimilarity(a: string, b: string): number {
    const left = normalizeWord(a)
    const right = normalizeWord(b)
    if (left === right) return 1
    if (left.length === 0 || right.length === 0) return 0
    const distance = levenshteinDistance(left, right)
    return 1 - distance / Math.max(left.length, right.length)
}

function tokenize(input: string): string[] {
    return input.split(/\s+/g).map(normalizeWord).filter(Boolean)
}

function normalizeWord(input: string): string {
    // NFD (canonical decomposition) separates accented characters into base letter +
    // combining diacritic (e.g. "é" → "e" + U+0301). Stripping U+0300–U+036F leaves
    // the base letter intact. This is the standard "fold-to-ASCII" recipe and is
    // essential for LyriCue's South African worship market: Zulu, Afrikaans, French,
    // and Spanish lyrics all carry diacritics, and STT often emits the unaccented
    // form for accented input. Without folding, "élève" → "lve" and never matches.
    return input
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/[^a-z0-9]+/g, "")
}

function forwardJump(target: number, current: number | undefined, totalWords: number): number {
    if (current === undefined || totalWords <= 0) return target
    if (target >= current) return target - current
    return totalWords - current + target
}

function levenshteinDistance(a: string, b: string): number {
    const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
    const curr = Array.from({ length: b.length + 1 }, () => 0)
    for (let i = 1; i <= a.length; i++) {
        curr[0] = i
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1
            curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost)
        }
        for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!
    }
    return prev[b.length]!
}
