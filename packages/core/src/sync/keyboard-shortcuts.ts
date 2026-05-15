/**
 * Keyboard shortcut router for the Sync Engine.
 *
 * Per EP-10 STORY-10.3, architecture.md §7.6, FR5.1 + FR5.2 + NFR1.6.
 *
 * Pure-logic module: takes a KeyboardEvent (or just a `code` string in tests) plus
 * the current bindings, and resolves it to an `SyncShortcutAction` — `startSync`,
 * `nextSection`, `prevSection`, `toggleManual`, or `reEngageSync`. The host then
 * dispatches the matching SyncEngine event.
 *
 * Why pure-logic, not a Svelte component:
 *   - The router runs in the renderer's global keydown handler. It has no DOM.
 *   - Pure functions test in plain Node (no jsdom needed).
 *   - The host (EP-10 operator window) attaches/detaches the listener with the
 *     correct sleeve-guard semantics (e.g., only when syncActive=true in fork mode
 *     per architecture §7.6).
 *
 * Conflict detection:
 *   - `findShortcutConflicts(bindings)` returns an array of pairs of action names
 *     that share a binding. Used by the Settings UI (STORY-10.6) to warn the
 *     operator at save time.
 *
 * Modifier policy:
 *   - LyriCue shortcuts are unmodified by design — the operator's hands are on a
 *     plain keyboard during live worship, not holding Ctrl. Any modifier (Ctrl,
 *     Meta, Alt, Shift) blocks the match. This avoids stealing browser shortcuts
 *     like Ctrl+R / Cmd+T from FreeShow.
 */

import type { LyriCueSettings } from "../types/settings.js"

/**
 * The five operator actions per architecture.md §6.5 ShortcutsSchema. SE has an event
 * per action; the router just maps key → action and lets the caller dispatch.
 */
export type SyncShortcutAction =
    | "startSync"
    | "nextSection"
    | "prevSection"
    | "toggleManual"
    | "reEngageSync"

/**
 * Minimal subset of KeyboardEvent we need. The full DOM type drags in a lot; this
 * subset is everything the resolver inspects. Production callers pass the real event;
 * tests pass a plain object with just these fields.
 */
export interface KeyboardEventLike {
    code: string
    ctrlKey: boolean
    metaKey: boolean
    altKey: boolean
    shiftKey: boolean
}

export type ShortcutBindings = LyriCueSettings["shortcuts"]

/**
 * Resolve a KeyboardEvent to the operator action it triggers, or null if no binding
 * matches. Modifier keys block the match (see "modifier policy" in the file header).
 *
 * Implementation note: the binding values are KeyboardEvent.code strings (e.g.,
 * "Space", "ArrowRight"), not key strings. Code is locale-stable — pressing the
 * 'A' key on a Dvorak layout still emits `KeyA`. The operator's muscle memory is
 * by physical key position, not letter.
 */
export function resolveShortcut(
    event: KeyboardEventLike,
    bindings: ShortcutBindings
): SyncShortcutAction | null {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null
    const actions: SyncShortcutAction[] = [
        "startSync",
        "nextSection",
        "prevSection",
        "toggleManual",
        "reEngageSync"
    ]
    for (const action of actions) {
        if (bindings[action] === event.code) return action
    }
    return null
}

/**
 * Conflict detector for the Settings UI. Returns an array of conflict descriptors,
 * each naming the conflicting actions and the shared key code. Empty array means
 * the bindings are valid.
 */
export interface ShortcutConflict {
    code: string
    actions: SyncShortcutAction[]
}

export function findShortcutConflicts(bindings: ShortcutBindings): ShortcutConflict[] {
    const byCode = new Map<string, SyncShortcutAction[]>()
    const allActions: SyncShortcutAction[] = [
        "startSync",
        "nextSection",
        "prevSection",
        "toggleManual",
        "reEngageSync"
    ]
    for (const action of allActions) {
        const code = bindings[action]
        if (!byCode.has(code)) byCode.set(code, [])
        byCode.get(code)!.push(action)
    }
    const conflicts: ShortcutConflict[] = []
    for (const [code, actions] of byCode) {
        if (actions.length > 1) conflicts.push({ code, actions })
    }
    return conflicts
}

/**
 * Construct a keydown handler that routes a KeyboardEvent through `resolveShortcut`
 * and invokes one of the action callbacks. Returns the handler — the caller attaches
 * it to the document (or any element).
 *
 * `getBindings()` is invoked per-event so the handler reflects live settings changes
 * without needing to re-bind. Passing a function rather than a value lets the host
 * wire it to a Svelte store's subscribe.
 *
 * `getEnabled()` (optional) gates the handler — useful for the sleeve-guard pattern
 * where shortcuts should only fire when syncActive=true (architecture.md §7.6).
 */
export interface ShortcutHandlerCallbacks {
    onStartSync(): void
    onNextSection(): void
    onPrevSection(): void
    onToggleManual(): void
    onReEngageSync(): void
}

export interface ShortcutHandlerOptions {
    getBindings(): ShortcutBindings
    callbacks: ShortcutHandlerCallbacks
    /** Optional gate. If provided and returns false, the handler is a no-op. */
    getEnabled?: () => boolean
}

export function createShortcutHandler(
    opts: ShortcutHandlerOptions
): (event: KeyboardEventLike) => SyncShortcutAction | null {
    return (event) => {
        if (opts.getEnabled && !opts.getEnabled()) return null
        const action = resolveShortcut(event, opts.getBindings())
        if (action === null) return null
        switch (action) {
            case "startSync":
                opts.callbacks.onStartSync()
                break
            case "nextSection":
                opts.callbacks.onNextSection()
                break
            case "prevSection":
                opts.callbacks.onPrevSection()
                break
            case "toggleManual":
                opts.callbacks.onToggleManual()
                break
            case "reEngageSync":
                opts.callbacks.onReEngageSync()
                break
        }
        return action
    }
}
