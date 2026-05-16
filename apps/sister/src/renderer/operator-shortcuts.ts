const INTERACTIVE_SHORTCUT_TARGETS = new Set(["input", "textarea", "select", "button", "a"])

export function shouldBypassOperatorShortcutTarget(target: EventTarget | null): boolean {
    if (!target || typeof target !== "object") return false
    const maybeElement = target as { tagName?: unknown; isContentEditable?: unknown }
    if (maybeElement.isContentEditable === true) return true
    if (typeof maybeElement.tagName !== "string") return false
    return INTERACTIVE_SHORTCUT_TARGETS.has(maybeElement.tagName.toLowerCase())
}
