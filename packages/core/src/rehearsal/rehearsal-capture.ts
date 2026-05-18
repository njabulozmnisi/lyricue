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
