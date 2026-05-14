import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { debounce } from "./debounce.js"

describe("debounce", () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it("waits the full delay before invoking", () => {
        const fn = vi.fn()
        const d = debounce(fn, 100)
        d("a")
        vi.advanceTimersByTime(50)
        expect(fn).not.toHaveBeenCalled()
        vi.advanceTimersByTime(50)
        expect(fn).toHaveBeenCalledOnce()
        expect(fn).toHaveBeenCalledWith("a")
    })

    it("coalesces rapid calls into a single trailing invocation", () => {
        const fn = vi.fn()
        const d = debounce(fn, 100)
        d("a")
        vi.advanceTimersByTime(50)
        d("b")
        vi.advanceTimersByTime(50)
        d("c")
        vi.advanceTimersByTime(100)
        expect(fn).toHaveBeenCalledOnce()
        expect(fn).toHaveBeenCalledWith("c")
    })

    it("flush() invokes immediately with the latest args", () => {
        const fn = vi.fn()
        const d = debounce(fn, 100)
        d("a")
        d("b")
        d.flush()
        expect(fn).toHaveBeenCalledOnce()
        expect(fn).toHaveBeenCalledWith("b")
    })

    it("cancel() drops the pending call", () => {
        const fn = vi.fn()
        const d = debounce(fn, 100)
        d("a")
        d.cancel()
        vi.advanceTimersByTime(500)
        expect(fn).not.toHaveBeenCalled()
    })

    it("flush() is a no-op when nothing is pending", () => {
        const fn = vi.fn()
        const d = debounce(fn, 100)
        d.flush()
        expect(fn).not.toHaveBeenCalled()
    })
})
