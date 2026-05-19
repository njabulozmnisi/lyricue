import { describe, expect, it, vi } from "vitest"
import { mkdtemp, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createRehearsalCaptureSession, createWavChunkWriter, type RehearsalChunkWriter } from "./rehearsal-capture.js"

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

    it("writes a valid PCM WAV header while streaming chunks to disk", async () => {
        const dir = await mkdtemp(join(tmpdir(), "lyricue-rehearsal-"))
        const filePath = join(dir, "capture.wav")
        const writer = await createWavChunkWriter({ filePath, sampleRate: 48_000, channels: 1 })

        await writer.write(new Uint8Array([0x01, 0x00, 0xff, 0x7f]))
        await writer.write(new Uint8Array([0x00, 0x80]))
        await writer.close()

        const data = await readFile(filePath)
        expect(data.toString("ascii", 0, 4)).toBe("RIFF")
        expect(data.toString("ascii", 8, 12)).toBe("WAVE")
        expect(data.toString("ascii", 36, 40)).toBe("data")
        expect(data.readUInt32LE(40)).toBe(6)
        expect(data.subarray(44)).toEqual(Buffer.from([0x01, 0x00, 0xff, 0x7f, 0x00, 0x80]))
    })
})
