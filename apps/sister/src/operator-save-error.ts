/**
 * Operator save-error tracker (D-T13 closure).
 *
 * Background save paths in the sister host (audio device, shortcut rebind, library
 * config, settings) used to silently swallow persistence failures with .catch(log).
 * Under EROFS/ENOSPC the in-memory state advanced but disk did not — on next launch
 * the saved value silently reverted. Operators had no visibility.
 *
 * This tracker is the host-neutral state shape the renderer reads off the operator
 * state envelope. The renderer shows a transient banner whenever lastSaveError is
 * non-null; the host clears it on the next successful save in the same scope so
 * stale errors don't linger.
 */

export interface OperatorSaveError {
    /** Logical scope identifier — e.g. "audio-device", "library-config", "shortcuts". */
    scope: string
    /** One-line message safe to display to the operator. */
    message: string
    /** Wall-clock ms when the failure was recorded. */
    atWallMs: number
}

/**
 * Update the tracked save error after a save attempt.
 *
 *   - On failure: record the new error keyed by scope.
 *   - On success in a scope that previously failed: clear the prior error.
 *   - On success in a scope that did not fail: leave any unrelated prior error in place.
 *
 * Returns the next state (null when no error is active). The caller persists the
 * returned value into the broadcast envelope.
 */
export function nextSaveErrorState(
    current: OperatorSaveError | null,
    update:
        | { kind: "success"; scope: string }
        | { kind: "failure"; scope: string; error: unknown; atWallMs: number }
): OperatorSaveError | null {
    if (update.kind === "success") {
        if (current?.scope === update.scope) return null
        return current
    }
    const message = update.error instanceof Error ? update.error.message : String(update.error)
    return { scope: update.scope, message, atWallMs: update.atWallMs }
}
