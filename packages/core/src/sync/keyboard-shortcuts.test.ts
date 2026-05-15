import { describe, it, expect, vi } from "vitest"
import {
    createShortcutHandler,
    findShortcutConflicts,
    resolveShortcut,
    type KeyboardEventLike,
    type ShortcutBindings
} from "./keyboard-shortcuts.js"

const DEFAULT_BINDINGS: ShortcutBindings = {
    startSync: "Space",
    nextSection: "ArrowRight",
    prevSection: "ArrowLeft",
    toggleManual: "Escape",
    reEngageSync: "Enter"
}

function ev(code: string, modifiers: Partial<KeyboardEventLike> = {}): KeyboardEventLike {
    return {
        code,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        ...modifiers
    }
}

describe("resolveShortcut", () => {
    it("returns the action for each default binding", () => {
        expect(resolveShortcut(ev("Space"), DEFAULT_BINDINGS)).toBe("startSync")
        expect(resolveShortcut(ev("ArrowRight"), DEFAULT_BINDINGS)).toBe("nextSection")
        expect(resolveShortcut(ev("ArrowLeft"), DEFAULT_BINDINGS)).toBe("prevSection")
        expect(resolveShortcut(ev("Escape"), DEFAULT_BINDINGS)).toBe("toggleManual")
        expect(resolveShortcut(ev("Enter"), DEFAULT_BINDINGS)).toBe("reEngageSync")
    })

    it("returns null when the code matches nothing", () => {
        expect(resolveShortcut(ev("KeyA"), DEFAULT_BINDINGS)).toBeNull()
        expect(resolveShortcut(ev("F1"), DEFAULT_BINDINGS)).toBeNull()
    })

    it("blocks the match when ANY modifier is pressed", () => {
        expect(resolveShortcut(ev("Space", { ctrlKey: true }), DEFAULT_BINDINGS)).toBeNull()
        expect(resolveShortcut(ev("Space", { metaKey: true }), DEFAULT_BINDINGS)).toBeNull()
        expect(resolveShortcut(ev("Space", { altKey: true }), DEFAULT_BINDINGS)).toBeNull()
        expect(resolveShortcut(ev("Space", { shiftKey: true }), DEFAULT_BINDINGS)).toBeNull()
    })

    it("respects custom bindings", () => {
        const custom: ShortcutBindings = {
            ...DEFAULT_BINDINGS,
            nextSection: "KeyN",
            prevSection: "KeyP"
        }
        expect(resolveShortcut(ev("KeyN"), custom)).toBe("nextSection")
        expect(resolveShortcut(ev("KeyP"), custom)).toBe("prevSection")
        // The defaults no longer fire under the custom binding.
        expect(resolveShortcut(ev("ArrowRight"), custom)).toBeNull()
    })

    it("returns the first matching action when two are bound to the same code (deterministic order)", () => {
        // Action iteration order: startSync, nextSection, prevSection, toggleManual, reEngageSync.
        // A conflict (both nextSection and prevSection on "KeyX") should resolve to whichever
        // comes first in iteration — here, nextSection.
        const conflicting: ShortcutBindings = {
            ...DEFAULT_BINDINGS,
            nextSection: "KeyX",
            prevSection: "KeyX"
        }
        expect(resolveShortcut(ev("KeyX"), conflicting)).toBe("nextSection")
    })
})

describe("findShortcutConflicts", () => {
    it("returns an empty array for a valid binding set", () => {
        expect(findShortcutConflicts(DEFAULT_BINDINGS)).toEqual([])
    })

    it("reports a pairwise conflict", () => {
        const conflicting: ShortcutBindings = {
            ...DEFAULT_BINDINGS,
            nextSection: "KeyX",
            prevSection: "KeyX"
        }
        const c = findShortcutConflicts(conflicting)
        expect(c).toHaveLength(1)
        expect(c[0]!.code).toBe("KeyX")
        expect(c[0]!.actions).toContain("nextSection")
        expect(c[0]!.actions).toContain("prevSection")
    })

    it("reports a 3-way conflict as a single entry with three actions", () => {
        const triple: ShortcutBindings = {
            ...DEFAULT_BINDINGS,
            startSync: "KeyZ",
            nextSection: "KeyZ",
            prevSection: "KeyZ"
        }
        const c = findShortcutConflicts(triple)
        expect(c).toHaveLength(1)
        expect(c[0]!.actions).toHaveLength(3)
    })

    it("reports multiple conflicts when independent keys collide", () => {
        const multi: ShortcutBindings = {
            startSync: "KeyA",
            nextSection: "KeyA",
            prevSection: "KeyB",
            toggleManual: "KeyB",
            reEngageSync: "KeyC"
        }
        const c = findShortcutConflicts(multi)
        expect(c).toHaveLength(2)
        const codes = c.map((x) => x.code).sort()
        expect(codes).toEqual(["KeyA", "KeyB"])
    })
})

describe("createShortcutHandler", () => {
    function makeCallbacks() {
        return {
            onStartSync: vi.fn(),
            onNextSection: vi.fn(),
            onPrevSection: vi.fn(),
            onToggleManual: vi.fn(),
            onReEngageSync: vi.fn()
        }
    }

    it("dispatches the correct callback per default binding", () => {
        const cbs = makeCallbacks()
        const handler = createShortcutHandler({
            getBindings: () => DEFAULT_BINDINGS,
            callbacks: cbs
        })
        handler(ev("Space"))
        expect(cbs.onStartSync).toHaveBeenCalledTimes(1)
        handler(ev("ArrowRight"))
        expect(cbs.onNextSection).toHaveBeenCalledTimes(1)
        handler(ev("Escape"))
        expect(cbs.onToggleManual).toHaveBeenCalledTimes(1)
    })

    it("returns the resolved action or null", () => {
        const handler = createShortcutHandler({
            getBindings: () => DEFAULT_BINDINGS,
            callbacks: makeCallbacks()
        })
        expect(handler(ev("Space"))).toBe("startSync")
        expect(handler(ev("KeyA"))).toBeNull()
    })

    it("re-reads bindings on every event (live-update friendly)", () => {
        let bindings = { ...DEFAULT_BINDINGS }
        const cbs = makeCallbacks()
        const handler = createShortcutHandler({
            getBindings: () => bindings,
            callbacks: cbs
        })
        handler(ev("Space"))
        expect(cbs.onStartSync).toHaveBeenCalledTimes(1)
        // Operator rebinds startSync to KeyN.
        bindings = { ...bindings, startSync: "KeyN" }
        handler(ev("Space")) // no longer fires
        expect(cbs.onStartSync).toHaveBeenCalledTimes(1)
        handler(ev("KeyN"))
        expect(cbs.onStartSync).toHaveBeenCalledTimes(2)
    })

    it("is a no-op when getEnabled returns false (sleeve-guard pattern)", () => {
        const cbs = makeCallbacks()
        let enabled = false
        const handler = createShortcutHandler({
            getBindings: () => DEFAULT_BINDINGS,
            callbacks: cbs,
            getEnabled: () => enabled
        })
        expect(handler(ev("Space"))).toBeNull()
        expect(cbs.onStartSync).toHaveBeenCalledTimes(0)
        enabled = true
        expect(handler(ev("Space"))).toBe("startSync")
        expect(cbs.onStartSync).toHaveBeenCalledTimes(1)
    })

    it("ignores modified events", () => {
        const cbs = makeCallbacks()
        const handler = createShortcutHandler({
            getBindings: () => DEFAULT_BINDINGS,
            callbacks: cbs
        })
        expect(handler(ev("Space", { ctrlKey: true }))).toBeNull()
        expect(cbs.onStartSync).toHaveBeenCalledTimes(0)
    })
})
