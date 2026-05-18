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

export function upsertParallelLyricsTrack(map: TimingMap, track: ParallelLyricsTrack): TimingMap {
    const current = map.parallel ?? []
    const next = current.some((candidate) => candidate.language === track.language) ? current.map((candidate) => (candidate.language === track.language ? track : candidate)) : [...current, track]
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
