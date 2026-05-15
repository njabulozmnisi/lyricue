import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { writable } from "@lyricue/core/settings"
import type { DiagnosticsSnapshot } from "@lyricue/core/diagnostics"
import DiagnosticsPanel from "./DiagnosticsPanel.svelte"

/**
 * These tests render the DiagnosticsPanel directly into jsdom with a writable store
 * playing the role of the observer's `snapshots` field. They verify the visible
 * contract: which elements render, which class flags get set, which numbers appear.
 *
 * No @testing-library/svelte dependency — Svelte 3 components mount via their own
 * constructor, which is light enough that the tests can drive it directly.
 */

function makeSnapshot(overrides: Partial<DiagnosticsSnapshot> = {}): DiagnosticsSnapshot {
    return {
        sampledAt: "2026-05-15T00:00:00.000Z",
        sampledAtMs: 1000,
        adapter: {
            running: true,
            framesDelivered: 1234,
            framesDropped: 0,
            lastFrameAtMs: 999,
            lastError: null
        },
        adapterMode: "own-window",
        instantaneousFps: 60,
        instantaneousDps: 0,
        msSinceLastFrame: 16,
        memory: { rss: 200_000_000, heapUsed: 80_000_000, heapTotal: 120_000_000, external: 10_000_000 },
        uptimeSeconds: 42.5,
        ...overrides
    }
}

describe("DiagnosticsPanel", () => {
    let target: HTMLElement

    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })

    afterEach(() => {
        document.body.removeChild(target)
    })

    it("shows a 'waiting' state when the snapshot is null", () => {
        const snapshots = writable<DiagnosticsSnapshot | null>(null)
        const cmp = new DiagnosticsPanel({ target, props: { snapshots } })
        expect(target.querySelector(".waiting")?.textContent).toContain("Waiting")
        cmp.$destroy()
    })

    it("renders the mode badge from snapshot.adapterMode", () => {
        const snapshots = writable<DiagnosticsSnapshot | null>(makeSnapshot({ adapterMode: "fork" }))
        const cmp = new DiagnosticsPanel({ target, props: { snapshots } })
        const badge = target.querySelector(".mode-badge")
        expect(badge?.textContent).toBe("fork")
        expect(badge?.getAttribute("data-mode")).toBe("fork")
        cmp.$destroy()
    })

    it("renders the optional label in the header", () => {
        const snapshots = writable<DiagnosticsSnapshot | null>(makeSnapshot())
        const cmp = new DiagnosticsPanel({ target, props: { snapshots, label: "Main output" } })
        const title = target.querySelector(".title")
        expect(title?.textContent).toContain("Main output")
        cmp.$destroy()
    })

    it("renders fps with one decimal place", () => {
        const snapshots = writable<DiagnosticsSnapshot | null>(makeSnapshot({ instantaneousFps: 59.876 }))
        const cmp = new DiagnosticsPanel({ target, props: { snapshots } })
        const dds = Array.from(target.querySelectorAll("dd")).map((d) => d.textContent)
        expect(dds).toContain("59.9")
        cmp.$destroy()
    })

    it("renders an em-dash for null fps/dps (first sample)", () => {
        const snapshots = writable<DiagnosticsSnapshot | null>(
            makeSnapshot({ instantaneousFps: null, instantaneousDps: null })
        )
        const cmp = new DiagnosticsPanel({ target, props: { snapshots } })
        const dds = Array.from(target.querySelectorAll("dd")).map((d) => d.textContent)
        // The fps and dps slots should be "—".
        const dashCount = dds.filter((t) => t === "—").length
        expect(dashCount).toBeGreaterThanOrEqual(2)
        cmp.$destroy()
    })

    it("applies the 'warn' class when dps > 0", () => {
        const snapshots = writable<DiagnosticsSnapshot | null>(makeSnapshot({ instantaneousDps: 3 }))
        const cmp = new DiagnosticsPanel({ target, props: { snapshots } })
        const warnElems = target.querySelectorAll(".metric.warn")
        // fps and dps rows both warn when there are drops.
        expect(warnElems.length).toBeGreaterThanOrEqual(2)
        cmp.$destroy()
    })

    it("applies the 'error' class to since-frame when msSinceLastFrame exceeds the threshold", () => {
        const snapshots = writable<DiagnosticsSnapshot | null>(
            makeSnapshot({ msSinceLastFrame: 5000 })
        )
        const cmp = new DiagnosticsPanel({
            target,
            props: { snapshots, staleFrameThresholdMs: 2000 }
        })
        const errorElems = target.querySelectorAll(".metric.error")
        expect(errorElems.length).toBe(1)
        cmp.$destroy()
    })

    it("does NOT apply the 'error' class when msSinceLastFrame is within threshold", () => {
        const snapshots = writable<DiagnosticsSnapshot | null>(
            makeSnapshot({ msSinceLastFrame: 100 })
        )
        const cmp = new DiagnosticsPanel({
            target,
            props: { snapshots, staleFrameThresholdMs: 2000 }
        })
        expect(target.querySelectorAll(".metric.error").length).toBe(0)
        cmp.$destroy()
    })

    it("renders an error banner when adapter.lastError is non-null", () => {
        const snapshots = writable<DiagnosticsSnapshot | null>(
            makeSnapshot({
                adapter: {
                    running: true,
                    framesDelivered: 0,
                    framesDropped: 0,
                    lastFrameAtMs: null,
                    lastError: { at: 1000, message: "Window closed unexpectedly" }
                }
            })
        )
        const cmp = new DiagnosticsPanel({ target, props: { snapshots } })
        const banner = target.querySelector(".error-banner")
        expect(banner?.textContent).toContain("Window closed unexpectedly")
        cmp.$destroy()
    })

    it("does NOT render the error banner when lastError is null", () => {
        const snapshots = writable<DiagnosticsSnapshot | null>(makeSnapshot())
        const cmp = new DiagnosticsPanel({ target, props: { snapshots } })
        expect(target.querySelector(".error-banner")).toBeNull()
        cmp.$destroy()
    })

    it("formats memory as MB with one decimal", () => {
        const snapshots = writable<DiagnosticsSnapshot | null>(
            makeSnapshot({
                memory: {
                    rss: 268_435_456, // 256.0 MB exactly
                    heapUsed: 104_857_600, // 100.0 MB
                    heapTotal: 209_715_200, // 200.0 MB
                    external: 0
                }
            })
        )
        const cmp = new DiagnosticsPanel({ target, props: { snapshots } })
        const text = target.textContent ?? ""
        expect(text).toContain("256.0 MB")
        expect(text).toContain("100.0 MB")
        expect(text).toContain("200.0 MB")
        cmp.$destroy()
    })

    it("formats uptime in seconds when under a minute", () => {
        const snapshots = writable<DiagnosticsSnapshot | null>(makeSnapshot({ uptimeSeconds: 42.5 }))
        const cmp = new DiagnosticsPanel({ target, props: { snapshots } })
        expect(target.textContent).toContain("42.5s")
        cmp.$destroy()
    })

    it("formats uptime in minutes when over a minute, under an hour", () => {
        const snapshots = writable<DiagnosticsSnapshot | null>(
            makeSnapshot({ uptimeSeconds: 125 }) // 2m 5s
        )
        const cmp = new DiagnosticsPanel({ target, props: { snapshots } })
        expect(target.textContent).toContain("2m 5s")
        cmp.$destroy()
    })

    it("formats uptime in hours when over an hour", () => {
        const snapshots = writable<DiagnosticsSnapshot | null>(
            makeSnapshot({ uptimeSeconds: 3725 }) // 1h 2m
        )
        const cmp = new DiagnosticsPanel({ target, props: { snapshots } })
        expect(target.textContent).toContain("1h 2m")
        cmp.$destroy()
    })

    it("formats delivered/dropped counters with thousands separators", () => {
        const snapshots = writable<DiagnosticsSnapshot | null>(
            makeSnapshot({
                adapter: {
                    outputId: "test-out",
                    framesDelivered: 1_234_567,
                    framesDropped: 1234,
                    lastFrameAtMs: 999,
                    lastError: null
                }
            })
        )
        const cmp = new DiagnosticsPanel({ target, props: { snapshots } })
        const text = target.textContent ?? ""
        expect(text).toContain("1,234,567")
        expect(text).toContain("1,234")
        cmp.$destroy()
    })

    it("updates reactively when the store emits a new snapshot", async () => {
        const snapshots = writable<DiagnosticsSnapshot | null>(
            makeSnapshot({ instantaneousFps: 30 })
        )
        const cmp = new DiagnosticsPanel({ target, props: { snapshots } })
        expect(target.textContent).toContain("30.0")

        snapshots.set(makeSnapshot({ instantaneousFps: 60 }))
        // Svelte 3 flushes synchronously on store set in this configuration; await a tick to be safe.
        await Promise.resolve()
        expect(target.textContent).toContain("60.0")
        cmp.$destroy()
    })
})
