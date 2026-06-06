import { describe, expect, it } from "vitest"
import { Float32RingBuffer } from "./ring-buffer.js"

describe("Float32RingBuffer", () => {
    it("returns samples in chronological order before overflow", () => {
        const buffer = new Float32RingBuffer(5)
        buffer.push(new Float32Array([1, 2, 3]))

        expect(Array.from(buffer.snapshot())).toEqual([1, 2, 3])
        expect(buffer.size).toBe(3)
    })

    it("keeps only the newest samples after overflow", () => {
        const buffer = new Float32RingBuffer(5)
        buffer.push(new Float32Array([1, 2, 3]))
        buffer.push(new Float32Array([4, 5, 6, 7]))

        expect(Array.from(buffer.snapshot())).toEqual([3, 4, 5, 6, 7])
        expect(buffer.size).toBe(5)
    })

    it("handles a single push larger than capacity", () => {
        const buffer = new Float32RingBuffer(3)
        buffer.push(new Float32Array([1, 2, 3, 4, 5]))

        expect(Array.from(buffer.snapshot())).toEqual([3, 4, 5])
    })

    it("returns a defensive snapshot copy", () => {
        const buffer = new Float32RingBuffer(3)
        buffer.push(new Float32Array([1, 2, 3]))
        const snapshot = buffer.snapshot()
        snapshot[0] = 99

        expect(Array.from(buffer.snapshot())).toEqual([1, 2, 3])
    })
})
