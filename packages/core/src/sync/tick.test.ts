import { describe, it, expect } from "vitest"
import { tick } from "./tick.js"
import {
    applyEvent,
    CONFIDENCE_DEGRADATION_MS,
    makeInitialState,
    POSITION_CORRECTION_DURATION_MS,
    type SyncEngineState
} from "./sync-engine-state.js"
import type { TimingMap } from "../types/timing-map.js"

/**
 * STORY-09.2 acceptance tests for the rAF tick function. Also covers tier-degradation
 * accumulator (09.4), position-correction interpolation (09.6), and song-boundary
 * detection (09.7).
 *
 * The tick function is pure — we drive it with synthetic wall-clock timestamps and
 * assert the resulting state.
 */

function makeMap(): TimingMap {
    return {
        $schema: "lyricue-timing-v1",
        showId: "s1",
        learnedFrom: { method: "studio", duration: 1, learnedAt: "2026-05-15T00:00:00Z" },
        bpm: 120,
        language: "en",
        sections: [
            {
                id: "v1",
                type: "verse",
                label: "Verse 1",
                slideIndex: 0,
                startMs: 0,
                endMs: 5_000,
                words: [
                    { text: "a", startMs: 0, endMs: 1000, confidence: 0.9, lineIndex: 0 },
                    { text: "b", startMs: 1000, endMs: 2000, confidence: 0.9, lineIndex: 0 },
                    { text: "c", startMs: 2000, endMs: 3000, confidence: 0.9, lineIndex: 0 },
                    { text: "d", startMs: 3000, endMs: 4000, confidence: 0.9, lineIndex: 0 },
                    { text: "e", startMs: 4000, endMs: 5000, confidence: 0.9, lineIndex: 0 }
                ],
                lines: []
            }
        ],
        metadata: { schemaVersion: "1", version: "1.0.0" }
    }
}

function loadAndEngage(wallTime = 0): SyncEngineState {
    const map = makeMap()
    let s = applyEvent(makeInitialState(), {
        kind: "loadSong",
        map,
        arrangement: null,
        showId: map.showId
    })
    s = applyEvent(s, { kind: "engageSync", wallTime })
    s = applyEvent(s, { kind: "vadUpdate", vadState: "active" })
    return s
}

describe("tick — idle / waitingForStart / finished", () => {
    it("returns unchanged for idle state but updates lastTickWallTime", () => {
        const s0 = makeInitialState()
        const s1 = tick(s0, 100)
        expect(s1.runState).toBe("idle")
        expect(s1.cursorRefTime).toBe(0)
        expect(s1.lastTickWallTime).toBe(100)
    })

    it("does not advance the cursor in waitingForStart", () => {
        const map = makeMap()
        const s0 = applyEvent(makeInitialState(), {
            kind: "loadSong",
            map,
            arrangement: null,
            showId: map.showId
        })
        const s1 = tick(s0, 100)
        expect(s1.runState).toBe("waitingForStart")
        expect(s1.cursorRefTime).toBe(0)
    })

    it("does not advance the cursor in finished", () => {
        const s0 = { ...makeInitialState(), runState: "finished" as const, cursorRefTime: 9_999 }
        const s1 = tick(s0, 100)
        expect(s1.cursorRefTime).toBe(9_999)
    })
})

describe("tick — cursor advance (STORY-09.2 AC2)", () => {
    it("advances cursorRefTime by wallElapsed * tempoRatio in auto tier", () => {
        const s0 = loadAndEngage(0)
        const s1 = tick({ ...s0, tempoRatio: 1.2 }, 100)
        // wallElapsed = 100ms; tempoRatio = 1.2 → cursorRefTime = 120
        expect(s1.cursorRefTime).toBeCloseTo(120, 2)
    })

    it("advances at native speed (1.0) in timer tier regardless of tempoRatio", () => {
        const s0 = { ...loadAndEngage(0), tier: "timer" as const, tempoRatio: 1.4 }
        const s1 = tick(s0, 100)
        expect(s1.cursorRefTime).toBeCloseTo(100, 2)
    })

    it("does NOT advance the cursor in manual tier", () => {
        const s0 = { ...loadAndEngage(0), tier: "manual" as const }
        const s1 = tick(s0, 100)
        expect(s1.cursorRefTime).toBe(0)
    })
})

describe("tick — VAD gate (STORY-09.2 AC4)", () => {
    it("holds the cursor when vadState === 'silent'", () => {
        const s0 = loadAndEngage(0)
        const silenced = applyEvent(s0, { kind: "vadUpdate", vadState: "silent" })
        const s1 = tick(silenced, 100)
        expect(s1.cursorRefTime).toBe(0)
    })

    it("resumes advance when VAD returns to 'active'", () => {
        const s0 = loadAndEngage(0)
        const silenced = applyEvent(s0, { kind: "vadUpdate", vadState: "silent" })
        const t1 = tick(silenced, 500) // 500ms of silence — cursor frozen
        expect(t1.cursorRefTime).toBe(0)
        const resumed = applyEvent(t1, { kind: "vadUpdate", vadState: "active" })
        const t2 = tick(resumed, 600) // 100ms of activity at tempoRatio=1.0
        expect(t2.cursorRefTime).toBeCloseTo(100, 2)
    })
})

describe("tick — word resolution", () => {
    it("updates currentSlideIndex + currentWordIndex + wordProgress on each tick", () => {
        const s0 = loadAndEngage(0)
        const s1 = tick(s0, 1500) // cursor → 1500ms in word "b" (1000–2000)
        expect(s1.currentSlideIndex).toBe(0)
        expect(s1.currentWordIndex).toBe(1)
        expect(s1.wordProgress).toBeCloseTo(0.5, 2)
    })
})

describe("tick — tier degradation accumulator (STORY-09.4)", () => {
    /** A longer test map so the song doesn't end before the 10s accumulator threshold. */
    function loadAndEngageLong(wallTime = 0): SyncEngineState {
        const map: TimingMap = {
            ...makeMap(),
            sections: [
                {
                    id: "v1",
                    type: "verse",
                    label: "Verse",
                    slideIndex: 0,
                    startMs: 0,
                    endMs: 60_000, // 60-second map
                    words: Array.from({ length: 60 }, (_, i) => ({
                        text: `w${i}`,
                        startMs: i * 1000,
                        endMs: (i + 1) * 1000,
                        confidence: 0.9,
                        lineIndex: 0
                    })),
                    lines: []
                }
            ]
        }
        let s = applyEvent(makeInitialState(), {
            kind: "loadSong",
            map,
            arrangement: null,
            showId: map.showId
        })
        s = applyEvent(s, { kind: "engageSync", wallTime })
        s = applyEvent(s, { kind: "vadUpdate", vadState: "active" })
        return s
    }

    it("auto → timer after CONFIDENCE_DEGRADATION_MS of low confidence", () => {
        let s = loadAndEngageLong(0)
        s = { ...s, beatConfidence: 0.2 } // below threshold
        // Walk forward by 1s intervals; should degrade just after 10s.
        let now = 0
        for (let i = 0; i < 10; i++) {
            now += 1_000
            s = tick(s, now)
            expect(s.tier).toBe("auto")
        }
        now += 1_000 // 11 seconds total — past threshold
        s = tick(s, now)
        expect(s.tier).toBe("timer")
        expect(s.lowConfidenceDurationMs).toBe(0)
    })

    it("resets the accumulator on a confident tick", () => {
        let s = loadAndEngageLong(0)
        s = { ...s, beatConfidence: 0.2 }
        s = tick(s, 5_000) // 5s of low confidence
        expect(s.lowConfidenceDurationMs).toBeGreaterThan(4_000)
        s = { ...s, beatConfidence: 0.9 } // confident
        s = tick(s, 6_000)
        expect(s.lowConfidenceDurationMs).toBe(0)
        expect(s.tier).toBe("auto")
    })

    it("does not accumulate in timer or manual tiers", () => {
        const s0 = { ...loadAndEngage(0), tier: "timer" as const, beatConfidence: 0 }
        const s1 = tick(s0, 5_000)
        expect(s1.lowConfidenceDurationMs).toBe(0)
        expect(s1.tier).toBe("timer")
    })

    it("honours a custom confidenceDegradationMs option", () => {
        let s = loadAndEngage(0)
        s = { ...s, beatConfidence: 0.2 }
        // Custom 500ms threshold — should degrade after 500ms.
        s = tick(s, 300, { confidenceDegradationMs: 500 })
        expect(s.tier).toBe("auto")
        s = tick(s, 700, { confidenceDegradationMs: 500 })
        expect(s.tier).toBe("timer")
    })
})

describe("tick — position correction animation (STORY-09.6)", () => {
    it("interpolates linearly from anchor to target over POSITION_CORRECTION_DURATION_MS", () => {
        let s = loadAndEngage(0)
        s = tick(s, 1_000) // cursor → 1_000
        s = applyEvent(s, { kind: "positionCorrection", targetRefMs: 5_000, wallTime: 1_000 })
        // At t=1_000+150ms (halfway through 300ms animation), cursor should be ~3_000.
        s = tick(s, 1_150)
        expect(s.cursorRefTime).toBeGreaterThan(2_500)
        expect(s.cursorRefTime).toBeLessThan(3_500)
        // At t=1_000+300ms, animation completes — cursor at target.
        s = tick(s, 1_300)
        expect(s.cursorRefTime).toBe(5_000)
        expect(s.positionCorrectionTargetMs).toBeNull()
    })

    it("a new correction during an in-flight animation snaps the anchor + re-animates", () => {
        let s = loadAndEngage(0)
        s = tick(s, 1_000) // cursor → 1_000
        s = applyEvent(s, { kind: "positionCorrection", targetRefMs: 5_000, wallTime: 1_000 })
        s = tick(s, 1_150) // halfway: cursor ~3_000
        const midCursor = s.cursorRefTime
        // Wait — the manual debounce window is set at wallTime 0 if any. Since we didn't
        // call nextSection/toggleManual, there's no debounce. But the positionCorrection
        // transition uses state.lastManualInterventionAt — and engageSync doesn't set it.
        s = applyEvent(s, { kind: "positionCorrection", targetRefMs: 1_000, wallTime: 1_150 })
        expect(s.positionCorrectionAnchorMs).toBe(midCursor)
        expect(s.positionCorrectionTargetMs).toBe(1_000)
        s = tick(s, 1_450) // 300ms later — second animation completes
        expect(s.cursorRefTime).toBe(1_000)
    })

    it("honours a custom positionCorrectionDurationMs", () => {
        let s = loadAndEngage(0)
        s = applyEvent(s, { kind: "positionCorrection", targetRefMs: 2_000, wallTime: 0 })
        s = tick(s, 100, { positionCorrectionDurationMs: 100 }) // completes at exactly 100ms
        expect(s.cursorRefTime).toBe(2_000)
        expect(s.positionCorrectionTargetMs).toBeNull()
    })

    it("during animation, normal tick-loop advance does NOT add on top (animation is the only source)", () => {
        let s = loadAndEngage(0)
        s = tick(s, 1_000) // cursor → 1_000 (running, auto)
        s = applyEvent(s, { kind: "positionCorrection", targetRefMs: 1_000, wallTime: 1_000 })
        // Animation anchor = 1_000, target = 1_000 → cursor stays at 1_000 throughout.
        s = tick(s, 1_200)
        expect(s.cursorRefTime).toBe(1_000)
    })
})

describe("tick — song-boundary detection (STORY-09.7)", () => {
    it("moves runState → finished when the cursor crosses totalDurationMs", () => {
        let s = loadAndEngage(0)
        // Map total duration = 5_000. Tick at 5_500ms wall time.
        s = tick(s, 5_500)
        expect(s.cursorRefTime).toBeGreaterThanOrEqual(5_000)
        expect(s.runState).toBe("finished")
    })

    it("does not double-finish — once finished, subsequent ticks hold the cursor", () => {
        let s = loadAndEngage(0)
        s = tick(s, 5_500)
        expect(s.runState).toBe("finished")
        const cursorAtFinish = s.cursorRefTime
        s = tick(s, 7_000)
        expect(s.runState).toBe("finished")
        expect(s.cursorRefTime).toBe(cursorAtFinish)
    })

    it("populates totalDurationMs once the song is loaded", () => {
        const map = makeMap()
        let s = applyEvent(makeInitialState(), {
            kind: "loadSong",
            map,
            arrangement: null,
            showId: map.showId
        })
        s = tick(s, 100)
        expect(s.totalDurationMs).toBe(5_000)
    })
})

describe("tick — defensive guards", () => {
    it("treats non-finite tempoRatio as 1.0 to avoid NaN cursors", () => {
        const s0 = { ...loadAndEngage(0), tempoRatio: Number.NaN }
        const s1 = tick(s0, 100)
        expect(s1.cursorRefTime).toBeCloseTo(100, 2)
    })

    it("handles backwards wall-clock without crashing or producing NaN", () => {
        let s = loadAndEngage(1_000)
        s = tick(s, 500) // backwards
        expect(Number.isFinite(s.cursorRefTime)).toBe(true)
        expect(s.lastTickWallTime).toBe(500)
    })

    it("safe first-tick after engage (no NaN even if lastTickWallTime not yet set)", () => {
        let s = applyEvent(makeInitialState(), {
            kind: "loadSong",
            map: makeMap(),
            arrangement: null,
            showId: "s1"
        })
        // Manually clear lastTickWallTime to simulate the first tick after engageSync.
        s = { ...s, runState: "running", lastTickWallTime: null }
        const t = tick(s, 1_000)
        expect(Number.isFinite(t.cursorRefTime)).toBe(true)
        expect(t.lastTickWallTime).toBe(1_000)
    })
})

describe("constants exported by tick consumers", () => {
    it("POSITION_CORRECTION_DURATION_MS is the FR4.4 300ms default", () => {
        expect(POSITION_CORRECTION_DURATION_MS).toBe(300)
    })
    it("CONFIDENCE_DEGRADATION_MS is the FR5.5 10s default", () => {
        expect(CONFIDENCE_DEGRADATION_MS).toBe(10_000)
    })
})
