/**
 * Tiny observable that's compatible with Svelte's store contract (any object exposing
 * `subscribe(fn) → unsubscribe` is a valid Svelte store), without taking a dependency on Svelte.
 *
 * Used by the settings/identity/library-config stores so renderer Svelte components can
 * `$store.foo`-subscribe to them while the main process implements them in plain TS.
 *
 * Why roll our own instead of importing svelte/store:
 *   - `packages/core/` is mode-agnostic and must not depend on Svelte (which lives in
 *     `packages/ui/`). Pulling Svelte into core would force every consumer — including
 *     the Electron main process and the Python sidecar's IPC client — to carry it.
 *   - The contract is 20 LoC. Doing it ourselves is cheaper than pulling 100 KB of Svelte.
 */

export type Subscriber<T> = (value: T) => void
export type Unsubscribe = () => void

export interface Readable<T> {
    subscribe(run: Subscriber<T>): Unsubscribe
}

export interface Writable<T> extends Readable<T> {
    set(value: T): void
    update(updater: (current: T) => T): void
    get(): T
}

/**
 * Create a writable observable. Subscribers receive the current value synchronously on
 * subscribe, and every value thereafter.
 */
export function writable<T>(initial: T): Writable<T> {
    let value = initial
    const subscribers = new Set<Subscriber<T>>()

    return {
        subscribe(run) {
            subscribers.add(run)
            run(value)
            return () => {
                subscribers.delete(run)
            }
        },
        set(next) {
            if (Object.is(value, next)) return
            value = next
            for (const fn of subscribers) fn(value)
        },
        update(updater) {
            this.set(updater(value))
        },
        get() {
            return value
        }
    }
}
