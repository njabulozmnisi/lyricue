import { describe, expect, it } from "vitest"
import { createConstantTranscriber, createNoOpTranscriber } from "./no-op-transcriber.js"
import { RollingSttWindow } from "./rolling-window-transcriber.js"

describe("no-op transcriber", () => {
    it("returns null without inspecting the audio samples", async () => {
        const transcribe = createNoOpTranscriber()
        const result = await transcribe(new Float32Array(48000), {
            sampleRate: 48000,
            windowStartedAtMs: 0,
            windowEndedAtMs: 1000,
            droppedWindows: 0
        })
        expect(result).toBeNull()
    })

    it("integrates with RollingSttWindow without throwing — full pipeline exercise", async () => {
        const window = new RollingSttWindow({
            sampleRate: 16000,
            windowSeconds: 0.5,
            cadenceMs: 250,
            transcribe: createNoOpTranscriber()
        })
        // Feed enough audio to trigger a window.
        window.push(new Float32Array(16000 / 2), 500)
        const result = await window.tick(300)
        expect(result.status === "transcribed" || result.status === "not-due" || result.status === "insufficient-audio").toBe(true)
        if (result.status === "transcribed") {
            expect(result.transcript).toBeNull()
        }
    })
})

describe("constant transcriber", () => {
    it("returns the configured text and confidence regardless of audio", async () => {
        const transcribe = createConstantTranscriber("amazing grace", 0.85)
        const result = await transcribe(new Float32Array(0), {
            sampleRate: 48000,
            windowStartedAtMs: 0,
            windowEndedAtMs: 0,
            droppedWindows: 0
        })
        expect(result).toEqual({ text: "amazing grace", confidence: 0.85 })
    })

    it("defaults to confidence 1.0", async () => {
        const transcribe = createConstantTranscriber("hello")
        const result = await transcribe(new Float32Array(0), {
            sampleRate: 48000,
            windowStartedAtMs: 0,
            windowEndedAtMs: 0,
            droppedWindows: 0
        })
        expect(result?.confidence).toBe(1.0)
    })
})
