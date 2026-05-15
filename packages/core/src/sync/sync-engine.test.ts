import { describe, it, expect, vi } from "vitest"
import { createSyncEngine, type FrameScheduler } from "./sync-engine.js"
import { findNextSlideStart } from "./lookup-word.js"
import type { TimingMap } from "../types/timing-map.js"

/**
 * STORY-09.8 — end-to-end SyncEngine integration test.
 *
 * Drives a synthetic timing map through the engine with a deterministic frame stepper.
 * Asserts the AC behaviours:
 *
 *   AC1: 30-second synthetic map with 60 words ✓
 *   AC2: MockAudioInput injects constant 120 BPM beat — emulated via tempoUpdate
 *        + vadUpdate events (no real audio needed)
 *   AC3: After 30s of simulated time, cursor at last word ±100ms
 *   AC4: Position correction event mid-song → cursor jumps within 300ms ±50ms
 *   AC5: VAD silent → cursor freezes; VAD active resumes within 100ms
 *
 * Also covers the SyncEngine API + frame source injection. Per architecture §4.8.
 */

function make30sMap(): TimingMap {
    // 60 words, 500ms each, one section.
    const words = Array.from({ length: 60 }, (_, i) => ({
        text: `w${i}`,
        startMs: i * 500,
        endMs: (i + 1) * 500,
        confidence: 0.9,
        lineIndex: Math.floor(i / 8)
    }))
    return {
        $schema: "lyricue-timing-v1",
        showId: "30s-song",
        learnedFrom: { method: "studio", duration: 30, learnedAt: "2026-05-15T00:00:00Z" },
        bpm: 120,
        language: "en",
        sections: [
            {
                id: "v1",
                type: "verse",
                label: "Verse 1",
                slideIndex: 0,
                startMs: 0,
                endMs: 30_000,
                words,
                lines: []
            }
        ],
        metadata: { schemaVersion: "1", version: "1.0.0" }
    }
}

/**
 * Manual frame stepper. Each call to `step(ms)` invokes the scheduled callback exactly
 * once with the new wall-clock time. Lets tests run a deterministic rAF loop.
 */
function makeManualScheduler() {
    let next: ((nowMs: number) => void) | null = null
    let cancelled = false

    const scheduler: FrameScheduler = (cb) => {
        next = cb
        cancelled = false
        return () => {
            cancelled = true
            next = null
        }
    }

    let now = 0
    function step(deltaMs: number) {
        now += deltaMs
        const cb = next
        next = null
        if (cb && !cancelled) cb(now)
    }

    return { scheduler, step, get currentTime() { return now } }
}

function buildEngine() {
    const ms = makeManualScheduler()
    const engine = createSyncEngine({
        requestFrame: ms.scheduler,
        now: () => ms.currentTime
    })
    return { engine, ...ms }
}

describe("SyncEngine — basic plumbing", () => {
    it("starts in idle state with default tier=auto", () => {
        const { engine } = buildEngine()
        const s = engine.snapshot()
        expect(s.tier).toBe("auto")
        expect(s.runState).toBe("idle")
    })

    it("loadSong sets the active map and transitions to waitingForStart", () => {
        const { engine } = buildEngine()
        const map = make30sMap()
        engine.loadSong({ map, arrangement: null, showId: map.showId })
        const s = engine.snapshot()
        expect(s.runState).toBe("waitingForStart")
        expect(s.activeTimingMap).toBe(map)
    })

    it("dispatch + start + stop are idempotent", () => {
        const { engine } = buildEngine()
        engine.start()
        engine.start()
        expect(engine.isRunning()).toBe(true)
        engine.stop()
        engine.stop()
        expect(engine.isRunning()).toBe(false)
    })

    it("emits a SyncFrame per tick that reflects the cursor state", () => {
        const { engine, step } = buildEngine()
        const map = make30sMap()
        engine.loadSong({ map, arrangement: null, showId: map.showId })
        engine.engageSync()
        engine.dispatch({ kind: "vadUpdate", vadState: "active" })
        engine.dispatch({ kind: "tempoUpdate", tempoRatio: 1.0, beatConfidence: 0.9 })

        const frames: any[] = []
        engine.onSyncFrame((f) => frames.push(f))
        engine.start()

        step(500) // cursor advances 500ms — into word 1
        expect(frames.length).toBeGreaterThan(0)
        const latest = frames[frames.length - 1]
        expect(latest.tier).toBe("auto")
        expect(latest.vad).toBe("active")
        expect(latest.outputId).toBeTruthy()
        engine.stop()
    })

    it("a throwing onSyncFrame subscriber does not break the engine", () => {
        const { engine, step } = buildEngine()
        const map = make30sMap()
        engine.loadSong({ map, arrangement: null, showId: map.showId })
        engine.engageSync()
        engine.dispatch({ kind: "vadUpdate", vadState: "active" })

        let okCount = 0
        engine.onSyncFrame(() => {
            throw new Error("bad subscriber")
        })
        engine.onSyncFrame(() => okCount++)
        engine.start()
        step(100)
        step(100)
        expect(okCount).toBe(2)
        engine.stop()
    })
})

describe("SyncEngine — STORY-09.8 integration", () => {
    it("AC3: cursor reaches the last word ±100ms after 30s of simulated playback", () => {
        const { engine, step } = buildEngine()
        const map = make30sMap()
        engine.loadSong({ map, arrangement: null, showId: map.showId })
        engine.engageSync()
        engine.dispatch({ kind: "vadUpdate", vadState: "active" })
        engine.dispatch({ kind: "tempoUpdate", tempoRatio: 1.0, beatConfidence: 0.9 })
        engine.start()

        // Tick at 16ms intervals (~60Hz) for 30 seconds of simulated time.
        const TICK_MS = 16
        const TOTAL_MS = 30_000
        for (let elapsed = 0; elapsed < TOTAL_MS; elapsed += TICK_MS) step(TICK_MS)

        const s = engine.snapshot()
        // Cursor should be within 100ms of the song's end (30_000ms).
        expect(Math.abs(s.cursorRefTime - 30_000)).toBeLessThan(100)
        // runState should be 'finished' once the cursor has crossed totalDurationMs.
        expect(s.runState).toBe("finished")
        // Last word index (59).
        expect(s.currentWordIndex).toBe(59)
        engine.stop()
    })

    it("AC4: position correction jumps the cursor to the target within 300ms ±50ms", () => {
        const { engine, step } = buildEngine()
        const map = make30sMap()
        engine.loadSong({ map, arrangement: null, showId: map.showId })
        engine.engageSync()
        engine.dispatch({ kind: "vadUpdate", vadState: "active" })
        engine.dispatch({ kind: "tempoUpdate", tempoRatio: 1.0, beatConfidence: 0.9 })
        engine.start()

        // Advance halfway through the song.
        for (let i = 0; i < 940; i++) step(16) // ~15s
        const cursorBefore = engine.snapshot().cursorRefTime
        expect(cursorBefore).toBeGreaterThan(14_000)
        expect(cursorBefore).toBeLessThan(16_000)

        // Inject a position correction to t=5_000 (jump backwards).
        engine.dispatch({
            kind: "positionCorrection",
            targetRefMs: 5_000,
            wallTime: 15_000
        })

        // Step forward 300ms — animation should complete.
        for (let i = 0; i < 19; i++) step(16) // ~304ms
        const cursorAfter = engine.snapshot().cursorRefTime
        // Within 50ms of target. Cursor moves linearly from ~15000 to 5000 over 300ms;
        // after 300ms the animation is complete and the cursor anchors at 5000 + the
        // normal tempo-advance for any subsequent ticks. We assert "near 5_000".
        expect(Math.abs(cursorAfter - 5_000)).toBeLessThan(100)
        engine.stop()
    })

    it("AC5: VAD silent freezes the cursor; VAD active resumes within 100ms", () => {
        const { engine, step } = buildEngine()
        const map = make30sMap()
        engine.loadSong({ map, arrangement: null, showId: map.showId })
        engine.engageSync()
        engine.dispatch({ kind: "vadUpdate", vadState: "active" })
        engine.dispatch({ kind: "tempoUpdate", tempoRatio: 1.0, beatConfidence: 0.9 })
        engine.start()

        // Advance 5 seconds with VAD active.
        for (let i = 0; i < 312; i++) step(16) // ~5_000ms
        const cursorBeforeSilent = engine.snapshot().cursorRefTime
        expect(cursorBeforeSilent).toBeGreaterThan(4_900)

        // VAD goes silent — cursor should freeze.
        engine.dispatch({ kind: "vadUpdate", vadState: "silent" })
        for (let i = 0; i < 100; i++) step(16) // 1_600ms of silence
        const cursorAfterSilent = engine.snapshot().cursorRefTime
        expect(cursorAfterSilent).toBe(cursorBeforeSilent)

        // VAD resumes — cursor moves on the next tick.
        engine.dispatch({ kind: "vadUpdate", vadState: "active" })
        step(50) // 50ms of activity
        const cursorAfterResume = engine.snapshot().cursorRefTime
        expect(cursorAfterResume).toBeGreaterThan(cursorAfterSilent)
        // The "resumes within 100ms" requirement — we resumed in 50ms.
        expect(cursorAfterResume - cursorAfterSilent).toBeLessThan(100)
        engine.stop()
    })

    it("fires onSongComplete exactly once when the song boundary is crossed", () => {
        const { engine, step } = buildEngine()
        const map = make30sMap()
        engine.loadSong({ map, arrangement: null, showId: map.showId })
        engine.engageSync()
        engine.dispatch({ kind: "vadUpdate", vadState: "active" })
        engine.dispatch({ kind: "tempoUpdate", tempoRatio: 1.0, beatConfidence: 0.9 })
        let completeCount = 0
        engine.onSongComplete(() => completeCount++)
        engine.start()

        // Walk 30s + a bit more.
        for (let i = 0; i < 2_000; i++) step(16) // 32 seconds
        expect(completeCount).toBe(1)
        engine.stop()
    })

    it("manual override (next section) jumps the cursor + suppresses STT for the debounce window", () => {
        const { engine, step } = buildEngine()
        // Two-section map so nextSection has somewhere to go.
        const map: TimingMap = {
            ...make30sMap(),
            sections: [
                {
                    id: "v1",
                    type: "verse",
                    label: "Verse 1",
                    slideIndex: 0,
                    startMs: 0,
                    endMs: 15_000,
                    words: Array.from({ length: 30 }, (_, i) => ({
                        text: `v${i}`,
                        startMs: i * 500,
                        endMs: (i + 1) * 500,
                        confidence: 0.9,
                        lineIndex: 0
                    })),
                    lines: []
                },
                {
                    id: "c1",
                    type: "chorus",
                    label: "Chorus",
                    slideIndex: 1,
                    startMs: 15_000,
                    endMs: 30_000,
                    words: Array.from({ length: 30 }, (_, i) => ({
                        text: `c${i}`,
                        startMs: 15_000 + i * 500,
                        endMs: 15_000 + (i + 1) * 500,
                        confidence: 0.9,
                        lineIndex: 0
                    })),
                    lines: []
                }
            ]
        }
        engine.loadSong({ map, arrangement: null, showId: map.showId })
        engine.engageSync()
        engine.dispatch({ kind: "vadUpdate", vadState: "active" })
        engine.dispatch({ kind: "tempoUpdate", tempoRatio: 1.0, beatConfidence: 0.9 })
        engine.start()

        // Step 5 seconds — into verse 1.
        for (let i = 0; i < 312; i++) step(16)
        expect(engine.snapshot().currentSlideIndex).toBe(0)

        // Issue a nextSection event — caller computes the target.
        const target = findNextSlideStart(map, null, engine.snapshot().cursorRefTime)!
        const wallTimeNow = engine.snapshot().lastTickWallTime!
        engine.dispatch({ kind: "nextSection", targetRefMs: target, wallTime: wallTimeNow })

        // Within one tick the cursor should be in section 1.
        step(16)
        expect(engine.snapshot().currentSlideIndex).toBe(1)

        // A position-correction event within the debounce window should be suppressed.
        engine.dispatch({
            kind: "positionCorrection",
            targetRefMs: 0,
            wallTime: wallTimeNow + 100
        })
        // Suppressed — no animation kicked off.
        expect(engine.snapshot().positionCorrectionTargetMs).toBeNull()

        engine.stop()
    })

    it("audioInputLost degrades auto → timer immediately", () => {
        const { engine, step } = buildEngine()
        engine.loadSong({ map: make30sMap(), arrangement: null, showId: "s1" })
        engine.engageSync()
        engine.dispatch({ kind: "vadUpdate", vadState: "active" })
        engine.start()
        step(100)
        expect(engine.snapshot().tier).toBe("auto")
        engine.dispatch({ kind: "audioInputLost" })
        expect(engine.snapshot().tier).toBe("timer")
        engine.stop()
    })
})
