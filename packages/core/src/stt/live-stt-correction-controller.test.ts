import { describe, expect, it, vi } from "vitest"
import type { SyncEvent } from "../sync/sync-engine-state.js"
import type { TimingMap, TimingSection } from "../types/timing-map.js"
import { LiveSttCorrectionController } from "./live-stt-correction-controller.js"

function section(id: string, slideIndex: number, words: string[], startOrdinal = 0): TimingSection {
    return {
        id,
        type: id.startsWith("c") ? "chorus" : "verse",
        label: id,
        slideIndex,
        startMs: startOrdinal * 500,
        endMs: (startOrdinal + words.length) * 500,
        words: words.map((text, idx) => ({
            text,
            startMs: (startOrdinal + idx) * 500,
            endMs: (startOrdinal + idx + 1) * 500,
            confidence: 0.99,
            lineIndex: 0
        })),
        lines: []
    }
}

function map(): TimingMap {
    return {
        $schema: "lyricue-timing-v1",
        showId: "s1",
        learnedFrom: { method: "studio", duration: 12, learnedAt: "2026-06-06T00:00:00.000Z" },
        bpm: 120,
        language: "en",
        sections: [section("v1", 0, ["Amazing", "grace", "how", "sweet", "the", "sound"], 0), section("c1", 1, ["How", "great", "is", "our", "God"], 6)],
        metadata: { schemaVersion: "1", version: "1.0.0" }
    }
}

function makeController(opts: {
    text?: string
    confidence?: number
    sttEnabled?: boolean
    transcribeThrows?: boolean
    dispatch?: (event: Extract<SyncEvent, { kind: "positionCorrection" }>) => void
    onError?: (error: Error) => void
} = {}): LiveSttCorrectionController {
    return new LiveSttCorrectionController({
        map: map(),
        sampleRate: 10,
        windowSeconds: 1,
        cadenceMs: 1,
        minBufferedMs: 100,
        minWords: 3,
        sttEnabled: opts.sttEnabled,
        getContext: () => ({ currentSlideIndex: 0, currentWordIndex: 2, currentRefMs: 1_000 }),
        dispatch: opts.dispatch ?? vi.fn(),
        onError: opts.onError,
        transcribe: async () => {
            if (opts.transcribeThrows) throw new Error("stt engine unavailable")
            return { text: opts.text ?? "how great is", confidence: opts.confidence ?? 0.9 }
        }
    })
}

async function tickWithAudio(controller: LiveSttCorrectionController): Promise<Awaited<ReturnType<LiveSttCorrectionController["tick"]>>> {
    controller.pushAudio(new Float32Array(10), 1_000)
    return controller.tick(1_000)
}

describe("LiveSttCorrectionController", () => {
    it("dispatches a SyncEngine position-correction event for a confident cross-section transcript", async () => {
        const dispatch = vi.fn()
        const controller = makeController({ dispatch })

        const result = await tickWithAudio(controller)

        expect(result.status).toBe("corrected")
        expect(dispatch).toHaveBeenCalledWith({ kind: "positionCorrection", targetRefMs: 3_000, wallTime: 1_000 })
    })

    it("returns disabled without transcribing when STT is off", async () => {
        const dispatch = vi.fn()
        const controller = makeController({ sttEnabled: false, dispatch })

        const result = await tickWithAudio(controller)

        expect(result.status).toBe("disabled")
        expect(dispatch).not.toHaveBeenCalled()
    })

    it("does not dispatch low-confidence transcripts", async () => {
        const dispatch = vi.fn()
        const controller = makeController({ confidence: 0.4, dispatch })

        const result = await tickWithAudio(controller)

        expect(result.status).toBe("low-confidence")
        expect(dispatch).not.toHaveBeenCalled()
    })

    it("does not throw when the transcriber fails", async () => {
        const dispatch = vi.fn()
        const onError = vi.fn()
        const controller = makeController({ transcribeThrows: true, dispatch, onError })

        const result = await tickWithAudio(controller)

        expect(result.status).toBe("error")
        expect(dispatch).not.toHaveBeenCalled()
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "stt engine unavailable" }))
    })
})
