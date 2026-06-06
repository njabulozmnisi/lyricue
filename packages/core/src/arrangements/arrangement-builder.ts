import type { Arrangement, ArrangementStep, TimingMap, TimingSection, TimingSectionType } from "../types/timing-map.js"

export interface ParsedArrangementShorthand {
    sequence: ArrangementStep[]
    unknownTokens: string[]
}

export interface CreateArrangementOptions {
    id: string
    name: string
    showId: string
    sequence: ArrangementStep[]
    isDefault?: boolean
    now?: string
}

export interface FreeShowLayoutProjection {
    id: string
    name: string
    slides: number[]
}

type SectionAlias = {
    base: string
    ordinal: number
    aliases: string[]
}

const TYPE_BASE: Record<TimingSectionType, string | null> = {
    verse: "v",
    chorus: "c",
    bridge: "b",
    "pre-chorus": "pc",
    tag: "tag",
    intro: "i",
    outro: "o",
    other: null
}

export function parseArrangementShorthand(input: string, map: TimingMap): ParsedArrangementShorthand {
    const aliases = buildSectionAliasIndex(map)
    const sequence: ArrangementStep[] = []
    const unknownTokens: string[] = []

    for (const token of input
        .split(/[\s,>|]+/)
        .map((part) => part.trim())
        .filter(Boolean)) {
        const sectionId = aliases.get(normalizeToken(token))
        if (sectionId) sequence.push({ sectionId })
        else unknownTokens.push(token)
    }

    return { sequence, unknownTokens }
}

export function buildSectionAliasIndex(map: TimingMap): Map<string, string> {
    const byType = new Map<TimingSectionType, number>()
    const index = new Map<string, string>()

    for (const section of map.sections) {
        const nextOrdinal = (byType.get(section.type) ?? 0) + 1
        byType.set(section.type, nextOrdinal)

        const alias = sectionAlias(section, nextOrdinal)
        for (const candidate of alias.aliases) {
            const normalized = normalizeToken(candidate)
            if (!index.has(normalized)) index.set(normalized, section.id)
        }
    }

    return index
}

export function createArrangement(opts: CreateArrangementOptions): Arrangement {
    const now = opts.now ?? new Date().toISOString()
    return {
        id: opts.id,
        name: opts.name,
        showId: opts.showId,
        isDefault: opts.isDefault ?? false,
        sequence: [...opts.sequence],
        createdAt: now,
        updatedAt: now
    }
}

export function moveArrangementStep(sequence: ArrangementStep[], fromIndex: number, toIndex: number): ArrangementStep[] {
    if (!isValidIndex(sequence, fromIndex)) return [...sequence]
    const next = [...sequence]
    const [step] = next.splice(fromIndex, 1)
    const clamped = Math.max(0, Math.min(next.length, toIndex))
    next.splice(clamped, 0, step!)
    return next
}

export function duplicateArrangementStep(sequence: ArrangementStep[], index: number): ArrangementStep[] {
    if (!isValidIndex(sequence, index)) return [...sequence]
    const next = [...sequence]
    next.splice(index + 1, 0, { ...sequence[index]! })
    return next
}

export function removeArrangementStep(sequence: ArrangementStep[], index: number): ArrangementStep[] {
    if (!isValidIndex(sequence, index)) return [...sequence]
    return sequence.filter((_step, i) => i !== index)
}

export function normalizeArrangementSequence(map: TimingMap, sequence: ArrangementStep[]): ArrangementStep[] {
    const sectionIds = new Set(map.sections.map((section) => section.id))
    return sequence.filter((step) => sectionIds.has(step.sectionId)).map((step) => ({ sectionId: step.sectionId }))
}

export function selectActiveArrangement(arrangements: Arrangement[], id?: string | null): Arrangement | null {
    if (id) return arrangements.find((arrangement) => arrangement.id === id) ?? null
    return arrangements.find((arrangement) => arrangement.isDefault) ?? arrangements[0] ?? null
}

export function arrangementToFreeShowLayout(arrangement: Arrangement, map: TimingMap): FreeShowLayoutProjection {
    const byId = new Map(map.sections.map((section) => [section.id, section]))
    const slides = arrangement.sequence.map((step, index) => {
        const section = byId.get(step.sectionId)
        if (!section) {
            throw new Error(`Arrangement "${arrangement.id}" step ${index} references unknown section "${step.sectionId}"`)
        }
        return section.slideIndex
    })
    return { id: arrangement.id, name: arrangement.name, slides }
}

function sectionAlias(section: TimingSection, ordinal: number): SectionAlias {
    const base = TYPE_BASE[section.type]
    const aliases = new Set<string>([section.id, section.label])
    if (base) {
        aliases.add(base)
        aliases.add(`${base}${ordinal}`)
        aliases.add(`${base} ${ordinal}`)
        aliases.add(`${typeName(section.type)} ${ordinal}`)
        aliases.add(typeName(section.type))
    }
    return { base: base ?? section.type, ordinal, aliases: [...aliases] }
}

function typeName(type: TimingSectionType): string {
    switch (type) {
        case "pre-chorus":
            return "pre chorus"
        default:
            return type
    }
}

function normalizeToken(token: string): string {
    return token.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function isValidIndex(sequence: ArrangementStep[], index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index < sequence.length
}
