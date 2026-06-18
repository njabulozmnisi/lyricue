/**
 * Adversarial tests for the phrase matcher's normalization.
 *
 * LyriCue serves a South African worship-music market; lyrics commonly include Zulu,
 * Afrikaans, French, and Spanish text with diacritics (é, ñ, ü) and apostrophes (u'thando).
 * The current normalizeWord strips ALL non-[a-z0-9] characters AFTER lowercasing — which
 * silently DELETES every accented character rather than folding it to its base letter.
 *
 * Result: "élève" → "lve" (the é and è disappear, l/v/e remain). A recognized "élève"
 * from STT will not match the timing-map's "élève" because both end up as different
 * collapsed tokens depending on order of removal. Worse: "señor" → "seor", which
 * cannot match the same-text from STT if STT recognizes the ñ as a different code point.
 *
 * The correct normalization is NFD (canonical decomposition) followed by stripping
 * combining marks (U+0300–U+036F), which folds "é" → "e" before the alpha-num filter.
 */

import { describe, expect, it } from "vitest"
import {
    buildPhraseIndex,
    findPhraseMatch,
    phraseConfidence
} from "./phrase-matcher.js"
import type { TimingMap } from "../types/timing-map.js"

function timingMapWithPhrase(text: string): TimingMap {
    const words = text.split(/\s+/).map((w, i) => ({
        text: w,
        startMs: i * 500,
        endMs: (i + 1) * 500 - 50,
        confidence: 0.9
    }))
    return {
        $schema: "lyricue-timing-v1",
        version: 1,
        showId: "test-show",
        durationMs: words.length * 500,
        sections: [
            {
                id: "v1",
                type: "verse",
                slideIndex: 0,
                startMs: 0,
                endMs: words.length * 500,
                label: "Verse 1",
                words
            }
        ],
        learnedFrom: {
            method: "studio",
            audioRef: "test",
            generatedAt: "2026-06-18T00:00:00.000Z"
        },
        metadata: { schemaVersion: "1" }
    } as unknown as TimingMap
}

describe("phrase matcher — unicode normalization", () => {
    it("matches accented French phrases against the same accented STT output", () => {
        const map = timingMapWithPhrase("élève prière église")
        const index = buildPhraseIndex(map, 3)
        const match = findPhraseMatch(index, "élève prière église")
        expect(match, "an exact accented match must succeed").not.toBeNull()
        expect(match!.confidence).toBeGreaterThanOrEqual(0.75)
    })

    it("matches an accented timing map against a STT recognition that dropped accents", () => {
        // Many STT models emit the unaccented form for accented input. The matcher must
        // bridge that — "elve" in STT should still match "élève" in the timing map.
        const map = timingMapWithPhrase("élève prière église")
        const index = buildPhraseIndex(map, 3)
        const match = findPhraseMatch(index, "eleve priere eglise")
        expect(match, "accent-folded STT must match accented timing map").not.toBeNull()
    })

    it("matches Spanish señor regardless of which side carries the tilde", () => {
        const map = timingMapWithPhrase("santo santo señor")
        const index = buildPhraseIndex(map, 3)
        const match = findPhraseMatch(index, "santo santo senor")
        expect(match, "senor → señor must match after NFD normalization").not.toBeNull()
    })

    it("matches Afrikaans accented words", () => {
        const map = timingMapWithPhrase("liefde wêreld vir")
        const index = buildPhraseIndex(map, 3)
        const match = findPhraseMatch(index, "liefde wereld vir")
        expect(match, "wêreld must match wereld after normalization").not.toBeNull()
    })

    it("phraseConfidence treats accented and unaccented as the same word", () => {
        expect(phraseConfidence(["eleve"], ["élève"])).toBeGreaterThanOrEqual(0.75)
        expect(phraseConfidence(["senor"], ["señor"])).toBeGreaterThanOrEqual(0.75)
    })
})
