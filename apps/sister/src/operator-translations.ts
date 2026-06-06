import { normalizeParallelLyricsTrack } from "@lyricue/core/translations"
import { validateTimingMap, type TimingMap } from "@lyricue/core/types"
import type { TimingMapVariant } from "@lyricue/core/setlist"

export interface OperatorTranslationSave {
    map: TimingMap
    variant: TimingMapVariant
}

export type OperatorTranslationSaveResult =
    | { ok: true; value: OperatorTranslationSave }
    | { ok: false; message: string }

export function prepareOperatorTranslationSave(input: unknown, resolveTimingMap: (showId: string, variant: TimingMapVariant) => TimingMap | null): OperatorTranslationSaveResult {
    const result = validateTimingMap(input)
    if (!result.ok) {
        return { ok: false, message: result.errors[0]?.message ?? "invalid timing map" }
    }

    const variant: TimingMapVariant = result.value.learnedFrom.method === "rehearsal" ? "rehearsal" : "studio"
    const current = resolveTimingMap(result.value.showId, variant)
    if (!current) {
        return { ok: false, message: `unknown showId=${result.value.showId}` }
    }

    const parallel = (result.value.parallel ?? []).map((track) => normalizeParallelLyricsTrack(current, track))
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
