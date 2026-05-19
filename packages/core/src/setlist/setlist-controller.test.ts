import { describe, expect, it, vi } from "vitest"
import { DEMO_TIMING_MAP } from "../output/test-utils.js"
import type { Arrangement, TimingMap } from "../types/timing-map.js"
import {
    createSetlistController,
    deriveSetlistSongs,
    type SetlistSyncEngine
} from "./setlist-controller.js"
import type { Project } from "./project-adapter.js"

function cloneMap(showId: string): TimingMap {
    return {
        ...DEMO_TIMING_MAP,
        showId,
        metadata: { ...DEMO_TIMING_MAP.metadata, sourceAudioHash: `${showId}-hash` }
    }
}

function makeProject(): Project {
    return {
        id: "p1",
        title: "Sunday Morning",
        shows: [
            { id: "s1", title: "Song One", artist: "A" },
            { id: "s2", title: "Reading" },
            { id: "s3", title: "Song Three" }
        ]
    }
}

function makeEngine() {
    const songCompleteHandlers = new Set<() => void>()
    const stateHandlers = new Set<(state: { runState: "idle" | "waitingForStart" | "running" | "finished"; vadState: "active" | "silent" }) => void>()
    let state = { runState: "idle" as const, vadState: "silent" as const }
    const engine: SetlistSyncEngine & {
        emitSongComplete(): void
        setState(next: typeof state): void
        calls: string[]
    } = {
        calls: [],
        loadSong: vi.fn((_opts: { map: TimingMap; arrangement: Arrangement | null; showId: string }) => {
            engine.calls.push("loadSong")
            state = { ...state, runState: "waitingForStart" }
        }),
        clearSong: vi.fn(() => {
            engine.calls.push("clearSong")
            state = { ...state, runState: "idle" }
        }),
        engageSync: vi.fn(() => {
            engine.calls.push("engageSync")
            state = { ...state, runState: "running" }
        }),
        forceTier: vi.fn(() => {
            engine.calls.push("forceTier")
        }),
        onSongComplete(handler) {
            songCompleteHandlers.add(handler)
            return () => songCompleteHandlers.delete(handler)
        },
        state: {
            subscribe(run) {
                stateHandlers.add(run)
                run(state)
                return () => stateHandlers.delete(run)
            }
        },
        emitSongComplete() {
            for (const handler of [...songCompleteHandlers]) handler()
        },
        setState(next) {
            state = next
            for (const handler of [...stateHandlers]) handler(state)
        }
    }
    return engine
}

describe("deriveSetlistSongs", () => {
    it("maps project show refs to learned/not-learned status", async () => {
        const songs = await deriveSetlistSongs(makeProject(), async (showId) => showId !== "s2")
        expect(songs).toEqual([
            { id: "s1", title: "Song One", artist: "A", syncStatus: "learned", bpm: null },
            { id: "s2", title: "Reading", syncStatus: "not-learned", bpm: null },
            { id: "s3", title: "Song Three", syncStatus: "learned", bpm: null }
        ])
    })
})

describe("createSetlistController", () => {
    it("loads learned songs into SyncEngine and OutputAdapter", async () => {
        const engine = makeEngine()
        const output = { loadTimingMap: vi.fn() }
        const controller = createSetlistController({
            syncEngine: engine,
            timingMaps: {
                exists: async () => true,
                load: async (showId) => cloneMap(showId),
                loadArrangement: async () => null
            },
            outputAdapter: output
        })
        await controller.loadProject(makeProject())
        await controller.jumpToSong("s1")
        expect(engine.loadSong).toHaveBeenCalledWith({ map: expect.objectContaining({ showId: "s1" }), arrangement: null, showId: "s1" })
        expect(output.loadTimingMap).toHaveBeenCalledWith(expect.objectContaining({ showId: "s1" }), null)
    })

    it("loads an available rehearsal timing-map variant for the active song", async () => {
        const engine = makeEngine()
        const studio = cloneMap("s1")
        const rehearsal: TimingMap = {
            ...cloneMap("s1"),
            learnedFrom: {
                ...cloneMap("s1").learnedFrom,
                method: "rehearsal",
                filename: "rehearsal.wav"
            }
        }
        const controller = createSetlistController({
            syncEngine: engine,
            timingMaps: {
                exists: async () => true,
                load: async () => studio,
                existsVariant: async (_showId, variant) => variant === "rehearsal",
                loadVariant: async (_showId, variant) => (variant === "rehearsal" ? rehearsal : null),
                loadArrangement: async () => null
            }
        })
        await controller.loadProject(makeProject())
        await controller.jumpToSong("s1")
        await controller.selectTimingMapVariant("rehearsal")

        expect(controller.snapshot().activeTimingMapVariant).toBe("rehearsal")
        expect(controller.snapshot().availableTimingMapVariants).toEqual(["studio", "rehearsal"])
        expect(engine.loadSong).toHaveBeenLastCalledWith({ map: expect.objectContaining({ learnedFrom: expect.objectContaining({ method: "rehearsal" }) }), arrangement: null, showId: "s1" })
    })

    it("ignores unavailable timing-map variants", async () => {
        const engine = makeEngine()
        const controller = createSetlistController({
            syncEngine: engine,
            timingMaps: {
                exists: async () => true,
                load: async (showId) => cloneMap(showId),
                existsVariant: async () => false,
                loadArrangement: async () => null
            }
        })
        await controller.loadProject(makeProject())
        await controller.jumpToSong("s1")
        await controller.selectTimingMapVariant("rehearsal")

        expect(controller.snapshot().activeTimingMapVariant).toBe("studio")
        expect(engine.loadSong).toHaveBeenCalledTimes(1)
    })

    it("auto-advances to the next learned song on songComplete", async () => {
        const engine = makeEngine()
        const controller = createSetlistController({
            syncEngine: engine,
            timingMaps: {
                exists: async () => true,
                load: async (showId) => cloneMap(showId),
                loadArrangement: async () => null
            }
        })
        await controller.loadProject({
            id: "p",
            title: "P",
            shows: [
                { id: "s1", title: "One" },
                { id: "s2", title: "Two" }
            ]
        })
        await controller.jumpToSong("s1")
        engine.emitSongComplete()
        await new Promise((r) => setTimeout(r, 0))
        expect(controller.snapshot().activeShowId).toBe("s2")
    })

    it("uses manual pass-through for non-learned items", async () => {
        const engine = makeEngine()
        const onPassThrough = vi.fn()
        const controller = createSetlistController({
            syncEngine: engine,
            timingMaps: {
                exists: async (showId) => showId === "s1",
                load: async (showId) => (showId === "s1" ? cloneMap(showId) : null),
                loadArrangement: async () => null
            },
            onPassThrough
        })
        await controller.loadProject(makeProject())
        await controller.jumpToSong("s2")
        expect(engine.forceTier).toHaveBeenCalledWith("manual")
        expect(engine.clearSong).toHaveBeenCalled()
        expect(onPassThrough).toHaveBeenCalledWith({ id: "s2", title: "Reading" })
        expect(controller.snapshot().passThroughShowId).toBe("s2")
    })

    it("engages a waiting song when VAD becomes active", async () => {
        const engine = makeEngine()
        const controller = createSetlistController({
            syncEngine: engine,
            timingMaps: {
                exists: async () => true,
                load: async (showId) => cloneMap(showId),
                loadArrangement: async () => null
            }
        })
        await controller.loadProject(makeProject())
        await controller.jumpToSong("s1")
        engine.setState({ runState: "waitingForStart", vadState: "active" })
        expect(engine.engageSync).toHaveBeenCalled()
        controller.destroy()
    })
})
