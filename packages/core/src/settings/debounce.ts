/**
 * Minimal debounce — the trailing-edge flavour. Used by the SettingsTab UI to coalesce
 * rapid setting changes (e.g., dragging a color slider) into one atomic file write.
 *
 * The returned function exposes `flush()` and `cancel()` so callers can force the pending
 * call (e.g., on tab close) or drop it (e.g., on settings reset).
 */

export interface Debounced<TArgs extends unknown[]> {
    (...args: TArgs): void
    flush(): void
    cancel(): void
}

export function debounce<TArgs extends unknown[]>(
    fn: (...args: TArgs) => void | Promise<void>,
    waitMs: number
): Debounced<TArgs> {
    let timer: ReturnType<typeof setTimeout> | null = null
    let pendingArgs: TArgs | null = null

    const debounced = ((...args: TArgs) => {
        pendingArgs = args
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
            const a = pendingArgs
            timer = null
            pendingArgs = null
            if (a) void fn(...a)
        }, waitMs)
    }) as Debounced<TArgs>

    debounced.flush = () => {
        if (!timer || !pendingArgs) return
        clearTimeout(timer)
        const a = pendingArgs
        timer = null
        pendingArgs = null
        void fn(...a)
    }

    debounced.cancel = () => {
        if (timer) clearTimeout(timer)
        timer = null
        pendingArgs = null
    }

    return debounced
}
