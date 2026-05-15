/**
 * DiagnosticsObserver — polls an OutputAdapter's health and emits combined snapshots.
 *
 * Per EP-02 STORY-02.5. Bridges the adapter's instantaneous health getter to the
 * Diagnostics panel UI, which needs derived metrics (fps, dps, time-since-frame) +
 * system metrics (memory, uptime) that the adapter itself shouldn't carry.
 *
 * Design:
 *   - Polls `adapter.health` on an interval (default 1s — operator-perceivable cadence;
 *     not so fast it costs frames, not so slow that an emerging issue is invisible).
 *   - On each poll, computes fps/dps deltas against the previous sample.
 *   - Captures process.memoryUsage() and Date.now() for the combined snapshot.
 *   - Publishes via a Svelte-store-compatible `Readable<DiagnosticsSnapshot | null>`.
 *
 * The first emission yields a snapshot with null `instantaneousFps`/`instantaneousDps`
 * (no previous interval to delta against). Every subsequent emission has full data.
 *
 * Why polling not push: adapters fire `pushSyncFrame` up to 60 times per second. Pushing
 * a health event on each would saturate the IPC bridge to the UI for no benefit — the
 * operator can't perceive 60Hz updates. 1Hz polling at the diagnostics layer is the
 * right granularity. STORY-02.5's AC1 ("AdapterHealth updates in real time as frames flow")
 * is satisfied because the *underlying* health updates per-frame; the *observable*
 * exposed to UI is rate-limited.
 */

import type { OutputAdapter, AdapterHealth } from "../output/output-adapter.js"
import { writable, type Readable } from "../settings/observable.js"
import type { DiagnosticsSnapshot } from "./diagnostics-snapshot.js"

export interface DiagnosticsObserverOptions {
    /** The adapter to observe. */
    adapter: OutputAdapter
    /** Poll interval in milliseconds. Default 1000ms (1 Hz). */
    intervalMs?: number
    /**
     * Optional override for the memory probe — defaults to `process.memoryUsage()`.
     * Tests inject a deterministic stub so they don't depend on actual process state.
     */
    readMemoryUsage?: () => NodeJS.MemoryUsage
    /**
     * Optional override for uptime — defaults to `process.uptime()`. Same rationale
     * as readMemoryUsage: deterministic tests.
     */
    readUptime?: () => number
    /**
     * Optional clock — defaults to performance.now(). Tests inject a stub.
     */
    now?: () => number
}

export interface DiagnosticsObserverState {
    /** Public observable for UI consumption (Svelte-store-compatible). */
    snapshots: Readable<DiagnosticsSnapshot | null>
    /** Start polling. Idempotent. */
    start(): void
    /** Stop polling and detach the interval. Idempotent. */
    stop(): void
    /** True iff polling is currently active. */
    isRunning(): boolean
}

export function createDiagnosticsObserver(opts: DiagnosticsObserverOptions): DiagnosticsObserverState {
    const adapter = opts.adapter
    const intervalMs = opts.intervalMs ?? 1000
    const readMemoryUsage = opts.readMemoryUsage ?? (() => process.memoryUsage())
    const readUptime = opts.readUptime ?? (() => process.uptime())
    const now = opts.now ?? (() => performance.now())

    const store = writable<DiagnosticsSnapshot | null>(null)
    let timer: ReturnType<typeof setInterval> | null = null
    let prevSampledAtMs: number | null = null
    let prevDelivered = 0
    let prevDropped = 0

    function sample(): void {
        const health: AdapterHealth = adapter.health
        const sampledAtMs = now()

        let instantaneousFps: number | null = null
        let instantaneousDps: number | null = null
        if (prevSampledAtMs !== null) {
            const dtMs = sampledAtMs - prevSampledAtMs
            if (dtMs > 0) {
                instantaneousFps = ((health.framesDelivered - prevDelivered) / dtMs) * 1000
                instantaneousDps = ((health.framesDropped - prevDropped) / dtMs) * 1000
            }
        }

        const msSinceLastFrame =
            health.lastFrameAtMs !== null ? Math.max(0, sampledAtMs - health.lastFrameAtMs) : null

        const mem = readMemoryUsage()
        const snapshot: DiagnosticsSnapshot = {
            sampledAt: new Date().toISOString(),
            sampledAtMs,
            adapter: health,
            adapterMode: adapter.mode,
            instantaneousFps,
            instantaneousDps,
            msSinceLastFrame,
            memory: {
                rss: mem.rss,
                heapUsed: mem.heapUsed,
                heapTotal: mem.heapTotal,
                external: mem.external
            },
            uptimeSeconds: readUptime()
        }

        prevSampledAtMs = sampledAtMs
        prevDelivered = health.framesDelivered
        prevDropped = health.framesDropped
        store.set(snapshot)
    }

    return {
        snapshots: { subscribe: (run) => store.subscribe(run) },
        start() {
            if (timer !== null) return
            // Emit one snapshot immediately so subscribers don't see null forever.
            sample()
            timer = setInterval(sample, intervalMs)
        },
        stop() {
            if (timer === null) return
            clearInterval(timer)
            timer = null
        },
        isRunning(): boolean {
            return timer !== null
        }
    }
}
