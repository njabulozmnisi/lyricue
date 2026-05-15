import { describe, it, expect, vi, beforeEach } from "vitest"
import {
    AUDIO_INPUT_SAMPLE_RATE,
    createAudioInput,
    type AudioContextLike,
    type MediaDevicesLike
} from "./audio-input.js"

/**
 * STORY-07.2 + STORY-07.3 acceptance tests.
 *
 * AC1 (07.2): captures via getUserMedia({ audio: { deviceId } }) — verified.
 * AC2 (07.2): AudioContext at 48000 Hz — verified.
 * AC3 (07.2): exposes source node + onLost hook — verified.
 * AC4 (07.2): tear-down releases stream + closes context — verified.
 * AC5 (07.2) latency ≤30ms: not testable in unit context (real audio). Documented.
 *
 * AC1 (07.3): MediaStreamTrack.onended triggers audioInputLost — verified.
 * AC2 (07.3): subscribers receive the event — verified.
 * AC3 (07.3): UI message: that's a renderer-component concern, out of scope here.
 *
 * Mock harness simulates a browser-flavoured navigator.mediaDevices + AudioContext
 * pair entirely in JS — no jsdom polyfills, no platform deps.
 */

interface FakeTrack {
    stopped: boolean
    listeners: Map<string, ((...args: unknown[]) => void)[]>
    stop(): void
    addEventListener(event: string, handler: (...args: unknown[]) => void): void
    removeEventListener(event: string, handler: (...args: unknown[]) => void): void
    emit(event: string): void
}

interface FakeStream {
    tracks: FakeTrack[]
    getTracks(): FakeTrack[]
    getAudioTracks(): FakeTrack[]
}

function makeFakeTrack(): FakeTrack {
    const listeners = new Map<string, ((...args: unknown[]) => void)[]>()
    return {
        stopped: false,
        listeners,
        stop() {
            this.stopped = true
        },
        addEventListener(event, handler) {
            if (!listeners.has(event)) listeners.set(event, [])
            listeners.get(event)!.push(handler)
        },
        removeEventListener(event, handler) {
            const arr = listeners.get(event)
            if (!arr) return
            const idx = arr.indexOf(handler)
            if (idx >= 0) arr.splice(idx, 1)
        },
        emit(event) {
            for (const h of listeners.get(event) ?? []) h()
        }
    }
}

function makeFakeStream(trackCount = 1): FakeStream {
    const tracks = Array.from({ length: trackCount }, makeFakeTrack)
    return {
        tracks,
        getTracks: () => tracks,
        getAudioTracks: () => tracks
    }
}

function makeFakeContext(): AudioContextLike & { closed: boolean; createCalls: unknown[] } {
    const ctx = {
        sampleRate: 48_000,
        state: "running" as "suspended" | "running" | "closed",
        closed: false,
        createCalls: [] as unknown[],
        async close() {
            this.state = "closed"
            this.closed = true
        },
        async resume() {
            this.state = "running"
        },
        createMediaStreamSource(stream: any) {
            this.createCalls.push(stream)
            return { kind: "fake-source-node", connectedTo: stream } as unknown as AudioNode
        }
    }
    return ctx
}

function makeHarness(opts: { devices?: MediaDeviceInfo[]; getUserMediaError?: Error } = {}) {
    const devices = opts.devices ?? [
        { deviceId: "mic-1", label: "Built-in Mic", kind: "audioinput", groupId: "g1" } as MediaDeviceInfo,
        { deviceId: "mic-2", label: "USB Interface", kind: "audioinput", groupId: "g2" } as MediaDeviceInfo,
        { deviceId: "spk-1", label: "Speakers", kind: "audiooutput", groupId: "g3" } as MediaDeviceInfo
    ]
    let lastStream: FakeStream | null = null
    const mediaDevices: MediaDevicesLike = {
        enumerateDevices: vi.fn(async () => devices),
        getUserMedia: vi.fn(async (constraints) => {
            if (opts.getUserMediaError) throw opts.getUserMediaError
            lastStream = makeFakeStream(1)
            void constraints
            return lastStream as unknown as MediaStream
        })
    }

    const contexts: ReturnType<typeof makeFakeContext>[] = []
    const audioContextCtor = vi.fn((args: { sampleRate: number }) => {
        const c = makeFakeContext()
        c.sampleRate = args.sampleRate
        contexts.push(c)
        return c
    })

    return {
        mediaDevices,
        audioContextCtor,
        contexts,
        get lastStream() {
            return lastStream
        }
    }
}

describe("createAudioInput — enumerateDevices", () => {
    it("returns only audioinput devices", async () => {
        const h = makeHarness()
        const ai = createAudioInput({ mediaDevices: h.mediaDevices, audioContextCtor: h.audioContextCtor })
        const devices = await ai.enumerateDevices()
        expect(devices).toHaveLength(2)
        expect(devices.map((d) => d.deviceId)).toEqual(["mic-1", "mic-2"])
        expect(devices.every((d) => d.kind === "audioinput")).toBe(true)
    })

    it("handles a navigator that returns no devices", async () => {
        const h = makeHarness({ devices: [] })
        const ai = createAudioInput({ mediaDevices: h.mediaDevices, audioContextCtor: h.audioContextCtor })
        await expect(ai.enumerateDevices()).resolves.toEqual([])
    })
})

describe("createAudioInput — start() lifecycle (STORY-07.2)", () => {
    it("calls getUserMedia with the deviceId constraint when provided", async () => {
        const h = makeHarness()
        const ai = createAudioInput({ mediaDevices: h.mediaDevices, audioContextCtor: h.audioContextCtor })
        await ai.start({ deviceId: "mic-2" })
        expect(h.mediaDevices.getUserMedia).toHaveBeenCalledWith({
            audio: { deviceId: { exact: "mic-2" } }
        })
        await ai.stop()
    })

    it("falls back to `{ audio: true }` when no deviceId is provided", async () => {
        const h = makeHarness()
        const ai = createAudioInput({ mediaDevices: h.mediaDevices, audioContextCtor: h.audioContextCtor })
        await ai.start()
        expect(h.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true })
        await ai.stop()
    })

    it("constructs an AudioContext at 48 kHz per architecture §4.4", async () => {
        const h = makeHarness()
        const ai = createAudioInput({ mediaDevices: h.mediaDevices, audioContextCtor: h.audioContextCtor })
        await ai.start()
        expect(h.audioContextCtor).toHaveBeenCalledWith({ sampleRate: 48_000 })
        expect(AUDIO_INPUT_SAMPLE_RATE).toBe(48_000)
        await ai.stop()
    })

    it("returns the source node from start()", async () => {
        const h = makeHarness()
        const ai = createAudioInput({ mediaDevices: h.mediaDevices, audioContextCtor: h.audioContextCtor })
        const node = await ai.start()
        expect((node as any).kind).toBe("fake-source-node")
        await ai.stop()
    })

    it("sets running=true after a successful start", async () => {
        const h = makeHarness()
        const ai = createAudioInput({ mediaDevices: h.mediaDevices, audioContextCtor: h.audioContextCtor })
        let latest: any
        ai.state.subscribe((s) => (latest = s))
        await ai.start({ deviceId: "mic-1" })
        expect(latest.running).toBe(true)
        expect(latest.activeDeviceId).toBe("mic-1")
        expect(latest.lastError).toBeNull()
        await ai.stop()
    })

    it("is idempotent: a second start() returns a source instead of reopening", async () => {
        const h = makeHarness()
        const ai = createAudioInput({ mediaDevices: h.mediaDevices, audioContextCtor: h.audioContextCtor })
        await ai.start({ deviceId: "mic-1" })
        await ai.start({ deviceId: "mic-1" })
        // Only one getUserMedia call across both starts.
        expect(h.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
        await ai.stop()
    })
})

describe("createAudioInput — start() error paths (STORY-07.2)", () => {
    it("surfaces permission-denied via lastError when getUserMedia throws NotAllowedError", async () => {
        const err = Object.assign(new Error("user said no"), { name: "NotAllowedError" })
        const h = makeHarness({ getUserMediaError: err })
        const ai = createAudioInput({ mediaDevices: h.mediaDevices, audioContextCtor: h.audioContextCtor })
        await expect(ai.start()).rejects.toThrow(/user said no/)
        let latest: any
        ai.state.subscribe((s) => (latest = s))
        expect(latest.running).toBe(false)
        expect(latest.lastError.reason).toBe("permission-denied")
    })

    it("surfaces device-not-found via lastError when getUserMedia throws NotFoundError", async () => {
        const err = Object.assign(new Error("no such mic"), { name: "NotFoundError" })
        const h = makeHarness({ getUserMediaError: err })
        const ai = createAudioInput({ mediaDevices: h.mediaDevices, audioContextCtor: h.audioContextCtor })
        await expect(ai.start({ deviceId: "ghost" })).rejects.toThrow(/no such mic/)
        let latest: any
        ai.state.subscribe((s) => (latest = s))
        expect(latest.lastError.reason).toBe("device-not-found")
    })

    it("surfaces context-closed via lastError when AudioContext construction throws", async () => {
        const h = makeHarness()
        const ai = createAudioInput({
            mediaDevices: h.mediaDevices,
            audioContextCtor: () => {
                throw new Error("Audio driver in use")
            }
        })
        await expect(ai.start()).rejects.toThrow(/Audio driver in use/)
        let latest: any
        ai.state.subscribe((s) => (latest = s))
        expect(latest.lastError.reason).toBe("context-closed")
        // The stream that was opened should have been released.
        expect(h.lastStream?.tracks.every((t) => t.stopped)).toBe(true)
    })

    it("fails when getUserMedia returns a stream with no audio tracks", async () => {
        // A non-standard but possible edge case: getUserMedia resolves with no tracks.
        const mediaDevices: MediaDevicesLike = {
            enumerateDevices: vi.fn(async () => []),
            getUserMedia: vi.fn(async () => makeFakeStream(0) as unknown as MediaStream)
        }
        const ai = createAudioInput({
            mediaDevices,
            audioContextCtor: () => makeFakeContext()
        })
        await expect(ai.start()).rejects.toThrow(/no audio tracks/)
    })
})

describe("createAudioInput — stop() (STORY-07.2 AC4)", () => {
    it("releases the MediaStream tracks", async () => {
        const h = makeHarness()
        const ai = createAudioInput({ mediaDevices: h.mediaDevices, audioContextCtor: h.audioContextCtor })
        await ai.start()
        await ai.stop()
        expect(h.lastStream?.tracks.every((t) => t.stopped)).toBe(true)
    })

    it("closes the AudioContext", async () => {
        const h = makeHarness()
        const ai = createAudioInput({ mediaDevices: h.mediaDevices, audioContextCtor: h.audioContextCtor })
        await ai.start()
        const ctx = h.contexts[0]!
        await ai.stop()
        expect(ctx.closed).toBe(true)
        expect(ctx.state).toBe("closed")
    })

    it("is idempotent — stop on a never-started input is a no-op", async () => {
        const h = makeHarness()
        const ai = createAudioInput({ mediaDevices: h.mediaDevices, audioContextCtor: h.audioContextCtor })
        await expect(ai.stop()).resolves.toBeUndefined()
        expect(ai.isRunning()).toBe(false)
    })

    it("clears lastError when the operator calls stop() explicitly", async () => {
        // Simulate a previously-failed start then a manual stop.
        const err = Object.assign(new Error("denied"), { name: "NotAllowedError" })
        let throwIt = true
        const mediaDevices: MediaDevicesLike = {
            enumerateDevices: vi.fn(async () => []),
            getUserMedia: vi.fn(async () => {
                if (throwIt) throw err
                return makeFakeStream(1) as unknown as MediaStream
            })
        }
        const ai = createAudioInput({
            mediaDevices,
            audioContextCtor: () => makeFakeContext()
        })
        await ai.start().catch(() => {})
        // lastError set; running false. Now retry — succeed this time and then stop().
        throwIt = false
        await ai.start()
        await ai.stop()
        let latest: any
        ai.state.subscribe((s) => (latest = s))
        expect(latest.lastError).toBeNull()
    })
})

describe("createAudioInput — device-disconnect handling (STORY-07.3)", () => {
    it("emits audioInputLost when the MediaStreamTrack fires 'ended'", async () => {
        const h = makeHarness()
        const ai = createAudioInput({ mediaDevices: h.mediaDevices, audioContextCtor: h.audioContextCtor })
        const lostEvents: string[] = []
        ai.onLost((reason) => lostEvents.push(reason))
        await ai.start({ deviceId: "mic-1" })

        // Simulate the OS killing the audio track (device unplugged).
        h.lastStream!.tracks[0]!.emit("ended")

        expect(lostEvents).toEqual(["device-unplugged"])
    })

    it("surfaces a clear lastError with reason='device-unplugged' after disconnect", async () => {
        const h = makeHarness()
        const ai = createAudioInput({ mediaDevices: h.mediaDevices, audioContextCtor: h.audioContextCtor })
        await ai.start()
        h.lastStream!.tracks[0]!.emit("ended")
        let latest: any
        ai.state.subscribe((s) => (latest = s))
        expect(latest.running).toBe(false)
        expect(latest.lastError.reason).toBe("device-unplugged")
        expect(latest.lastError.message).toMatch(/ended unexpectedly/)
    })

    it("does NOT emit audioInputLost on a deliberate stop()", async () => {
        const h = makeHarness()
        const ai = createAudioInput({ mediaDevices: h.mediaDevices, audioContextCtor: h.audioContextCtor })
        const lostEvents: string[] = []
        ai.onLost((reason) => lostEvents.push(reason))
        await ai.start()
        await ai.stop()
        expect(lostEvents).toEqual([])
    })

    it("unsubscribe removes the lost-handler without affecting others", async () => {
        const h = makeHarness()
        const ai = createAudioInput({ mediaDevices: h.mediaDevices, audioContextCtor: h.audioContextCtor })
        const a: string[] = []
        const b: string[] = []
        const unsubA = ai.onLost((r) => a.push(r))
        ai.onLost((r) => b.push(r))
        await ai.start()
        unsubA()
        h.lastStream!.tracks[0]!.emit("ended")
        expect(a).toHaveLength(0)
        expect(b).toEqual(["device-unplugged"])
    })

    it("a throwing onLost handler does not break other subscribers", async () => {
        const h = makeHarness()
        const ai = createAudioInput({ mediaDevices: h.mediaDevices, audioContextCtor: h.audioContextCtor })
        const survivor: string[] = []
        ai.onLost(() => {
            throw new Error("subscriber blew up")
        })
        ai.onLost((r) => survivor.push(r))
        await ai.start()
        expect(() => h.lastStream!.tracks[0]!.emit("ended")).not.toThrow()
        expect(survivor).toEqual(["device-unplugged"])
    })
})

describe("createAudioInput — state subscriptions", () => {
    let h: ReturnType<typeof makeHarness>
    beforeEach(() => {
        h = makeHarness()
    })

    it("notifies the current state immediately on subscribe", () => {
        const ai = createAudioInput({ mediaDevices: h.mediaDevices, audioContextCtor: h.audioContextCtor })
        let count = 0
        ai.state.subscribe(() => count++)()
        expect(count).toBe(1)
    })

    it("isRunning() agrees with state.running across the lifecycle", async () => {
        const ai = createAudioInput({ mediaDevices: h.mediaDevices, audioContextCtor: h.audioContextCtor })
        expect(ai.isRunning()).toBe(false)
        await ai.start()
        expect(ai.isRunning()).toBe(true)
        await ai.stop()
        expect(ai.isRunning()).toBe(false)
    })
})
