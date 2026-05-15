/**
 * Hardcoded demo TimingMap used by the walking-skeleton runners (STORY-02.4).
 *
 * The map represents a short demo phrase — twelve words at 500ms each — that the demo
 * runners replay in a loop to prove the OutputAdapter abstraction works end-to-end
 * with real timing data, not just synthetic frames. Distinct from the fixture in
 * `sync-frame-fixture.ts` which generates *frames* directly; this one is the upstream
 * *map* the (fake) Sync Engine walks through.
 *
 * The phrase is intentionally a neutral demo string ("Hello world this is LyriCue running")
 * — not a song. Real worship lyrics arrive via the song-learning pipeline (EP-05) and
 * are persisted via TimingMapStorage (EP-03 STORY-03.3). This map is for visual demos
 * and integration tests only.
 */

import type { TimingMap, TimingSection, TimingWord, TimingLine } from "../types/timing-map.js"
import { SCHEMA_LYRICUE_TIMING_V1 } from "../types/schema-versions.js"

const MS_PER_WORD = 500
const WORDS = ["Hello", "world", "this", "is", "LyriCue", "running", "end", "to", "end", "in", "demo", "mode"]

function word(text: string, index: number, lineIndex: number): TimingWord {
    const base: TimingWord = {
        text,
        startMs: index * MS_PER_WORD,
        endMs: (index + 1) * MS_PER_WORD,
        confidence: 1.0,
        lineIndex
    }
    return base
}

function line(startWord: number, endWord: number, lineIndex: number): TimingLine {
    return {
        startMs: startWord * MS_PER_WORD,
        endMs: endWord * MS_PER_WORD,
        wordStartIndex: startWord,
        wordEndIndex: endWord
    }
}

const words: TimingWord[] = WORDS.map((text, i) => {
    // Two lines for visual variety: "Hello world this is" / "LyriCue running end to end in demo mode"
    const lineIndex = i < 4 ? 0 : 1
    return word(text, i, lineIndex)
})

const lines: TimingLine[] = [line(0, 4, 0), line(4, WORDS.length, 1)]

const introSection: TimingSection = {
    id: "demo-1",
    type: "verse",
    label: "Demo",
    slideIndex: 0,
    startMs: 0,
    endMs: WORDS.length * MS_PER_WORD,
    words,
    lines
}

/**
 * The exported demo map. Total duration = `WORDS.length * MS_PER_WORD` = 6 seconds at 12 words.
 * The (fake) Sync Engine in the demo runner advances `cursorRefTime` by 500ms each tick
 * (configurable) and loops on reaching the end.
 */
export const DEMO_TIMING_MAP: TimingMap = {
    $schema: SCHEMA_LYRICUE_TIMING_V1,
    showId: "lyricue-demo-walking-skeleton",
    learnedFrom: {
        method: "studio",
        duration: (WORDS.length * MS_PER_WORD) / 1000,
        learnedAt: "2026-05-14T00:00:00.000Z",
        source: "hardcoded demo for STORY-02.4"
    },
    bpm: 120,
    timeSignature: "4/4",
    language: "en",
    sections: [introSection],
    metadata: {
        schemaVersion: "1",
        version: "0.1.0"
    }
}

/** Convenience constants for demo runners that want to mirror the map's geometry. */
export const DEMO_MAP_TOTAL_DURATION_MS = WORDS.length * MS_PER_WORD
export const DEMO_MAP_MS_PER_WORD = MS_PER_WORD
export const DEMO_MAP_WORDS = WORDS
