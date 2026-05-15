import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createDiagnosticsObserver } from "./diagnostics-observer.js"
import { MockOutputAdapter } from "../output/mock-output-adapter.js"
import { makeFrame } from "../output/sync-frame-fixture.js"
import type { DiagnosticsSnapshot } from "./diagnostics-snapshot.js"

/**
 * Test fixtures: deterministic clock, deterministic memoryUsage, deterministic uptime.
 * Vitest's fake timers handle the polling interval; we inject clock/memory/uptime so
 * the snapshot's numeric fields are predictable without depending on actual process state.
 */
function makeClock(initial = 1_000) {
    let t = initial
    return {
        now: () => t,
        advance: (ms: number) => {
            t += ms
        }
    }
}

const stubMemory = (): NodeJS.MemoryUsage => ({
    rss: 100_000_000,
    heapTotal: 50_000_000,
    heapUsed: 30_000_000,
    external: 10_000_000,
    arrayBuffers: 5_000_000
})

describe("DiagnosticsObserver", () => {
    let adapter: MockOutputAdapter

    beforeEach(async () => {
        vi.useFakeTimers()
        adapter = new MockOutputAdapter()
        await adapter.start({ outputId: "out-1" })
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it("does not emit until start()", () => {
        const clock = makeClock()
        const obs = createDiagnosticsObserver({
            adapter,
            intervalMs: 1000,
            readMemoryUsage: stubMemory,
            readUptime: () => 0,
            now: clock.now
        })
        const seen: (DiagnosticsSnapshot | null)[] = []
        const unsub = obs.snapshots.subscribe((s) => seen.push(s))
        // Subscriber is told the initial value (null) — but no sample has been taken yet.
        expect(seen).toEqual([null])
        unsub()
    })

    it("emits an immediate first snapshot on start()", () => {
        const clock = makeClock()
        const obs = createDiagnosticsObserver({
            adapter,
            intervalMs: 1000,
            readMemoryUsage: stubMemory,
            readUptime: () => 42,
            now: clock.now
        })
        let latest: DiagnosticsSnapshot | null = null
        const unsub = obs.snapshots.subscribe((s) => (latest = s))
        obs.start()
        expect(latest).not.toBeNull()
        expect(latest!.uptimeSeconds).toBe(42)
        expect(latest!.adapterMode).toBe("own-window")
        // First snapshot has no previous interval, so fps/dps are null.
        expect(latest!.instantaneousFps).toBeNull()
        expect(latest!.instantaneousDps).toBeNull()
        obs.stop()
        unsub()
    })

    it("computes instantaneousFps from the delta between consecutive samples", () => {
        const clock = makeClock(0)
        const obs = createDiagnosticsObserver({
            adapter,
            intervalMs: 1000,
            readMemoryUsage: stubMemory,
            readUptime: () => 0,
            now: clock.now
        })
        const snapshots: (DiagnosticsSnapshot | null)[] = []
        obs.snapshots.subscribe((s) => snapshots.push(s))
        obs.start()
        // First sample at t=0 — 0 frames delivered.
        for (let i = 0; i < 30; i++) adapter.pushSyncFrame(makeFrame())
        clock.advance(1000)
        vi.advanceTimersByTime(1000)
        // Second sample at t=1000 — 30 frames over 1 second = 30 fps.
        const fps2 = snapshots[snapshots.length - 1]!.instantaneousFps
        expect(fps2).toBeCloseTo(30, 5)
        obs.stop()
    })

    it("computes instantaneousDps from dropped-frame delta", () => {
        // Construct an adapter that drops every frame so we can measure dps without
        // tangled state on the delivered counter.
        const droppingAdapter = new MockOutputAdapter({ dropEveryFrame: true })
        droppingAdapter.start({ outputId: "out-2" })
        const clock = makeClock(0)
        const obs = createDiagnosticsObserver({
            adapter: droppingAdapter,
            intervalMs: 1000,
            readMemoryUsage: stubMemory,
            readUptime: () => 0,
            now: clock.now
        })
        const snapshots: (DiagnosticsSnapshot | null)[] = []
        obs.snapshots.subscribe((s) => snapshots.push(s))
        obs.start()
        for (let i = 0; i < 10; i++) droppingAdapter.pushSyncFrame(makeFrame())
        clock.advance(1000)
        vi.advanceTimersByTime(1000)
        const dps2 = snapshots[snapshots.length - 1]!.instantaneousDps
        expect(dps2).toBeCloseTo(10, 5)
    })

    it("populates msSinceLastFrame from the adapter's lastFrameAtMs", () => {
        const clock = makeClock(0)
        const obs = createDiagnosticsObserver({
            adapter,
            intervalMs: 1000,
            readMemoryUsage: stubMemory,
            readUptime: () => 0,
            now: clock.now
        })
        obs.start()
        let latest: DiagnosticsSnapshot | null = null
        obs.snapshots.subscribe((s) => (latest = s))
        // Push one frame; the adapter records lastFrameAtMs from performance.now() at
        // that moment, not from our clock stub. We can't predict it exactly but it MUST
        // be non-null after the push.
        adapter.pushSyncFrame(makeFrame())
        clock.advance(1000)
        vi.advanceTimersByTime(1000)
        // After at least one sample post-frame, msSinceLastFrame must be non-null.
        expect(latest!.msSinceLastFrame).not.toBeNull()
        expect(latest!.msSinceLastFrame).toBeGreaterThanOrEqual(0)
    })

    it("msSinceLastFrame is null when no frames have been delivered", () => {
        const clock = makeClock(0)
        const obs = createDiagnosticsObserver({
            adapter,
            intervalMs: 1000,
            readMemoryUsage: stubMemory,
            readUptime: () => 0,
            now: clock.now
        })
        let latest: DiagnosticsSnapshot | null = null
        obs.snapshots.subscribe((s) => (latest = s))
        obs.start()
        expect(latest!.msSinceLastFrame).toBeNull()
    })

    it("captures memory + uptime from injected probes", () => {
        const clock = makeClock(0)
        const obs = createDiagnosticsObserver({
            adapter,
            intervalMs: 1000,
            readMemoryUsage: stubMemory,
            readUptime: () => 1234.5,
            now: clock.now
        })
        let latest: DiagnosticsSnapshot | null = null
        obs.snapshots.subscribe((s) => (latest = s))
        obs.start()
        expect(latest!.memory.rss).toBe(100_000_000)
        expect(latest!.memory.heapUsed).toBe(30_000_000)
        expect(latest!.memory.heapTotal).toBe(50_000_000)
        expect(latest!.memory.external).toBe(10_000_000)
        expect(latest!.uptimeSeconds).toBe(1234.5)
    })

    it("polls at the configured interval", () => {
        const clock = makeClock(0)
        const obs = createDiagnosticsObserver({
            adapter,
            intervalMs: 500,
            readMemoryUsage: stubMemory,
            readUptime: () => 0,
            now: clock.now
        })
        const snapshots: (DiagnosticsSnapshot | null)[] = []
        obs.snapshots.subscribe((s) => snapshots.push(s))
        obs.start()
        // start emits 1 immediate snapshot.
        // After advancing 2 seconds at 500ms intervals, expect 4 more snapshots = 5 total.
        for (let i = 0; i < 4; i++) {
            clock.advance(500)
            vi.advanceTimersByTime(500)
        }
        // null initial + 1 immediate on start() + 4 ticks = 6 entries.
        expect(snapshots.length).toBe(6)
        expect(snapshots[0]).toBeNull()
        for (let i = 1; i < 6; i++) expect(snapshots[i]).not.toBeNull()
    })

    it("start() is idempotent", () => {
        const clock = makeClock(0)
        const obs = createDiagnosticsObserver({
            adapter,
            intervalMs: 1000,
            readMemoryUsage: stubMemory,
            readUptime: () => 0,
            now: clock.now
        })
        obs.start()
        obs.start()
        expect(obs.isRunning()).toBe(true)
        const snapshots: (DiagnosticsSnapshot | null)[] = []
        obs.snapshots.subscribe((s) => snapshots.push(s))
        clock.advance(1000)
        vi.advanceTimersByTime(1000)
        // If start() had double-fired the interval, we'd see 2 ticks per advance, not 1.
        // Initial subscribe + 1 tick = 2 entries (the subscriber catches the current value).
        expect(snapshots.length).toBe(2)
        obs.stop()
    })

    it("stop() detaches the interval", () => {
        const clock = makeClock(0)
        const obs = createDiagnosticsObserver({
            adapter,
            intervalMs: 1000,
            readMemoryUsage: stubMemory,
            readUptime: () => 0,
            now: clock.now
        })
        obs.start()
        obs.stop()
        expect(obs.isRunning()).toBe(false)
        const snapshots: (DiagnosticsSnapshot | null)[] = []
        obs.snapshots.subscribe((s) => snapshots.push(s))
        clock.advance(5000)
        vi.advanceTimersByTime(5000)
        // Subscriber sees the last value once (from subscription) but no further ticks.
        expect(snapshots.length).toBe(1)
    })

    it("isRunning() reflects start/stop state", () => {
        const obs = createDiagnosticsObserver({
            adapter,
            intervalMs: 1000,
            readMemoryUsage: stubMemory,
            readUptime: () => 0,
            now: makeClock().now
        })
        expect(obs.isRunning()).toBe(false)
        obs.start()
        expect(obs.isRunning()).toBe(true)
        obs.stop()
        expect(obs.isRunning()).toBe(false)
    })

    it("emits a frozen adapter snapshot (cannot be mutated downstream)", () => {
        const obs = createDiagnosticsObserver({
            adapter,
            intervalMs: 1000,
            readMemoryUsage: stubMemory,
            readUptime: () => 0,
            now: makeClock().now
        })
        let latest: DiagnosticsSnapshot | null = null
        obs.snapshots.subscribe((s) => (latest = s))
        obs.start()
        expect(() => {
            ;(latest!.adapter as { framesDelivered: number }).framesDelivered = 999
        }).toThrow(TypeError)
    })

    it("dtMs=0 between samples doesn't divide by zero (defensive)", () => {
        const clock = makeClock(0)
        const obs = createDiagnosticsObserver({
            adapter,
            intervalMs: 1000,
            readMemoryUsage: stubMemory,
            readUptime: () => 0,
            now: clock.now
        })
        obs.start()
        let latest: DiagnosticsSnapshot | null = null
        obs.snapshots.subscribe((s) => (latest = s))
        // Advance fake-timer 0ms but force an interval tick by running setInterval handlers.
        // Easier: directly run two samples with clock stationary by manually firing the timer.
        vi.advanceTimersByTime(1000) // emits second snapshot at t=0+1000... but clock didn't advance
        // Because we didn't clock.advance(), prevSampledAtMs equals sampledAtMs, so dtMs=0.
        // The observer must NOT throw / produce NaN.
        expect(latest!.instantaneousFps).toBeNull()
        expect(latest!.instantaneousDps).toBeNull()
        obs.stop()
    })
})
