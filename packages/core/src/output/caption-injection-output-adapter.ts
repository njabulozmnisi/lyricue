import type { Arrangement, ParallelLyricsTrack, TimingMap, TimingSection } from "../types/timing-map.js"
import type {
    AdapterHealth,
    OutputAdapter,
    OutputAdapterStartOptions
} from "./output-adapter.js"
import type { SyncFrame } from "./sync-frame.js"

export interface CaptionTransport {
    connect(): Promise<void>
    send(message: CaptionInjectionMessage): void
    close(): Promise<void>
}

export type CaptionInjectionMessage =
    | CaptionSessionMessage
    | CaptionMapMessage
    | CaptionFrameMessage

export interface CaptionSessionMessage {
    type: "lyricue:caption-session"
    outputId: string
    highlightMode: "word-sweep" | "word-swap"
}

export interface CaptionMapMessage {
    type: "lyricue:caption-map"
    outputId: string
    showId: string
    sectionCount: number
    languages: string[]
}

export interface CaptionFrameMessage {
    type: "lyricue:caption-frame"
    outputId: string
    showId: string
    slideIndex: number
    sectionId: string | null
    text: string
    words: string[]
    activeWordIndex: number | null
    tier: SyncFrame["tier"]
    vad: SyncFrame["vad"]
    highlightMode?: "word-sweep"
    wordProgress?: number
}

export interface CaptionInjectionOutputAdapterOptions {
    transport: CaptionTransport
    /** True only when FreeShow has the proposed EP20 captions extension. */
    wordSweepSupported?: boolean
}

interface MutableHealth {
    running: boolean
    lastFrameAtMs: number | null
    framesDelivered: number
    framesDropped: number
    lastError: { at: number; message: string } | null
}

export class CaptionInjectionOutputAdapter implements OutputAdapter {
    readonly mode = "caption-injection" as const

    #health: MutableHealth = {
        running: false,
        lastFrameAtMs: null,
        framesDelivered: 0,
        framesDropped: 0,
        lastError: null
    }
    #transport: CaptionTransport
    #wordSweepSupported: boolean
    #outputId: string | null = null
    #map: TimingMap | null = null
    #arrangement: Arrangement | null = null
    #parallelLyrics: ParallelLyricsTrack[] = []

    constructor(opts: CaptionInjectionOutputAdapterOptions) {
        this.#transport = opts.transport
        this.#wordSweepSupported = opts.wordSweepSupported === true
    }

    get health(): AdapterHealth {
        return Object.freeze({ ...this.#health })
    }

    async start(opts: OutputAdapterStartOptions): Promise<void> {
        if (this.#health.running) return
        this.#outputId = opts.outputId
        try {
            await this.#transport.connect()
            this.#transport.send({
                type: "lyricue:caption-session",
                outputId: opts.outputId,
                highlightMode: this.#wordSweepSupported ? "word-sweep" : "word-swap"
            })
            this.#health.running = true
            this.#health.lastError = null
        } catch (err) {
            this.#health.lastError = {
                at: performance.now(),
                message: (err as Error).message || String(err)
            }
        }
    }

    async stop(): Promise<void> {
        this.#health.running = false
        this.#outputId = null
        this.#map = null
        this.#arrangement = null
        this.#parallelLyrics = []
        try {
            await this.#transport.close()
        } catch (err) {
            this.#health.lastError = {
                at: performance.now(),
                message: (err as Error).message || String(err)
            }
        }
    }

    loadTimingMap(map: TimingMap, arrangement: Arrangement | null, parallelLyrics?: ParallelLyricsTrack[]): void {
        this.#map = map
        this.#arrangement = arrangement
        this.#parallelLyrics = parallelLyrics ?? []
        if (!this.#health.running || !this.#outputId) return
        try {
            this.#transport.send({
                type: "lyricue:caption-map",
                outputId: this.#outputId,
                showId: map.showId,
                sectionCount: map.sections.length,
                languages: [map.language, ...this.#parallelLyrics.map((track) => track.language)]
            })
            this.#health.lastError = null
        } catch (err) {
            this.#health.lastError = {
                at: performance.now(),
                message: (err as Error).message || String(err)
            }
        }
    }

    pushSyncFrame(frame: SyncFrame): void {
        if (!this.#health.running || !this.#outputId || !this.#map) {
            this.#health.framesDropped++
            return
        }
        try {
            this.#transport.send(buildCaptionFrameMessage({
                outputId: this.#outputId,
                map: this.#map,
                arrangement: this.#arrangement,
                frame,
                wordSweepSupported: this.#wordSweepSupported
            }))
            this.#health.framesDelivered++
            this.#health.lastFrameAtMs = performance.now()
            this.#health.lastError = null
        } catch (err) {
            this.#health.framesDropped++
            this.#health.lastError = {
                at: performance.now(),
                message: (err as Error).message || String(err)
            }
        }
    }
}

function buildCaptionFrameMessage(opts: {
    outputId: string
    map: TimingMap
    arrangement: Arrangement | null
    frame: SyncFrame
    wordSweepSupported: boolean
}): CaptionFrameMessage {
    const section = sectionForSlide(opts.map, opts.arrangement, opts.frame.slideIndex)
    const words = section?.words.map((word) => word.text) ?? []
    const activeWordIndex =
        opts.frame.wordIndex >= 0 && opts.frame.wordIndex < words.length ? opts.frame.wordIndex : null
    const base: CaptionFrameMessage = {
        type: "lyricue:caption-frame",
        outputId: opts.outputId,
        showId: opts.map.showId,
        slideIndex: opts.frame.slideIndex,
        sectionId: section?.id ?? null,
        text: words.join(" "),
        words,
        activeWordIndex,
        tier: opts.frame.tier,
        vad: opts.frame.vad
    }
    if (opts.wordSweepSupported && activeWordIndex !== null) {
        return {
            ...base,
            highlightMode: "word-sweep",
            wordProgress: clampProgress(opts.frame.wordProgress)
        }
    }
    return base
}

function sectionForSlide(map: TimingMap, arrangement: Arrangement | null, slideIndex: number): TimingSection | null {
    if (arrangement) {
        const step = arrangement.sequence[slideIndex]
        if (!step) return null
        return map.sections.find((section) => section.id === step.sectionId) ?? null
    }
    return map.sections[slideIndex] ?? null
}

function clampProgress(value: number): number {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.min(1, value))
}
