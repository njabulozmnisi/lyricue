/**
 * DiagnosticsSnapshot — the read-only state shape the Diagnostics panel renders.
 *
 * Composed from:
 *   - the OutputAdapter's `AdapterHealth` (live frame stats)
 *   - derived metrics computed by DiagnosticsObserver (fps, time-since-frame)
 *   - system metrics (process.memoryUsage(), uptime)
 *
 * Per EP-02 STORY-02.5 + the M1-partial QA report (D3 carry-forward: surface actual
 * measured fps; memory growth measurement deferred to this story).
 */

import type { AdapterHealth } from "../output/output-adapter.js"

export interface DiagnosticsSnapshot {
    /** ISO-8601 timestamp the snapshot was sampled. Helps with cross-machine log correlation. */
    sampledAt: string

    /** performance.now() at sample time. Useful for computing wall-clock deltas in tests. */
    sampledAtMs: number

    /** A frozen copy of the adapter's health getter at sample time. */
    adapter: AdapterHealth

    /** Adapter type discriminator, copied from `adapter.mode` for convenience. */
    adapterMode: "fork" | "own-window" | "caption-injection"

    /**
     * Instantaneous frames-per-second over the previous polling interval. Computed as
     * (delivered - prevDelivered) / (sampledAtMs - prevSampledAtMs) * 1000. null on the
     * first snapshot (no previous interval to delta against).
     */
    instantaneousFps: number | null

    /**
     * Drops-per-second over the previous polling interval. Same formula as fps but using
     * `framesDropped`. null on the first snapshot. Operators care about non-zero values
     * here — anything > 0 sustained means the IPC pipe is congested or the renderer is stuck.
     */
    instantaneousDps: number | null

    /**
     * Wall-clock milliseconds since the last frame was delivered. Useful for detecting
     * "frames stopped arriving" (a degraded state distinct from "many drops"). null when
     * no frames have ever been delivered.
     */
    msSinceLastFrame: number | null

    /**
     * Process memory usage in bytes. RSS (Resident Set Size) is what the OS reports as
     * the process's actual memory footprint; heapUsed is V8's reported heap usage.
     * RSS - heapUsed roughly = native modules + IPC buffers + Electron's C++ side.
     */
    memory: {
        rss: number
        heapUsed: number
        heapTotal: number
        external: number
    }

    /** Process uptime in seconds. Trivial to compute; useful for spotting "we've been running for hours" leaks. */
    uptimeSeconds: number
}
