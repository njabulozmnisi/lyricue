import { Float32RingBuffer } from "./ring-buffer.js"

export interface SttTranscript {
    text: string
    confidence: number
}

export interface SttWindowContext {
    sampleRate: number
    windowStartedAtMs: number
    windowEndedAtMs: number
    droppedWindows: number
}

export type SttWindowTranscriber = (samples: Float32Array, context: SttWindowContext) => Promise<SttTranscript | null>

export interface RollingSttWindowOptions {
    sampleRate?: number
    windowSeconds?: number
    cadenceMs?: number
    minBufferedMs?: number
    transcribe: SttWindowTranscriber
}

export type RollingSttTickResult =
    | { status: "not-due" | "insufficient-audio" }
    | { status: "dropped"; droppedWindows: number }
    | { status: "transcribed"; transcript: SttTranscript | null; context: SttWindowContext }

export class RollingSttWindow {
    readonly sampleRate: number
    readonly windowSeconds: number
    readonly cadenceMs: number
    readonly minBufferedMs: number
    readonly buffer: Float32RingBuffer

    #transcribe: SttWindowTranscriber
    #lastDispatchAtMs: number | null = null
    #latestAudioAtMs: number | null = null
    #inFlight = false
    #droppedWindows = 0

    constructor(options: RollingSttWindowOptions) {
        this.sampleRate = options.sampleRate ?? 16_000
        this.windowSeconds = options.windowSeconds ?? 5
        this.cadenceMs = options.cadenceMs ?? 2_000
        this.minBufferedMs = options.minBufferedMs ?? 1_000
        if (this.sampleRate <= 0 || this.windowSeconds <= 0 || this.cadenceMs <= 0 || this.minBufferedMs <= 0) {
            throw new Error("sampleRate, windowSeconds, cadenceMs, and minBufferedMs must be positive")
        }
        this.#transcribe = options.transcribe
        this.buffer = new Float32RingBuffer(Math.round(this.sampleRate * this.windowSeconds))
    }

    get droppedWindows(): number {
        return this.#droppedWindows
    }

    push(samples: Float32Array, audioEndedAtMs: number): void {
        this.buffer.push(samples)
        this.#latestAudioAtMs = audioEndedAtMs
    }

    async tick(nowMs: number): Promise<RollingSttTickResult> {
        if (this.#lastDispatchAtMs !== null && nowMs - this.#lastDispatchAtMs < this.cadenceMs) return { status: "not-due" }
        this.#lastDispatchAtMs = nowMs

        const bufferedMs = (this.buffer.size / this.sampleRate) * 1_000
        if (bufferedMs < this.minBufferedMs) return { status: "insufficient-audio" }

        if (this.#inFlight) {
            this.#droppedWindows++
            return { status: "dropped", droppedWindows: this.#droppedWindows }
        }

        const windowEndedAtMs = this.#latestAudioAtMs ?? nowMs
        const samples = this.buffer.snapshot()
        const context: SttWindowContext = {
            sampleRate: this.sampleRate,
            windowStartedAtMs: windowEndedAtMs - (samples.length / this.sampleRate) * 1_000,
            windowEndedAtMs,
            droppedWindows: this.#droppedWindows
        }

        this.#inFlight = true
        try {
            const transcript = await this.#transcribe(samples, context)
            return { status: "transcribed", transcript, context }
        } finally {
            this.#inFlight = false
        }
    }
}
