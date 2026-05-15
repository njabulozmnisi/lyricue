/**
 * DemoSyncEngine — a stand-in for the real Sync Engine (EP-09) used by the walking-skeleton
 * demo runners in STORY-02.4 and by integration tests.
 *
 * Drives an OutputAdapter with SyncFrames synthesised from a TimingMap by linearly walking
 * a cursor at 1× tempo. Loops on reaching the end of the map. No tempo ratio scaling, no
 * VAD gating, no manual override — just a clean "render this map at real time" stream.
 *
 * The real Sync Engine (in EP-09) replaces this with a requestAnimationFrame-driven loop
 * that consumes live BPM from BD, VAD state from VAD, and position corrections from ST.
 * This demo runner exists so that STORY-02.4's acceptance criteria — proving both adapters
 * receive identical frames given identical input — can be verified without those upstream
 * modules existing yet.
 *
 * Lifecycle:
 *   - new DemoSyncEngine({ adapter, map, outputId, fps?, tempoMultiplier? })
 *   - engine.start() → adapter.loadTimingMap(map, null); begins pushing frames at fps Hz
 *   - engine.stop() → halts the interval timer; does NOT stop the adapter (callers manage that)
 *   - engine.isRunning() → boolean
 */

import type { OutputAdapter } from "./output-adapter.js"
import type { SyncFrame } from "./sync-frame.js"
import type { TimingMap, TimingWord } from "../types/timing-map.js"

export interface DemoSyncEngineOptions {
    /** The adapter to drive. The demo runner does NOT own its lifecycle; caller must start/stop. */
    adapter: OutputAdapter

    /** TimingMap to walk through. The runner loops on end. */
    map: TimingMap

    /** The outputId tag on every emitted SyncFrame. Must match what the adapter started with. */
    outputId: string

    /**
     * Frames per second to push. Default 60. Lower fps means coarser sweep granularity but
     * less IPC traffic. The real Sync Engine targets 60.
     */
    fps?: number

    /**
     * Tempo multiplier — 1.0 = realtime, 2.0 = double-speed. Used in tests + manual eyeballing.
     * Defaults to 1.0.
     */
    tempoMultiplier?: number
}

export class DemoSyncEngine {
    readonly #adapter: OutputAdapter
    readonly #map: TimingMap
    readonly #outputId: string
    readonly #fps: number
    readonly #tempoMultiplier: number
    readonly #frameIntervalMs: number
    readonly #totalDurationMs: number

    #intervalId: ReturnType<typeof setInterval> | null = null
    #cursorMs = 0

    constructor(opts: DemoSyncEngineOptions) {
        this.#adapter = opts.adapter
        this.#map = opts.map
        this.#outputId = opts.outputId
        this.#fps = opts.fps ?? 60
        this.#tempoMultiplier = opts.tempoMultiplier ?? 1.0
        this.#frameIntervalMs = 1000 / this.#fps
        // Total duration of the map: end of the last word in the last section.
        const last = opts.map.sections[opts.map.sections.length - 1]
        const lastWord = last?.words[last.words.length - 1]
        this.#totalDurationMs = lastWord?.endMs ?? 0
        if (this.#totalDurationMs === 0) {
            throw new Error("DemoSyncEngine: TimingMap has no words to walk")
        }
    }

    isRunning(): boolean {
        return this.#intervalId !== null
    }

    start(): void {
        if (this.#intervalId !== null) return
        this.#adapter.loadTimingMap(this.#map, null)
        this.#cursorMs = 0
        this.#intervalId = setInterval(() => this.#tick(), this.#frameIntervalMs)
    }

    stop(): void {
        if (this.#intervalId === null) return
        clearInterval(this.#intervalId)
        this.#intervalId = null
    }

    #tick(): void {
        // Advance cursor; loop on overflow so the demo plays indefinitely.
        this.#cursorMs += this.#frameIntervalMs * this.#tempoMultiplier
        if (this.#cursorMs >= this.#totalDurationMs) {
            this.#cursorMs = this.#cursorMs % this.#totalDurationMs
        }
        const frame = this.#frameAt(this.#cursorMs)
        if (frame) this.#adapter.pushSyncFrame(frame)
    }

    /**
     * Build a SyncFrame for the given cursor position. Returns null if the cursor is
     * outside the map's covered range (shouldn't happen with the modulo wrap, but
     * defensive in case future callers feed arbitrary cursor positions).
     */
    #frameAt(cursorMs: number): SyncFrame | null {
        for (let s = 0; s < this.#map.sections.length; s++) {
            const section = this.#map.sections[s]
            if (!section) continue
            if (cursorMs < section.startMs || cursorMs >= section.endMs) continue
            const word = this.#findWord(section.words, cursorMs)
            if (!word) return null
            const idx = section.words.indexOf(word)
            const wordSpan = word.endMs - word.startMs
            const wordProgress = wordSpan > 0 ? (cursorMs - word.startMs) / wordSpan : 0
            return {
                outputId: this.#outputId,
                slideIndex: section.slideIndex,
                wordIndex: idx,
                wordProgress: Math.max(0, Math.min(1, wordProgress)),
                tier: "auto",
                vad: "active"
            }
        }
        return null
    }

    #findWord(words: TimingWord[], cursorMs: number): TimingWord | null {
        // Linear scan is fine for demo-sized maps (12 words). EP-09's real lookupWord
        // uses a binary search per architecture §4.8 / STORY-09.3.
        for (const w of words) {
            if (cursorMs >= w.startMs && cursorMs < w.endMs) return w
        }
        // Cursor at exactly endMs — return the last word.
        const last = words[words.length - 1]
        if (last && cursorMs >= last.endMs && cursorMs <= last.endMs + 1) return last
        return null
    }
}
