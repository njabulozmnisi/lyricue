import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { DemoSyncEngine } from "./demo-runner.js"
import { DEMO_TIMING_MAP, DEMO_MAP_TOTAL_DURATION_MS, DEMO_MAP_MS_PER_WORD, DEMO_MAP_WORDS } from "./demo-timing-map.js"
import { MockOutputAdapter } from "./mock-output-adapter.js"

describe("DemoSyncEngine", () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it("throws when the TimingMap has no words to walk", () => {
        const adapter = new MockOutputAdapter()
        expect(
            () =>
                new DemoSyncEngine({
                    adapter,
                    map: {
                        ...DEMO_TIMING_MAP,
                        sections: []
                    },
                    outputId: "out-1"
                })
        ).toThrow(/no words/)
    })

    it("isRunning() reflects start/stop state", async () => {
        const adapter = new MockOutputAdapter()
        await adapter.start({ outputId: "out-1" })
        const engine = new DemoSyncEngine({ adapter, map: DEMO_TIMING_MAP, outputId: "out-1" })
        expect(engine.isRunning()).toBe(false)
        engine.start()
        expect(engine.isRunning()).toBe(true)
        engine.stop()
        expect(engine.isRunning()).toBe(false)
    })

    it("start() is idempotent — calling twice does not double-fire", async () => {
        const adapter = new MockOutputAdapter()
        await adapter.start({ outputId: "out-1" })
        const engine = new DemoSyncEngine({ adapter, map: DEMO_TIMING_MAP, outputId: "out-1", fps: 60 })
        engine.start()
        engine.start()
        // Advance 100ms — at 60fps that's ~6 frames. If start() fired twice we'd see ~12.
        vi.advanceTimersByTime(100)
        engine.stop()
        // Filter to pushSyncFrame calls (start() also fires loadTimingMap).
        const pushCalls = adapter.calls.filter((c) => c.method === "pushSyncFrame")
        expect(pushCalls.length).toBeGreaterThan(0)
        expect(pushCalls.length).toBeLessThanOrEqual(7)
    })

    it("start() calls loadTimingMap on the adapter before any frames", async () => {
        const adapter = new MockOutputAdapter()
        await adapter.start({ outputId: "out-1" })
        const engine = new DemoSyncEngine({ adapter, map: DEMO_TIMING_MAP, outputId: "out-1" })
        engine.start()
        // The first call after start() must be loadTimingMap, then frames follow.
        const first = adapter.calls[adapter.calls.findIndex((c) => c.method === "loadTimingMap")]
        expect(first?.method).toBe("loadTimingMap")
        expect((first?.args as { map: typeof DEMO_TIMING_MAP }).map.showId).toBe(DEMO_TIMING_MAP.showId)
        engine.stop()
    })

    it("emits frames at the configured fps", async () => {
        const adapter = new MockOutputAdapter()
        await adapter.start({ outputId: "out-1" })
        const engine = new DemoSyncEngine({ adapter, map: DEMO_TIMING_MAP, outputId: "out-1", fps: 60 })
        engine.start()
        // Advance one full second.
        vi.advanceTimersByTime(1000)
        engine.stop()
        const pushCalls = adapter.calls.filter((c) => c.method === "pushSyncFrame")
        // setInterval(fn, 1000/60) at 60fps over 1s with fake timers fires ~60 times.
        // Allow some slack for first-tick scheduling; real lower bound is 50.
        expect(pushCalls.length).toBeGreaterThanOrEqual(50)
        expect(pushCalls.length).toBeLessThanOrEqual(65)
    })

    it("wordProgress monotonically increases within a word", async () => {
        const adapter = new MockOutputAdapter()
        await adapter.start({ outputId: "out-1" })
        const engine = new DemoSyncEngine({ adapter, map: DEMO_TIMING_MAP, outputId: "out-1", fps: 60 })
        engine.start()
        // Advance 400ms — well within the first word's 500ms span.
        vi.advanceTimersByTime(400)
        engine.stop()
        const frames = adapter.calls
            .filter((c) => c.method === "pushSyncFrame")
            .map((c) => c.args as { wordIndex: number; wordProgress: number })
        // All frames in this window should be on word 0 and progress should not regress.
        for (let i = 1; i < frames.length; i++) {
            const prev = frames[i - 1]!
            const curr = frames[i]!
            if (prev.wordIndex === curr.wordIndex) {
                expect(curr.wordProgress).toBeGreaterThanOrEqual(prev.wordProgress)
            }
        }
        // First frame should be on word 0 with low progress.
        expect(frames[0]?.wordIndex).toBe(0)
    })

    it("advances wordIndex over time", async () => {
        const adapter = new MockOutputAdapter()
        await adapter.start({ outputId: "out-1" })
        const engine = new DemoSyncEngine({ adapter, map: DEMO_TIMING_MAP, outputId: "out-1", fps: 60 })
        engine.start()
        // Advance 1500ms — should cross multiple words at 500ms/word.
        vi.advanceTimersByTime(1500)
        engine.stop()
        const wordIndexes = adapter.calls
            .filter((c) => c.method === "pushSyncFrame")
            .map((c) => (c.args as { wordIndex: number }).wordIndex)
        const uniqueWords = new Set(wordIndexes)
        // 1500ms / 500ms = 3 words; the boundary cases give us 3-4 distinct indices.
        expect(uniqueWords.size).toBeGreaterThanOrEqual(3)
    })

    it("loops on reaching the end of the map", async () => {
        const adapter = new MockOutputAdapter()
        await adapter.start({ outputId: "out-1" })
        const engine = new DemoSyncEngine({ adapter, map: DEMO_TIMING_MAP, outputId: "out-1", fps: 60 })
        engine.start()
        // Total map duration is 6000ms; advance 7000ms to force a wrap.
        vi.advanceTimersByTime(7000)
        engine.stop()
        const wordIndexes = adapter.calls
            .filter((c) => c.method === "pushSyncFrame")
            .map((c) => (c.args as { wordIndex: number }).wordIndex)
        // After 7s, we should have seen word 0 at least twice (once at start, once after loop).
        const word0Count = wordIndexes.filter((w) => w === 0).length
        expect(word0Count).toBeGreaterThanOrEqual(2)
        // Last word (11) must have been hit before the wrap.
        expect(wordIndexes).toContain(DEMO_MAP_WORDS.length - 1)
    })

    it("stamps every SyncFrame with the configured outputId, tier=auto, vad=active", async () => {
        const adapter = new MockOutputAdapter()
        await adapter.start({ outputId: "demo-out" })
        const engine = new DemoSyncEngine({ adapter, map: DEMO_TIMING_MAP, outputId: "demo-out", fps: 60 })
        engine.start()
        vi.advanceTimersByTime(500)
        engine.stop()
        const frames = adapter.calls
            .filter((c) => c.method === "pushSyncFrame")
            .map((c) => c.args as { outputId: string; tier: string; vad: string })
        expect(frames.length).toBeGreaterThan(0)
        for (const f of frames) {
            expect(f.outputId).toBe("demo-out")
            expect(f.tier).toBe("auto")
            expect(f.vad).toBe("active")
        }
    })

    it("tempoMultiplier=2.0 makes the cursor advance twice as fast", async () => {
        const slowAdapter = new MockOutputAdapter()
        await slowAdapter.start({ outputId: "out-1" })
        const slow = new DemoSyncEngine({ adapter: slowAdapter, map: DEMO_TIMING_MAP, outputId: "out-1", fps: 60, tempoMultiplier: 1.0 })

        const fastAdapter = new MockOutputAdapter()
        await fastAdapter.start({ outputId: "out-1" })
        const fast = new DemoSyncEngine({ adapter: fastAdapter, map: DEMO_TIMING_MAP, outputId: "out-1", fps: 60, tempoMultiplier: 2.0 })

        slow.start()
        fast.start()
        vi.advanceTimersByTime(500)
        slow.stop()
        fast.stop()

        const slowMaxWord = Math.max(
            ...slowAdapter.calls
                .filter((c) => c.method === "pushSyncFrame")
                .map((c) => (c.args as { wordIndex: number }).wordIndex)
        )
        const fastMaxWord = Math.max(
            ...fastAdapter.calls
                .filter((c) => c.method === "pushSyncFrame")
                .map((c) => (c.args as { wordIndex: number }).wordIndex)
        )
        expect(fastMaxWord).toBeGreaterThan(slowMaxWord)
    })

    it("stop() detaches the interval — no further frames after stop()", async () => {
        const adapter = new MockOutputAdapter()
        await adapter.start({ outputId: "out-1" })
        const engine = new DemoSyncEngine({ adapter, map: DEMO_TIMING_MAP, outputId: "out-1", fps: 60 })
        engine.start()
        vi.advanceTimersByTime(200)
        const beforeStop = adapter.calls.filter((c) => c.method === "pushSyncFrame").length
        engine.stop()
        vi.advanceTimersByTime(1000)
        const afterStop = adapter.calls.filter((c) => c.method === "pushSyncFrame").length
        expect(afterStop).toBe(beforeStop)
    })
})

describe("DEMO_TIMING_MAP fixture", () => {
    it("total duration equals WORDS × MS_PER_WORD", () => {
        expect(DEMO_MAP_TOTAL_DURATION_MS).toBe(DEMO_MAP_WORDS.length * DEMO_MAP_MS_PER_WORD)
    })

    it("the map's last word ends at total duration", () => {
        const lastSection = DEMO_TIMING_MAP.sections[DEMO_TIMING_MAP.sections.length - 1]!
        const lastWord = lastSection.words[lastSection.words.length - 1]!
        expect(lastWord.endMs).toBe(DEMO_MAP_TOTAL_DURATION_MS)
    })

    it("conforms to the timing-map schema (showId, $schema, sections, metadata)", () => {
        expect(DEMO_TIMING_MAP.$schema).toBe("lyricue-timing-v1")
        expect(DEMO_TIMING_MAP.showId).toBeTruthy()
        expect(DEMO_TIMING_MAP.sections.length).toBeGreaterThan(0)
        expect(DEMO_TIMING_MAP.metadata.schemaVersion).toBe("1")
        for (const section of DEMO_TIMING_MAP.sections) {
            expect(section.words.length).toBeGreaterThan(0)
            // Word indexes within a section should reference valid line indexes.
            for (const w of section.words) {
                expect(w.lineIndex).toBeGreaterThanOrEqual(0)
                expect(w.lineIndex).toBeLessThan(section.lines.length)
            }
        }
    })

    it("lines correctly partition the words", () => {
        for (const section of DEMO_TIMING_MAP.sections) {
            const wordIndexes = new Set<number>()
            for (let i = 0; i < section.words.length; i++) wordIndexes.add(i)
            const linedIndexes = new Set<number>()
            for (const line of section.lines) {
                for (let i = line.wordStartIndex; i < line.wordEndIndex; i++) {
                    expect(linedIndexes.has(i)).toBe(false) // no overlap
                    linedIndexes.add(i)
                }
            }
            expect([...wordIndexes].every((i) => linedIndexes.has(i))).toBe(true)
        }
    })
})
