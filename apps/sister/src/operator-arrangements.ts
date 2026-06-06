import { normalizeArrangementSequence } from "@lyricue/core/arrangements"
import { validateArrangement, type Arrangement, type TimingMap } from "@lyricue/core/types"

export type OperatorArrangementSaveResult =
    | { ok: true; arrangement: Arrangement }
    | { ok: false; message: string }

export function prepareOperatorArrangementSave(input: unknown, resolveTimingMap: (showId: string) => TimingMap | null): OperatorArrangementSaveResult {
    const result = validateArrangement(input)
    if (!result.ok) {
        return { ok: false, message: result.errors[0]?.message ?? "invalid arrangement" }
    }

    const map = resolveTimingMap(result.value.showId)
    if (!map) {
        return { ok: false, message: `unknown showId=${result.value.showId}` }
    }

    const sequence = normalizeArrangementSequence(map, result.value.sequence)
    if (sequence.length === 0) {
        return { ok: false, message: `arrangement "${result.value.id}" has no sections in active timing map` }
    }

    return {
        ok: true,
        arrangement: {
            ...result.value,
            sequence
        }
    }
}
