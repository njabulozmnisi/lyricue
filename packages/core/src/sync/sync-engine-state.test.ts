import { describe, it, expect } from "vitest"
import {
    applyEvent,
    CONFIDENCE_DEGRADATION_THRESHOLD,
    DEFAULT_MANUAL_DEBOUNCE_MS,
    makeInitialState,
    POSITION_CORRECTION_DURATION_MS,
    type SyncEngineState
} from "./sync-engine-state.js"
import type { TimingMap } from "../types/timing-map.js"

/**
 * STORY-09.1 acceptance tests.
 *
 * AC1: interface + stores per arch §4.8 — covered by the makeInitialState shape.
 * AC2: explicit transitions (Auto→Timer, Timer→Manual, * → previous tier, song boundary).
 * AC3: pure functions — verified by structural equality + no-mutation invariants below.
 * AC4: every transition covered.
 */

function makeMap(showId = "show-1"): TimingMap {
    return {
        $schema: "lyricue-timing-v1",
        showId,
        learnedFrom: { method: "studio", duration: 1, learnedAt: "2026-05-15T00:00:00Z" },
        bpm: 120,
        language: "en",
        sections: [],
        metadata: { schemaVersion: "1", version: "1.0.0" }
    }
}

describe("makeInitialState", () => {
    it("returns a clean state with tier=auto, runState=idle, cursor=0", () => {
        const s = makeInitialState()
        expect(s.tier).toBe("auto")
        expect(s.runState).toBe("idle")
        expect(s.cursorRefTime).toBe(0)
        expect(s.activeTimingMap).toBeNull()
        expect(s.beatConfidence).toBe(0)
        expect(s.vadState).toBe("silent")
    })

    it("each call returns a distinct object (no shared mutable refs)", () => {
        const a = makeInitialState()
        const b = makeInitialState()
        expect(a).not.toBe(b)
        a.cursorRefTime = 999
        expect(b.cursorRefTime).toBe(0)
    })
})

describe("transitions — purity", () => {
    it("applyEvent does not mutate the input state", () => {
        const before = makeInitialState()
        const snapshot = JSON.parse(JSON.stringify(before))
        const after = applyEvent(before, { kind: "tempoUpdate", tempoRatio: 1.2, beatConfidence: 0.8 })
        expect(JSON.parse(JSON.stringify(before))).toEqual(snapshot)
        expect(after).not.toBe(before)
        expect(after.tempoRatio).toBe(1.2)
    })
})

describe("transitions — loadSong / clearSong", () => {
    it("loadSong populates activeTimingMap + sets runState=waitingForStart", () => {
        const s0 = makeInitialState()
        const map = makeMap()
        const s1 = applyEvent(s0, { kind: "loadSong", map, arrangement: null, showId: map.showId })
        expect(s1.activeTimingMap).toBe(map)
        expect(s1.runState).toBe("waitingForStart")
        expect(s1.activeShowId).toBe(map.showId)
    })

    it("loadSong preserves the operator's tier choice across songs", () => {
        const s0 = { ...makeInitialState(), tier: "manual" as const }
        const map = makeMap()
        const s1 = applyEvent(s0, { kind: "loadSong", map, arrangement: null, showId: map.showId })
        expect(s1.tier).toBe("manual")
    })

    it("loadSong resets cursorRefTime + currentWordIndex (no stale state across songs)", () => {
        const s0 = { ...makeInitialState(), cursorRefTime: 5432, currentWordIndex: 12 }
        const s1 = applyEvent(s0, { kind: "loadSong", map: makeMap(), arrangement: null, showId: "x" })
        expect(s1.cursorRefTime).toBe(0)
        expect(s1.currentWordIndex).toBe(0)
    })

    it("clearSong drops the active map back to initial state but preserves tier", () => {
        const map = makeMap()
        let s = applyEvent(makeInitialState(), {
            kind: "loadSong",
            map,
            arrangement: null,
            showId: map.showId
        })
        s = applyEvent(s, { kind: "forceTier", tier: "manual", wallTime: 1000 })
        const cleared = applyEvent(s, { kind: "clearSong" })
        expect(cleared.tier).toBe("manual")
        expect(cleared.activeTimingMap).toBeNull()
        expect(cleared.runState).toBe("idle")
    })
})

describe("transitions — engageSync", () => {
    it("does nothing when no song is loaded", () => {
        const s0 = makeInitialState()
        const s1 = applyEvent(s0, { kind: "engageSync", wallTime: 1000 })
        // No song → no engagement; state.runState should still be idle.
        expect(s1.runState).toBe("idle")
    })

    it("transitions waitingForStart → running with anchors set", () => {
        const map = makeMap()
        const s0 = applyEvent(makeInitialState(), {
            kind: "loadSong",
            map,
            arrangement: null,
            showId: map.showId
        })
        const s1 = applyEvent(s0, { kind: "engageSync", wallTime: 12345 })
        expect(s1.runState).toBe("running")
        expect(s1.songStartWallTime).toBe(12345)
        expect(s1.lastTickWallTime).toBe(12345)
        expect(s1.cursorRefTime).toBe(0)
        expect(s1.lowConfidenceDurationMs).toBe(0)
    })
})

describe("transitions — tempoUpdate / vadUpdate", () => {
    it("tempoUpdate updates both ratio and confidence atomically", () => {
        const s = applyEvent(makeInitialState(), {
            kind: "tempoUpdate",
            tempoRatio: 1.1,
            beatConfidence: 0.85
        })
        expect(s.tempoRatio).toBe(1.1)
        expect(s.beatConfidence).toBe(0.85)
    })

    it("vadUpdate flips vadState without touching tier or runState", () => {
        const s0 = { ...makeInitialState(), tier: "auto" as const, runState: "running" as const }
        const s1 = applyEvent(s0, { kind: "vadUpdate", vadState: "silent" })
        expect(s1.vadState).toBe("silent")
        expect(s1.tier).toBe("auto")
        expect(s1.runState).toBe("running")
    })
})

describe("transitions — audioInputLost", () => {
    it("forces auto → timer", () => {
        const s0 = { ...makeInitialState(), tier: "auto" as const }
        const s1 = applyEvent(s0, { kind: "audioInputLost" })
        expect(s1.tier).toBe("timer")
    })

    it("forces timer → timer (no-op tier-wise but clears confidence counter)", () => {
        const s0 = { ...makeInitialState(), tier: "timer" as const, lowConfidenceDurationMs: 5000 }
        const s1 = applyEvent(s0, { kind: "audioInputLost" })
        expect(s1.tier).toBe("timer")
        expect(s1.lowConfidenceDurationMs).toBe(0)
    })

    it("does not override manual — operator's choice takes precedence", () => {
        const s0 = { ...makeInitialState(), tier: "manual" as const }
        const s1 = applyEvent(s0, { kind: "audioInputLost" })
        expect(s1.tier).toBe("manual")
    })
})

describe("transitions — forceTier", () => {
    it("auto → timer when operator forces", () => {
        const s0 = { ...makeInitialState(), tier: "auto" as const }
        const s1 = applyEvent(s0, { kind: "forceTier", tier: "timer", wallTime: 100 })
        expect(s1.tier).toBe("timer")
        expect(s1.lastManualInterventionAt).toBe(100)
    })

    it("timer → manual when operator forces", () => {
        const s0 = { ...makeInitialState(), tier: "timer" as const }
        const s1 = applyEvent(s0, { kind: "forceTier", tier: "manual", wallTime: 100 })
        expect(s1.tier).toBe("manual")
    })

    it("any → auto re-engages the operator preference (and clears confidence counter)", () => {
        const s0 = {
            ...makeInitialState(),
            tier: "manual" as const,
            lowConfidenceDurationMs: 9_000
        }
        const s1 = applyEvent(s0, { kind: "forceTier", tier: "auto", wallTime: 200 })
        expect(s1.tier).toBe("auto")
        expect(s1.lowConfidenceDurationMs).toBe(0)
    })

    it("no-op when forced tier equals current tier", () => {
        const s0 = { ...makeInitialState(), tier: "auto" as const }
        const s1 = applyEvent(s0, { kind: "forceTier", tier: "auto", wallTime: 100 })
        // No transition recorded (lastManualInterventionAt not set).
        expect(s1.lastManualInterventionAt).toBeNull()
    })
})

describe("transitions — next/prev section + toggleManual + reEngage", () => {
    it("nextSection sets cursorRefTime + manual-intervention timestamp", () => {
        const s = applyEvent(makeInitialState(), {
            kind: "nextSection",
            targetRefMs: 4_000,
            wallTime: 500
        })
        expect(s.cursorRefTime).toBe(4_000)
        expect(s.lastManualInterventionAt).toBe(500)
    })

    it("nextSection clears any in-flight position correction", () => {
        const s0 = {
            ...makeInitialState(),
            positionCorrectionTargetMs: 7_000,
            positionCorrectionStartedAt: 100,
            positionCorrectionAnchorMs: 2_000
        }
        const s1 = applyEvent(s0, { kind: "nextSection", targetRefMs: 4_000, wallTime: 500 })
        expect(s1.positionCorrectionTargetMs).toBeNull()
        expect(s1.positionCorrectionStartedAt).toBeNull()
        expect(s1.positionCorrectionAnchorMs).toBeNull()
    })

    it("prevSection sets cursorRefTime + manual-intervention timestamp", () => {
        const s0 = { ...makeInitialState(), cursorRefTime: 4_000 }
        const s1 = applyEvent(s0, { kind: "prevSection", targetRefMs: 2_000, wallTime: 800 })
        expect(s1.cursorRefTime).toBe(2_000)
        expect(s1.lastManualInterventionAt).toBe(800)
    })

    it("toggleManual flips auto → manual", () => {
        const s0 = { ...makeInitialState(), tier: "auto" as const }
        const s1 = applyEvent(s0, { kind: "toggleManual", wallTime: 100 })
        expect(s1.tier).toBe("manual")
    })

    it("toggleManual flips manual → auto", () => {
        const s0 = { ...makeInitialState(), tier: "manual" as const }
        const s1 = applyEvent(s0, { kind: "toggleManual", wallTime: 100 })
        expect(s1.tier).toBe("auto")
    })

    it("toggleManual from timer falls into manual (toggles 'on')", () => {
        const s0 = { ...makeInitialState(), tier: "timer" as const }
        const s1 = applyEvent(s0, { kind: "toggleManual", wallTime: 100 })
        expect(s1.tier).toBe("manual")
    })

    it("reEngageSync returns to auto + re-anchors songStart", () => {
        const s0 = {
            ...makeInitialState(),
            tier: "manual" as const,
            songStartWallTime: 100,
            lowConfidenceDurationMs: 9_000
        }
        const s1 = applyEvent(s0, { kind: "reEngageSync", wallTime: 5_000 })
        expect(s1.tier).toBe("auto")
        expect(s1.songStartWallTime).toBe(5_000)
        expect(s1.lastTickWallTime).toBe(5_000)
        expect(s1.lowConfidenceDurationMs).toBe(0)
    })
})

describe("transitions — positionCorrection (with debounce)", () => {
    it("sets the animation anchor + target when no manual debounce is active", () => {
        const s0 = { ...makeInitialState(), cursorRefTime: 1_000 }
        const s1 = applyEvent(s0, { kind: "positionCorrection", targetRefMs: 5_000, wallTime: 500 })
        expect(s1.positionCorrectionTargetMs).toBe(5_000)
        expect(s1.positionCorrectionStartedAt).toBe(500)
        expect(s1.positionCorrectionAnchorMs).toBe(1_000)
    })

    it("is suppressed when within the manual-debounce window", () => {
        const s0 = {
            ...makeInitialState(),
            cursorRefTime: 1_000,
            lastManualInterventionAt: 100
        }
        // 100 + 2999 < 3000 debounce → suppressed.
        const s1 = applyEvent(s0, { kind: "positionCorrection", targetRefMs: 5_000, wallTime: 3_099 })
        expect(s1.positionCorrectionTargetMs).toBeNull()
        expect(s1.positionCorrectionStartedAt).toBeNull()
    })

    it("is accepted once the manual-debounce window elapses", () => {
        const s0 = {
            ...makeInitialState(),
            cursorRefTime: 1_000,
            lastManualInterventionAt: 100
        }
        // 100 + 3001 > 3000 → accepted.
        const s1 = applyEvent(s0, { kind: "positionCorrection", targetRefMs: 5_000, wallTime: 3_101 })
        expect(s1.positionCorrectionTargetMs).toBe(5_000)
    })

    it("a fresh correction during an in-flight animation snaps the anchor to the current cursor", () => {
        // The cursor would have moved by the time the second correction arrives — caller
        // supplies the latest wallTime; we use state.cursorRefTime as the new anchor.
        const s0 = {
            ...makeInitialState(),
            cursorRefTime: 1_500, // after some animation progress
            positionCorrectionTargetMs: 5_000,
            positionCorrectionStartedAt: 100,
            positionCorrectionAnchorMs: 1_000
        }
        const s1 = applyEvent(s0, { kind: "positionCorrection", targetRefMs: 7_000, wallTime: 500 })
        expect(s1.positionCorrectionTargetMs).toBe(7_000)
        expect(s1.positionCorrectionStartedAt).toBe(500)
        expect(s1.positionCorrectionAnchorMs).toBe(1_500) // current cursor, not the old anchor
    })
})

describe("transitions — songComplete", () => {
    it("moves runState → finished without touching tier", () => {
        const s0 = { ...makeInitialState(), runState: "running" as const, tier: "auto" as const }
        const s1 = applyEvent(s0, { kind: "songComplete" })
        expect(s1.runState).toBe("finished")
        expect(s1.tier).toBe("auto")
    })
})

describe("constants", () => {
    it("POSITION_CORRECTION_DURATION_MS matches FR4.4 (300ms)", () => {
        expect(POSITION_CORRECTION_DURATION_MS).toBe(300)
    })

    it("CONFIDENCE_DEGRADATION_THRESHOLD matches FR5.5 (0.4)", () => {
        expect(CONFIDENCE_DEGRADATION_THRESHOLD).toBe(0.4)
    })

    it("DEFAULT_MANUAL_DEBOUNCE_MS matches the operator-settings default (3s)", () => {
        expect(DEFAULT_MANUAL_DEBOUNCE_MS).toBe(3_000)
    })
})
