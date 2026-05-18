/**
 * TimingMap, Arrangement, ParallelLyricsTrack — type definitions only.
 *
 * Per architecture.md §6.1 / §6.2 and FR1 (Song Learning Pipeline) / FR9 (Arrangement
 * Builder) / FR10 (Parallel Lyrics). The full Zod runtime validators and persistence
 * (TimingMapStorage with atomic writes) land in **EP-03 STORY-03.1 → 03.5**.
 *
 * Why these live in core *now*, ahead of their owning epic:
 *   - EP-02's OutputAdapter pushes `LoadMapPayload` which references TimingMap + Arrangement
 *     + ParallelLyricsTrack. Without these types, OutputAdapter can't compile.
 *   - Defining the shape now lets the walking-skeleton demo work with synthetic data and
 *     fail-fast if EP-03's eventual schema diverges from this contract.
 *
 * Stability contract: this file is the canonical TS shape for the schema. EP-03 must add
 * a Zod schema and validators that exactly match these types — when they diverge, EP-03's
 * Zod definitions win and these types update.
 */

import { SCHEMA_LYRICUE_TIMING_V1 } from "./schema-versions.js"

/**
 * Per-word timing record. Confidence is null when WhisperX could not align this word —
 * the renderer should display the word at-rest (no sweep) and surface the word in the
 * Timing Preview UI (EP-11 STORY-11.7) for manual adjustment.
 */
export interface TimingWord {
    text: string
    startMs: number
    endMs: number
    confidence: number | null
    lineIndex: number
    /** Derived in EP-05 STORY-05.5: true when endMs - startMs > 800ms. Drives KR's pulse animation. */
    held?: boolean
}

/**
 * Line boundary within a section. `wordEndIndex` is exclusive.
 * Computed by EP-05 STORY-05.5 from `\n` boundaries in the input lyrics.
 */
export interface TimingLine {
    startMs: number
    endMs: number
    wordStartIndex: number
    wordEndIndex: number
}

export type TimingSectionType = "verse" | "chorus" | "bridge" | "pre-chorus" | "tag" | "intro" | "outro" | "other"

export interface TimingSection {
    /** Stable section ID — e.g., "verse1". References by ArrangementStep.sectionId. */
    id: string
    type: TimingSectionType
    /** Human-readable label, e.g. "Verse 1". */
    label: string
    /** Index into the FreeShow slide layout for the show. */
    slideIndex: number
    startMs: number
    endMs: number
    words: TimingWord[]
    lines: TimingLine[]
}

export type LearnedFromMethod = "studio" | "rehearsal" | "imported"

export interface TimingMapLearnedFrom {
    method: LearnedFromMethod
    /** Present for "studio" and "rehearsal"; absent for "imported". */
    filename?: string
    /** Source audio length in seconds. */
    duration: number
    /** ISO-8601 timestamp. */
    learnedAt: string
    /** For "imported": provenance string, e.g. "Hillside Library v1.2". */
    source?: string
}

export interface TimingMapMetadata {
    demucsModel?: string
    whisperxModel?: string
    /** Always "1" while we're on lyricue-timing-v1. */
    schemaVersion: "1"
    /**
     * Semver of THIS timing map's content — bumped on re-learn or manual edit (FR11.9).
     * Distinct from the schema version: schemaVersion tracks the file format, version
     * tracks the data revision.
     */
    version: string
}

export interface TimingMap {
    $schema: typeof SCHEMA_LYRICUE_TIMING_V1
    /** Foreign key to FreeShow Show.id. Stable across renames. */
    showId: string
    learnedFrom: TimingMapLearnedFrom
    /** Reference BPM detected from the original mix. Used for tempo-ratio scaling at runtime. */
    bpm: number
    /** Optional, e.g. "4/4", "3/4", "6/8". Best-effort detection. */
    timeSignature?: string
    /** BCP-47 code, e.g. "en", "zu-ZA". */
    language: string
    sections: TimingSection[]
    /** Optional section-level translation tracks (FR10). */
    parallel?: ParallelLyricsTrack[]
    metadata: TimingMapMetadata
}

/**
 * Arrangement (FR9). A named sequence of section references through a song —
 * e.g. "Sunday Morning" arrangement reorders or repeats sections from the timing map.
 */
export interface ArrangementStep {
    /** References TimingMap.sections[].id. Duplicates allowed: chorus may appear 3+ times. */
    sectionId: string
}

export interface Arrangement {
    /** Stable arrangement ID — e.g. "sunday-morning". */
    id: string
    name: string
    showId: string
    isDefault: boolean
    sequence: ArrangementStep[]
    /** ISO-8601. */
    createdAt: string
    /** ISO-8601. */
    updatedAt: string
}

/**
 * Parallel lyric track (FR10). Maps each section in the primary TimingMap to translated
 * text. The translation does NOT have word-level timing — word counts differ between
 * languages — it advances section-by-section in sync with the primary (architecture §4.9).
 */
export interface ParallelLyricsTrack {
    /** BCP-47 language code, e.g. "zu-ZA". */
    language: string
    sections: ParallelLyricsSection[]
}

export interface ParallelLyricsSection {
    /** Matches TimingSection.id in the primary TimingMap. */
    sectionId: string
    /** Raw translated text. Line breaks preserved via "\n". */
    text: string
}
