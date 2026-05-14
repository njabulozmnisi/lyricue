import { describe, it, expect, vi } from "vitest"
import { writable } from "./observable.js"

describe("writable observable", () => {
    it("delivers the current value synchronously on subscribe", () => {
        const store = writable(10)
        const fn = vi.fn()
        store.subscribe(fn)
        expect(fn).toHaveBeenCalledWith(10)
    })

    it("notifies all subscribers on set()", () => {
        const store = writable("a")
        const a = vi.fn()
        const b = vi.fn()
        store.subscribe(a)
        store.subscribe(b)
        store.set("b")
        expect(a).toHaveBeenCalledWith("b")
        expect(b).toHaveBeenCalledWith("b")
    })

    it("does not notify when set() is called with the same value (Object.is)", () => {
        const store = writable({ x: 1 })
        const fn = vi.fn()
        store.subscribe(fn)
        fn.mockClear()
        const sameRef = store.get()
        store.set(sameRef)
        expect(fn).not.toHaveBeenCalled()
    })

    it("notifies when set() is called with a value that's structurally equal but different reference", () => {
        const store = writable({ x: 1 })
        const fn = vi.fn()
        store.subscribe(fn)
        fn.mockClear()
        store.set({ x: 1 })
        expect(fn).toHaveBeenCalledOnce()
    })

    it("unsubscribe stops further notifications", () => {
        const store = writable(0)
        const fn = vi.fn()
        const unsub = store.subscribe(fn)
        fn.mockClear()
        unsub()
        store.set(1)
        expect(fn).not.toHaveBeenCalled()
    })

    it("update() passes the current value to the updater", () => {
        const store = writable(5)
        store.update((n) => n + 1)
        expect(store.get()).toBe(6)
    })
})
