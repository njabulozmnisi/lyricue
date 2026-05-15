/**
 * Renders DiagnosticsPanel to static HTML snapshots and writes them to
 * docs/qa-reports/evidence/. Run via:
 *
 *   npx vitest run packages/ui/src/DiagnosticsPanel.evidence.ts
 *
 * This is NOT a behavioural test — it's a documentation generator that produces
 * concrete HTML/text snapshots demonstrating each render state. The snapshots are
 * committed alongside the QA report so a reviewer can see exactly what the operator
 * will see in healthy, degraded, and error states.
 */
import { describe, it, beforeEach, afterEach } from "vitest"
import { writeFileSync, mkdirSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { writable } from "@lyricue/core/settings"
import type { DiagnosticsSnapshot } from "@lyricue/core/diagnostics"
import DiagnosticsPanel from "./DiagnosticsPanel.svelte"

const EVIDENCE_DIR = resolve(
    __dirname,
    "..",
    "..",
    "..",
    "docs",
    "qa-reports",
    "evidence",
    "story-02-05-diagnostics-2026-05-15"
)

function makeSnap(overrides: Partial<DiagnosticsSnapshot> = {}): DiagnosticsSnapshot {
    return {
        sampledAt: "2026-05-15T04:00:00.000Z",
        sampledAtMs: 1000,
        adapter: {
            running: true,
            framesDelivered: 12345,
            framesDropped: 0,
            lastFrameAtMs: 999,
            lastError: null
        },
        adapterMode: "own-window",
        instantaneousFps: 60,
        instantaneousDps: 0,
        msSinceLastFrame: 16,
        memory: {
            rss: 268_435_456,
            heapUsed: 104_857_600,
            heapTotal: 209_715_200,
            external: 0
        },
        uptimeSeconds: 125,
        ...overrides
    }
}

function snapshotPanel(name: string, snap: DiagnosticsSnapshot | null, label?: string) {
    const target = document.createElement("div")
    document.body.appendChild(target)
    const snapshots = writable<DiagnosticsSnapshot | null>(snap)
    const cmp = new DiagnosticsPanel({ target, props: label ? { snapshots, label } : { snapshots } })
    if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true })
    writeFileSync(
        resolve(EVIDENCE_DIR, `${name}.html`),
        `<!doctype html>
<html><head><meta charset="utf-8"><title>${name}</title></head>
<body style="background:#333;padding:2rem;">${target.innerHTML}</body></html>`
    )
    cmp.$destroy()
    document.body.removeChild(target)
}

describe("DiagnosticsPanel evidence snapshots", () => {
    beforeEach(() => {
        if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true })
    })
    afterEach(() => {})

    it("renders healthy own-window state", () => {
        snapshotPanel("01-healthy-own-window", makeSnap(), "Main output")
    })

    it("renders waiting state (null snapshot)", () => {
        snapshotPanel("02-waiting-null", null)
    })

    it("renders degraded state with drops", () => {
        snapshotPanel(
            "03-degraded-drops",
            makeSnap({
                instantaneousDps: 3.2,
                adapter: {
                    running: true,
                    framesDelivered: 12345,
                    framesDropped: 42,
                    lastFrameAtMs: 999,
                    lastError: null
                }
            })
        )
    })

    it("renders stalled state with msSinceLastFrame > threshold", () => {
        snapshotPanel(
            "04-stalled-no-frames",
            makeSnap({
                msSinceLastFrame: 4500,
                instantaneousFps: 0
            })
        )
    })

    it("renders error state with adapter.lastError populated", () => {
        snapshotPanel(
            "05-adapter-error",
            makeSnap({
                adapter: {
                    running: false,
                    framesDelivered: 0,
                    framesDropped: 0,
                    lastFrameAtMs: null,
                    lastError: { at: 1000, message: "renderer crashed: SIGSEGV" }
                },
                instantaneousFps: null,
                instantaneousDps: null,
                msSinceLastFrame: null
            })
        )
    })

    it("renders fork-mode adapter badge", () => {
        snapshotPanel("06-fork-mode", makeSnap({ adapterMode: "fork" }), "FreeShow output")
    })
})
