import { describe, expect, it, vi } from "vitest"
import { createRehearsalCaptureSession, type RehearsalChunkWriter } from "./rehearsal-capture.js"

function makeWriter(): RehearsalChunkWriter & { chunks: Uint8Array[]; close: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> } {
    return {
        chunks: [],
        write: vi.fn(async function (this: { chunks: Uint8Array[] }, chunk: Uint8Array) {
            this.chunks.push(chunk)
        }),
        close: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined)
    }
}

describe("createRehearsalCaptureSession", () => {
    it("streams chunks to a writer without buffering the whole rehearsal", async () => {
        let now = 1_000
        const writer = makeWriter()
        const session = createRehearsalCaptureSession({
            filePath: "/userData/lyricue/rehearsals/2026.wav",
            writer,
            now: () => now,
            startedAt: "2026-05-18T00:00:00.000Z"
        })

        await session.writeChunk(new Uint8Array([1, 2, 3]))
        await session.writeChunk(new Uint8Array([4, 5]))
        now = 3_500
        const result = await session.stop()

        expect(writer.chunks).toHaveLength(2)
        expect(session.bytesWritten).toBe(5)
        expect(result).toEqual({ filePath: "/userData/lyricue/rehearsals/2026.wav", bytesWritten: 5, elapsedMs: 2_500 })
        expect(writer.close).toHaveBeenCalledOnce()
    })

    it("deletes the file when a session is discarded", async () => {
        const writer = makeWriter()
        const session = createRehearsalCaptureSession({ filePath: "/tmp/rehearsal.wav", writer })
        await session.discard()
        expect(writer.close).toHaveBeenCalledOnce()
        expect(writer.delete).toHaveBeenCalledOnce()
        await expect(session.writeChunk(new Uint8Array([1]))).rejects.toThrow(/closed/)
    })
})
