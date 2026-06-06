import { describe, expect, it } from "vitest"
import { RollingSttWindow, type SttWindowTranscriber } from "./rolling-window-transcriber.js"

describe("RollingSttWindow", () => {
    it("waits for enough buffered audio", async () => {
        const processor = new RollingSttWindow({
            sampleRate: 10,
            minBufferedMs: 1_000,
            transcribe: async () => ({ text: "unused", confidence: 1 })
        })

        processor.push(new Float32Array([1, 2, 3]), 300)

        expect(await processor.tick(2_000)).toEqual({ status: "insufficient-audio" })
    })

    it("dispatches a bounded rolling window at cadence", async () => {
        const calls: { samples: number[]; started: number; ended: number }[] = []
        const processor = new RollingSttWindow({
            sampleRate: 10,
            windowSeconds: 1,
            cadenceMs: 2_000,
            minBufferedMs: 500,
            transcribe: async (samples, context) => {
                calls.push({ samples: Array.from(samples), started: context.windowStartedAtMs, ended: context.windowEndedAtMs })
                return { text: "how great is", confidence: 0.91 }
            }
        })

        processor.push(new Float32Array([1, 2, 3, 4, 5, 6]), 600)
        const first = await processor.tick(2_000)
        const second = await processor.tick(2_500)

        expect(first.status).toBe("transcribed")
        expect(second.status).toBe("not-due")
        expect(calls).toEqual([{ samples: [1, 2, 3, 4, 5, 6], started: 0, ended: 600 }])
    })

    it("drops due windows while a transcription is still in flight", async () => {
        let resolveFirst: ((value: { text: string; confidence: number }) => void) | null = null
        const transcribe: SttWindowTranscriber = () =>
            new Promise((resolve) => {
                resolveFirst = resolve
            })
        const processor = new RollingSttWindow({
            sampleRate: 10,
            windowSeconds: 1,
            cadenceMs: 2_000,
            minBufferedMs: 500,
            transcribe
        })

        processor.push(new Float32Array([1, 2, 3, 4, 5]), 500)
        const first = processor.tick(2_000)
        const dropped = await processor.tick(4_000)
        resolveFirst?.({ text: "done", confidence: 1 })
        const firstResult = await first

        expect(dropped).toEqual({ status: "dropped", droppedWindows: 1 })
        expect(firstResult.status).toBe("transcribed")
        expect(processor.droppedWindows).toBe(1)
    })
})
