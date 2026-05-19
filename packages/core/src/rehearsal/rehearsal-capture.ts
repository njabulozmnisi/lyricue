import { mkdir, open, rm } from "node:fs/promises"
import { dirname } from "node:path"

export interface RehearsalChunkWriter {
    write(chunk: Uint8Array): Promise<void>
    close(): Promise<void>
    delete?(): Promise<void>
}

export interface RehearsalCaptureSession {
    readonly filePath: string
    readonly startedAt: string
    readonly bytesWritten: number
    readonly elapsedMs: number
    writeChunk(chunk: Uint8Array): Promise<void>
    stop(): Promise<{ filePath: string; bytesWritten: number; elapsedMs: number }>
    discard(): Promise<void>
}

export interface WavChunkWriterOptions {
    filePath: string
    sampleRate: number
    channels: number
    bitsPerSample?: 16
}

export async function createWavChunkWriter(opts: WavChunkWriterOptions): Promise<RehearsalChunkWriter> {
    const sampleRate = sanitizePositiveInt(opts.sampleRate, "sampleRate")
    const channels = sanitizePositiveInt(opts.channels, "channels")
    const bitsPerSample = opts.bitsPerSample ?? 16
    if (bitsPerSample !== 16) throw new Error("Only 16-bit PCM WAV rehearsal capture is supported.")

    await mkdir(dirname(opts.filePath), { recursive: true })
    const handle = await open(opts.filePath, "w+")
    let dataBytes = 0
    let closed = false

    await handle.write(createWavHeader({ dataBytes: 0, sampleRate, channels, bitsPerSample }), 0, 44, 0)

    async function ensureOpen(): Promise<void> {
        if (closed) throw new Error("WAV rehearsal writer is already closed.")
    }

    return {
        async write(chunk: Uint8Array) {
            await ensureOpen()
            await handle.write(chunk, 0, chunk.byteLength, 44 + dataBytes)
            dataBytes += chunk.byteLength
        },
        async close() {
            if (closed) return
            closed = true
            await handle.write(createWavHeader({ dataBytes, sampleRate, channels, bitsPerSample }), 0, 44, 0)
            await handle.sync()
            await handle.close()
        },
        async delete() {
            if (!closed) {
                closed = true
                await handle.close()
            }
            await rm(opts.filePath, { force: true })
        }
    }
}

export function createRehearsalCaptureSession(opts: {
    filePath: string
    writer: RehearsalChunkWriter
    now?: () => number
    startedAt?: string
}): RehearsalCaptureSession {
    const now = opts.now ?? Date.now
    const startedMs = now()
    let bytesWritten = 0
    let closed = false

    async function ensureOpen(): Promise<void> {
        if (closed) throw new Error("Rehearsal capture session is already closed.")
    }

    return {
        filePath: opts.filePath,
        startedAt: opts.startedAt ?? new Date(startedMs).toISOString(),
        get bytesWritten() {
            return bytesWritten
        },
        get elapsedMs() {
            return now() - startedMs
        },
        async writeChunk(chunk: Uint8Array) {
            await ensureOpen()
            await opts.writer.write(chunk)
            bytesWritten += chunk.byteLength
        },
        async stop() {
            await ensureOpen()
            closed = true
            await opts.writer.close()
            return { filePath: opts.filePath, bytesWritten, elapsedMs: now() - startedMs }
        },
        async discard() {
            if (!closed) {
                closed = true
                await opts.writer.close()
            }
            await opts.writer.delete?.()
        }
    }
}

function sanitizePositiveInt(value: number, name: string): number {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`)
    return value
}

function createWavHeader(opts: {
    dataBytes: number
    sampleRate: number
    channels: number
    bitsPerSample: 16
}): Buffer {
    const header = Buffer.alloc(44)
    const blockAlign = opts.channels * (opts.bitsPerSample / 8)
    const byteRate = opts.sampleRate * blockAlign
    header.write("RIFF", 0)
    header.writeUInt32LE(36 + opts.dataBytes, 4)
    header.write("WAVE", 8)
    header.write("fmt ", 12)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(opts.channels, 22)
    header.writeUInt32LE(opts.sampleRate, 24)
    header.writeUInt32LE(byteRate, 28)
    header.writeUInt16LE(blockAlign, 32)
    header.writeUInt16LE(opts.bitsPerSample, 34)
    header.write("data", 36)
    header.writeUInt32LE(opts.dataBytes, 40)
    return header
}
