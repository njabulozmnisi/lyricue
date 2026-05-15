<!--
    DiagnosticsPanel.svelte — operator-facing health surface for the active OutputAdapter.

    Per EP-02 STORY-02.5. Subscribes to a DiagnosticsObserver's snapshot store and renders:
      - Mode badge (fork / own-window / caption-injection)
      - Live fps + dps + frames-delivered/dropped counters
      - Time since last frame (red when stale)
      - Adapter lastError (red banner when non-null)
      - Memory + uptime

    The component is presentation-only — it does NOT own the observer or the polling interval.
    Callers create the observer (with `createDiagnosticsObserver` from @lyricue/core/diagnostics),
    `start()` it, and pass `snapshots` in as a Svelte-store-compatible prop.

    Visual conventions:
      - Black background, monospace text (matches operator-tool aesthetic; readable in dim venues).
      - Status colours: green = healthy, amber = degraded but functional, red = error or stalled.
      - Numbers formatted with thousands separators (counters can reach the hundreds of thousands
        during a 90-minute service).

    The thresholds for "degraded" are deliberately generous — operators don't want false alarms.
      - dps > 0 sustained → amber (any drop is worth showing but not a panic)
      - msSinceLastFrame > 2000ms while running → red ("frames stopped")
      - lastError non-null → red

    Why no panic threshold for low fps: in some legitimate states (timer fallback, paused),
    the sync engine produces well under 60fps and that's correct. The operator interprets fps
    in context with tier (auto/timer/manual). The panel surfaces the number; it does not judge.
-->
<script lang="ts">
    import type { DiagnosticsSnapshot } from "@lyricue/core/diagnostics"

    /**
     * Svelte-store-compatible source of DiagnosticsSnapshot. Pass the `snapshots` field
     * from `createDiagnosticsObserver`'s return value. The component automatically
     * subscribes/unsubscribes via Svelte's `$store` reactivity, so no manual cleanup is needed.
     */
    export let snapshots: { subscribe: (run: (v: DiagnosticsSnapshot | null) => void) => () => void }

    /**
     * Optional label rendered in the panel header. Useful when multiple panels are
     * visible (e.g., one per output in a multi-output configuration). Default omitted.
     */
    export let label: string | undefined = undefined

    /**
     * Time-since-last-frame threshold above which msSinceLastFrame is rendered red.
     * Default 2000ms — enough time for the sync engine to legitimately hold a beat
     * but short enough that a true stall surfaces within a couple of seconds.
     */
    export let staleFrameThresholdMs = 2000

    // Svelte 3 auto-subscribes to stores via the $ prefix.
    $: snapshot = $snapshots

    function fmtInt(n: number): string {
        return n.toLocaleString("en-US")
    }

    function fmtMb(bytes: number): string {
        return (bytes / 1024 / 1024).toFixed(1) + " MB"
    }

    function fmtDuration(seconds: number): string {
        if (seconds < 60) return `${seconds.toFixed(1)}s`
        const m = Math.floor(seconds / 60)
        const s = Math.floor(seconds % 60)
        if (m < 60) return `${m}m ${s}s`
        const h = Math.floor(m / 60)
        const rm = m % 60
        return `${h}h ${rm}m`
    }

    function fmtFps(fps: number | null): string {
        if (fps === null) return "—"
        return fps.toFixed(1)
    }

    function fmtMsSince(ms: number | null): string {
        if (ms === null) return "—"
        if (ms < 1000) return `${Math.round(ms)}ms`
        return `${(ms / 1000).toFixed(1)}s`
    }

    $: isStale =
        snapshot !== null &&
        snapshot.msSinceLastFrame !== null &&
        snapshot.msSinceLastFrame > staleFrameThresholdMs

    $: hasDrops = snapshot !== null && (snapshot.instantaneousDps ?? 0) > 0

    $: hasError = snapshot !== null && snapshot.adapter.lastError !== null
</script>

<section class="diagnostics-panel" data-mode={snapshot?.adapterMode ?? "unknown"}>
    <header>
        <span class="title">Diagnostics{label ? ` — ${label}` : ""}</span>
        {#if snapshot}
            <span class="mode-badge" data-mode={snapshot.adapterMode}>{snapshot.adapterMode}</span>
        {/if}
    </header>

    {#if snapshot === null}
        <div class="waiting">Waiting for first sample…</div>
    {:else}
        {#if hasError}
            <div class="error-banner">
                <strong>Adapter error:</strong> {snapshot.adapter.lastError?.message ?? ""}
            </div>
        {/if}

        <dl class="metrics">
            <div class="metric" class:warn={hasDrops}>
                <dt>fps</dt>
                <dd>{fmtFps(snapshot.instantaneousFps)}</dd>
            </div>
            <div class="metric" class:warn={hasDrops}>
                <dt>dps</dt>
                <dd>{fmtFps(snapshot.instantaneousDps)}</dd>
            </div>
            <div class="metric">
                <dt>delivered</dt>
                <dd>{fmtInt(snapshot.adapter.framesDelivered)}</dd>
            </div>
            <div class="metric" class:warn={snapshot.adapter.framesDropped > 0}>
                <dt>dropped</dt>
                <dd>{fmtInt(snapshot.adapter.framesDropped)}</dd>
            </div>
            <div class="metric" class:error={isStale}>
                <dt>since-frame</dt>
                <dd>{fmtMsSince(snapshot.msSinceLastFrame)}</dd>
            </div>
            <div class="metric">
                <dt>memory (rss)</dt>
                <dd>{fmtMb(snapshot.memory.rss)}</dd>
            </div>
            <div class="metric">
                <dt>heap</dt>
                <dd>{fmtMb(snapshot.memory.heapUsed)} / {fmtMb(snapshot.memory.heapTotal)}</dd>
            </div>
            <div class="metric">
                <dt>uptime</dt>
                <dd>{fmtDuration(snapshot.uptimeSeconds)}</dd>
            </div>
        </dl>
    {/if}
</section>

<style>
    .diagnostics-panel {
        background: #0a0a0a;
        color: #e0e0e0;
        font-family: ui-monospace, "SF Mono", Menlo, monospace;
        font-size: 0.85rem;
        padding: 0.75rem 1rem;
        border-radius: 6px;
        border: 1px solid #222;
        min-width: 260px;
    }

    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 0.75rem;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid #1a1a1a;
    }

    .title {
        font-weight: 600;
        color: #f0f0f0;
    }

    .mode-badge {
        font-size: 0.7rem;
        padding: 0.15rem 0.5rem;
        background: #1a3a5a;
        color: #8bb8e0;
        border-radius: 3px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    .mode-badge[data-mode="fork"] {
        background: #1a3a1a;
        color: #8be08b;
    }
    .mode-badge[data-mode="caption-injection"] {
        background: #3a1a3a;
        color: #d08be0;
    }

    .waiting {
        color: #888;
        font-style: italic;
        padding: 0.5rem 0;
    }

    .error-banner {
        background: #3a1010;
        color: #f0a0a0;
        padding: 0.5rem 0.75rem;
        border-radius: 4px;
        margin-bottom: 0.75rem;
        border: 1px solid #5a2020;
    }

    .metrics {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.4rem 1rem;
        margin: 0;
    }

    .metric {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
    }

    .metric dt {
        color: #888;
        font-size: 0.75rem;
    }

    .metric dd {
        margin: 0;
        color: #e0e0e0;
        font-variant-numeric: tabular-nums;
    }

    .metric.warn dd {
        color: #f0c060;
    }

    .metric.error dd {
        color: #f08060;
        font-weight: 600;
    }
</style>
