import type { ParallelLyricsTrack, TimingMap, TimingSection } from "../types/timing-map.js"

export function sectionPlainText(section: TimingSection): string {
    if (section.lines.length === 0) return section.words.map((word) => word.text).join(" ")
    return section.lines
        .map((line) =>
            section.words
                .slice(line.wordStartIndex, line.wordEndIndex)
                .map((word) => word.text)
                .join(" ")
        )
        .join("\n")
}

export function createParallelLyricsDraft(map: TimingMap, language: string): ParallelLyricsTrack {
    return {
        language,
        sections: map.sections.map((section) => ({ sectionId: section.id, text: findSectionText(map.parallel ?? [], language, section.id) ?? "" }))
    }
}

export function normalizeParallelLyricsTrack(map: TimingMap, track: ParallelLyricsTrack): ParallelLyricsTrack {
    const sectionTextById = new Map(track.sections.map((section) => [section.sectionId, section.text]))
    return {
        language: track.language,
        sections: map.sections.map((section) => ({ sectionId: section.id, text: sectionTextById.get(section.id) ?? "" }))
    }
}

export function upsertParallelLyricsTrack(map: TimingMap, track: ParallelLyricsTrack): TimingMap {
    const normalizedTrack = normalizeParallelLyricsTrack(map, track)
    const current = map.parallel ?? []
    const next = current.some((candidate) => candidate.language === normalizedTrack.language) ? current.map((candidate) => (candidate.language === normalizedTrack.language ? normalizedTrack : candidate)) : [...current, normalizedTrack]
    return { ...map, parallel: next }
}

export function removeParallelLyricsTrack(map: TimingMap, language: string): TimingMap {
    const next = (map.parallel ?? []).filter((track) => track.language !== language)
    return next.length > 0 ? { ...map, parallel: next } : withoutParallel(map)
}

function findSectionText(tracks: ParallelLyricsTrack[], language: string, sectionId: string): string | null {
    return tracks.find((track) => track.language === language)?.sections.find((section) => section.sectionId === sectionId)?.text ?? null
}

function withoutParallel(map: TimingMap): TimingMap {
    const { parallel: _parallel, ...rest } = map
    return rest
}

/**
 * Returns the timing map projected onto a specific primary language.
 *
 * Use case (EP-19 closure): an operator at a Spanish-primary campus wants the karaoke
 * sweep to render in Spanish even though the song was learned in English. The original
 * timing map's sections hold word-level timings (in the learned language). The parallel
 * track for `language` holds section-level translated text. The projection swaps the
 * words array out for a single synthetic word per section whose text is the translated
 * line and whose timing spans the entire section.
 *
 * The original (learned) map's words are demoted to a parallel track tagged with
 * `map.language` so the operator can still toggle back to the original.
 *
 * Returns the input map unchanged when:
 *   - `language` equals `map.language` (already primary)
 *   - No parallel track exists for `language` (cannot project — operator falls back to original)
 *
 * Never mutates the input. Word-level sweep accuracy is reduced to section-level for the
 * projected language because translated text is stored per-section, not per-word. This
 * is the documented trade-off (architecture §4.X EP-19): we don't attempt word-by-word
 * translation alignment because the work to align word boundaries across languages is
 * prohibitive and operator value lives at section granularity.
 */
export function projectTimingMapToPrimaryLanguage(map: TimingMap, language: string): TimingMap {
    if (map.language === language) return map
    const targetTrack = (map.parallel ?? []).find((track) => track.language === language)
    if (!targetTrack) return map

    // Promote the existing learned-language words to a parallel track so operators can
    // toggle back. If a parallel track already exists for map.language (rare, but
    // defensible), it wins — don't shadow operator edits.
    const learnedLanguage = map.language ?? "und"
    const existingLearnedTrack = (map.parallel ?? []).some((track) => track.language === learnedLanguage)
    const learnedAsParallel: ParallelLyricsTrack | null = existingLearnedTrack
        ? null
        : {
              language: learnedLanguage,
              sections: map.sections.map((section) => ({
                  sectionId: section.id,
                  text: sectionPlainText(section)
              }))
          }

    const otherParallel = (map.parallel ?? []).filter((track) => track.language !== language)
    const nextParallel: ParallelLyricsTrack[] = learnedAsParallel
        ? [...otherParallel, learnedAsParallel]
        : otherParallel

    return {
        ...map,
        language,
        sections: map.sections.map((section) => {
            const translatedText = targetTrack.sections.find((s) => s.sectionId === section.id)?.text ?? ""
            // Replace per-word array with a single section-spanning synthetic word.
            // We preserve the section's startMs/endMs envelope; the sweep ticks across
            // the section as one unit.
            return {
                ...section,
                words: [
                    {
                        text: translatedText,
                        startMs: section.startMs,
                        endMs: section.endMs,
                        confidence: 1.0,
                        lineIndex: 0
                    }
                ],
                lines: []
            }
        }),
        parallel: nextParallel.length > 0 ? nextParallel : undefined
    } as TimingMap
}
