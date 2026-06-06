import { normalizeParallelLyricsTrack } from "@lyricue/core/translations"
import { validateParallelLyricsTrack, type ParallelLyricsTrack, type TimingMap } from "@lyricue/core/types"
import type { TimingMapVariant } from "@lyricue/core/setlist"

export interface OperatorTranslationSave {
    map: TimingMap
    variant: TimingMapVariant
}

export type OperatorTranslationSaveResult =
    | { ok: true; value: OperatorTranslationSave }
    | { ok: false; message: string }

export function prepareOperatorTranslationSave(input: unknown, resolveTimingMap: (showId: string, variant: TimingMapVariant) => TimingMap | null): OperatorTranslationSaveResult {
    const intent = parseTranslationSaveIntent(input)
    if (!intent.ok) return intent

    const variant: TimingMapVariant = intent.method === "rehearsal" ? "rehearsal" : "studio"
    const current = resolveTimingMap(intent.showId, variant)
    if (!current) {
        return { ok: false, message: `unknown showId=${intent.showId}` }
    }

    const parallel = intent.parallel.map((track) => normalizeParallelLyricsTrack(current, track))
    if (parallel.length === 0) {
        const { parallel: _parallel, ...withoutParallel } = current
        return { ok: true, value: { map: withoutParallel, variant } }
    }
    return {
        ok: true,
        value: {
            map: {
                ...current,
                parallel
            },
            variant
        }
    }
}

function parseTranslationSaveIntent(input: unknown): { ok: true; showId: string; method: "studio" | "rehearsal" | "imported"; parallel: ParallelLyricsTrack[] } | { ok: false; message: string } {
    if (!input || typeof input !== "object") return { ok: false, message: "translation save payload must be an object" }
    const raw = input as Record<string, unknown>
    if (typeof raw.showId !== "string" || raw.showId.trim() === "") return { ok: false, message: "showId must be a non-empty string" }
    const learnedFrom = raw.learnedFrom
    if (!learnedFrom || typeof learnedFrom !== "object") return { ok: false, message: "learnedFrom must be an object" }
    const method = (learnedFrom as Record<string, unknown>).method
    if (method !== "studio" && method !== "rehearsal" && method !== "imported") return { ok: false, message: "learnedFrom.method must be studio, rehearsal, or imported" }
    if (raw.parallel === undefined) return { ok: true, showId: raw.showId, method, parallel: [] }
    if (!Array.isArray(raw.parallel)) return { ok: false, message: "parallel must be an array" }

    const parallel: ParallelLyricsTrack[] = []
    for (let i = 0; i < raw.parallel.length; i++) {
        const result = validateParallelLyricsTrack(raw.parallel[i])
        if (!result.ok) return { ok: false, message: result.errors[0]?.message ?? `parallel[${i}] is invalid` }
        parallel.push(result.value)
    }
    return { ok: true, showId: raw.showId, method, parallel }
}
