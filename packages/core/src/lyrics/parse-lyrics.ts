import type { TimingSectionType } from "../types/timing-map.js"

export interface ParsedLyricsSection {
    id: string
    type: TimingSectionType
    label: string
    text: string
    lines: string[]
}

export interface ParsedLyrics {
    title: string | null
    sections: ParsedLyricsSection[]
    warnings: string[]
}

const BRACKET_MARKER = /^\s*\[([^\]]+)\]\s*$/
const COLON_MARKER = /^\s*((?:verse|chorus|bridge|pre[- ]?chorus|tag|intro|outro)(?:\s+\d+)?)\s*:\s*$/i
const NUMBERED_MARKER = /^\s*(\d+)[.)]\s*(.*)$/
const CHORDPRO_DIRECTIVE = /^\s*\{([^}:]+)(?::\s*([^}]+))?\}\s*$/

export function parseLyrics(input: string): ParsedLyrics {
    const normalized = normalizeText(input)
    const title = extractChordProTitle(normalized)
    const stripped = stripChordProMetadata(normalized)
    const explicit = parseExplicitSections(stripped)
    if (explicit.length > 0) return { title, sections: explicit, warnings: [] }

    const numbered = parseNumberedSections(stripped)
    if (numbered.length > 0) return { title, sections: numbered, warnings: [] }

    const sections = parseBlankLineSections(stripped)
    return {
        title,
        sections,
        warnings: sections.length > 0 ? ["No explicit section markers found; split on blank lines."] : ["No lyrics text found."]
    }
}

export function parseLyricsFileText(filename: string, content: string): ParsedLyrics {
    const lower = filename.toLowerCase()
    if (lower.endsWith(".opensong") || lower.endsWith(".xml")) {
        const xmlParsed = parseLyricsXml(content)
        if (xmlParsed) return xmlParsed
    }
    return parseLyrics(content)
}

function parseExplicitSections(input: string): ParsedLyricsSection[] {
    const sections: ParsedLyricsSection[] = []
    let current: { label: string; lines: string[] } | null = null
    let markerSeen = false

    for (const rawLine of input.split("\n")) {
        const line = rawLine.trimEnd()
        const marker = explicitMarkerLabel(line)
        if (marker) {
            markerSeen = true
            if (current) pushSection(sections, current.label, current.lines)
            current = { label: marker, lines: [] }
            continue
        }
        if (!current) continue
        current.lines.push(stripInlineChords(line))
    }
    if (current) pushSection(sections, current.label, current.lines)
    return markerSeen ? sections : []
}

function parseNumberedSections(input: string): ParsedLyricsSection[] {
    const sections: ParsedLyricsSection[] = []
    let current: { label: string; lines: string[] } | null = null
    for (const rawLine of input.split("\n")) {
        const numbered = rawLine.match(NUMBERED_MARKER)
        if (numbered) {
            if (current) pushSection(sections, current.label, current.lines)
            current = { label: `Verse ${numbered[1]}`, lines: [stripInlineChords(numbered[2] ?? "")] }
            continue
        }
        if (!current) continue
        current.lines.push(stripInlineChords(rawLine))
    }
    if (current) pushSection(sections, current.label, current.lines)
    return sections
}

function parseBlankLineSections(input: string): ParsedLyricsSection[] {
    return input
        .split(/\n\s*\n/g)
        .map((block) => block.split("\n").map((line) => stripInlineChords(line)).filter((line) => line.trim() !== ""))
        .filter((lines) => lines.length > 0)
        .map((lines, idx) => makeSection(`Section ${idx + 1}`, lines))
}

function explicitMarkerLabel(line: string): string | null {
    const bracket = line.match(BRACKET_MARKER)
    if (bracket) return normalizeSectionLabel(bracket[1]!)
    const colon = line.match(COLON_MARKER)
    if (colon) return normalizeSectionLabel(colon[1]!)
    const directive = line.match(CHORDPRO_DIRECTIVE)
    if (!directive) return null
    const name = directive[1]!.toLowerCase()
    const value = directive[2]?.trim()
    if (name === "soc" || name === "start_of_chorus") return value ? normalizeSectionLabel(value) : "Chorus"
    if (name === "sov" || name === "start_of_verse") return value ? normalizeSectionLabel(value) : "Verse"
    if (name === "sob" || name === "start_of_bridge") return value ? normalizeSectionLabel(value) : "Bridge"
    return null
}

function pushSection(sections: ParsedLyricsSection[], label: string, lines: string[]): void {
    const trimmed = lines.map((line) => line.trim()).filter(Boolean)
    if (trimmed.length === 0) return
    sections.push(makeSection(label, trimmed))
}

function makeSection(label: string, lines: string[]): ParsedLyricsSection {
    const type = sectionTypeFromLabel(label)
    return {
        id: `${type}-${slug(label)}`,
        type,
        label,
        text: lines.join("\n"),
        lines
    }
}

function normalizeSectionLabel(label: string): string {
    const compact = label.trim().replace(/\s+/g, " ")
    const shorthand = compact.match(/^([vcbpto])(\d*)$/i)
    if (shorthand) {
        const prefix = shorthand[1]!.toLowerCase()
        const number = shorthand[2] ? ` ${shorthand[2]}` : ""
        if (prefix === "v") return `Verse${number}`
        if (prefix === "c") return `Chorus${number}`
        if (prefix === "b") return `Bridge${number}`
        if (prefix === "p") return `Pre-Chorus${number}`
        if (prefix === "t") return `Tag${number}`
        if (prefix === "o") return `Outro${number}`
    }
    return compact
        .split(" ")
        .map((part) => (part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1).toLowerCase()))
        .join(" ")
        .replace(/^Pre[- ]Chorus/i, "Pre-Chorus")
}

function sectionTypeFromLabel(label: string): TimingSectionType {
    const l = label.toLowerCase()
    if (l.startsWith("verse")) return "verse"
    if (l.startsWith("chorus")) return "chorus"
    if (l.startsWith("bridge")) return "bridge"
    if (l.startsWith("pre-chorus") || l.startsWith("pre chorus")) return "pre-chorus"
    if (l.startsWith("tag")) return "tag"
    if (l.startsWith("intro")) return "intro"
    if (l.startsWith("outro")) return "outro"
    return "other"
}

function parseLyricsXml(content: string): ParsedLyrics | null {
    const title = decodeXml(firstMatch(content, /<title\b[^>]*>([\s\S]*?)<\/title>/i))
    const verseMatches = [...content.matchAll(/<verse\b([^>]*)>([\s\S]*?)<\/verse>/gi)]
    if (verseMatches.length > 0) {
        return {
            title,
            sections: verseMatches.map((match, idx) => {
                const name = firstMatch(match[1]!, /\bname=["']([^"']+)["']/i) ?? `Section ${idx + 1}`
                const text = (decodeXml(stripTags(match[2]!)) ?? "").trim()
                return makeSection(normalizeSectionLabel(name), text.split("\n").filter(Boolean))
            }),
            warnings: []
        }
    }
    const lyrics = firstMatch(content, /<lyrics[^>]*>([\s\S]*?)<\/lyrics>/i)
    if (!lyrics) return null
    const parsed = parseLyrics(decodeXml(stripTags(lyrics)) ?? "")
    return { ...parsed, title: parsed.title ?? title ?? null }
}

function stripChordProMetadata(input: string): string {
    return input
        .split("\n")
        .filter((line) => {
            const directive = line.match(CHORDPRO_DIRECTIVE)
            if (!directive) return true
            return !["title", "artist", "key", "tempo", "comment", "end_of_verse", "end_of_chorus", "end_of_bridge", "eov", "eoc", "eob"].includes(directive[1]!.toLowerCase())
        })
        .join("\n")
}

function extractChordProTitle(input: string): string | null {
    for (const line of input.split("\n")) {
        const directive = line.match(CHORDPRO_DIRECTIVE)
        if (directive?.[1]?.toLowerCase() === "title" && directive[2]) return directive[2].trim()
    }
    return null
}

function stripInlineChords(line: string): string {
    return line.replace(/\[[A-G][^\]]*\]/g, "").trimEnd()
}

function normalizeText(input: string): string {
    return input.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").trim()
}

function stripTags(input: string): string {
    return input.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
}

function decodeXml(input: string | null): string | null {
    if (input === null) return null
    return input
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
}

function firstMatch(input: string, regex: RegExp): string | null {
    return input.match(regex)?.[1] ?? null
}

function slug(input: string): string {
    return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section"
}
