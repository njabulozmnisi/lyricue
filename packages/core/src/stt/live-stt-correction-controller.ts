import type { SyncEvent } from "../sync/sync-engine-state.js"
import type { TimingMap } from "../types/timing-map.js"
import { evaluatePositionCorrection, type PositionCorrectionContext, type PositionCorrectionDecision } from "./live-position-corrector.js"
import { RollingSttWindow, type RollingSttTickResult, type RollingSttWindowOptions, type SttTranscript, type SttWindowTranscriber } from "./rolling-window-transcriber.js"

export interface LiveSttCorrectionControllerOptions extends Omit<RollingSttWindowOptions, "transcribe"> {
    map: TimingMap
    transcribe: SttWindowTranscriber
    getContext: () => PositionCorrectionContext
    dispatch: (event: Extract<SyncEvent, { kind: "positionCorrection" }>) => void
    sttEnabled?: boolean
    minWords?: number
    minTranscriptConfidence?: number
    requireDifferentSection?: boolean
    onDecision?: (decision: PositionCorrectionDecision) => void
    onError?: (error: Error) => void
}

export type LiveSttCorrectionTickResult =
    | RollingSttTickResult
    | { status: "disabled" }
    | { status: "low-confidence"; transcript: SttTranscript }
    | { status: "no-correction"; transcript: SttTranscript }
    | { status: "corrected"; transcript: SttTranscript; decision: PositionCorrectionDecision }
    | { status: "error"; error: Error }

export class LiveSttCorrectionController {
    readonly rollingWindow: RollingSttWindow

    #map: TimingMap
    #getContext: () => PositionCorrectionContext
    #dispatch: (event: Extract<SyncEvent, { kind: "positionCorrection" }>) => void
    #sttEnabled: boolean
    #minWords: number | undefined
    #minTranscriptConfidence: number
    #requireDifferentSection: boolean | undefined
    #onDecision: ((decision: PositionCorrectionDecision) => void) | undefined
    #onError: ((error: Error) => void) | undefined

    constructor(options: LiveSttCorrectionControllerOptions) {
        this.#map = options.map
        this.#getContext = options.getContext
        this.#dispatch = options.dispatch
        this.#sttEnabled = options.sttEnabled ?? true
        this.#minWords = options.minWords
        this.#minTranscriptConfidence = options.minTranscriptConfidence ?? 0.65
        this.#requireDifferentSection = options.requireDifferentSection
        this.#onDecision = options.onDecision
        this.#onError = options.onError
        this.rollingWindow = new RollingSttWindow({
            ...(options.sampleRate !== undefined ? { sampleRate: options.sampleRate } : {}),
            ...(options.windowSeconds !== undefined ? { windowSeconds: options.windowSeconds } : {}),
            ...(options.cadenceMs !== undefined ? { cadenceMs: options.cadenceMs } : {}),
            ...(options.minBufferedMs !== undefined ? { minBufferedMs: options.minBufferedMs } : {}),
            transcribe: options.transcribe
        })
    }

    setMap(map: TimingMap): void {
        this.#map = map
    }

    setEnabled(sttEnabled: boolean): void {
        this.#sttEnabled = sttEnabled
    }

    pushAudio(samples: Float32Array, audioEndedAtMs: number): void {
        this.rollingWindow.push(samples, audioEndedAtMs)
    }

    async tick(nowMs: number): Promise<LiveSttCorrectionTickResult> {
        if (!this.#sttEnabled) return { status: "disabled" }

        let result: RollingSttTickResult
        try {
            result = await this.rollingWindow.tick(nowMs)
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err))
            this.#onError?.(error)
            return { status: "error", error }
        }

        if (result.status !== "transcribed") return result
        if (!result.transcript) return result
        if (result.transcript.confidence < this.#minTranscriptConfidence) return { status: "low-confidence", transcript: result.transcript }

        const decision = evaluatePositionCorrection({
            map: this.#map,
            recognizedText: result.transcript.text,
            context: this.#getContext(),
            wallTime: nowMs,
            sttEnabled: true,
            ...(this.#minWords !== undefined ? { minWords: this.#minWords } : {}),
            ...(this.#requireDifferentSection !== undefined ? { requireDifferentSection: this.#requireDifferentSection } : {})
        })
        if (!decision) return { status: "no-correction", transcript: result.transcript }

        try {
            this.#dispatch(decision.event)
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err))
            this.#onError?.(error)
            return { status: "error", error }
        }
        try {
            this.#onDecision?.(decision)
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err))
            this.#onError?.(error)
        }
        return { status: "corrected", transcript: result.transcript, decision }
    }
}
