import { describe, expect, it } from "vitest"
import { shouldBypassOperatorShortcutTarget } from "./operator-shortcuts.js"

describe("operator shortcut focus guard", () => {
    it.each(["input", "textarea", "select", "button", "a"])(
        "bypasses shortcuts for %s targets",
        (tagName) => {
            expect(shouldBypassOperatorShortcutTarget({ tagName })).toBe(true)
        }
    )

    it("bypasses shortcuts for contenteditable targets", () => {
        expect(shouldBypassOperatorShortcutTarget({ tagName: "div", isContentEditable: true })).toBe(true)
    })

    it("allows shortcuts for non-interactive targets", () => {
        expect(shouldBypassOperatorShortcutTarget({ tagName: "section", isContentEditable: false })).toBe(false)
    })

    it("allows shortcuts when there is no concrete target", () => {
        expect(shouldBypassOperatorShortcutTarget(null)).toBe(false)
    })
})
