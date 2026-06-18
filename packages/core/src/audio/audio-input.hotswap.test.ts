/**
 * EP-07 hot-swap contract — operator changes audio device mid-session.
 *
 * Real production scenario: the operator was using the built-in mic; their USB
 * interface was plugged in mid-rehearsal; they pick the new device from the operator
 * Settings panel. The audio pipeline must release the old device, acquire the new one,
 * and resume frame emission without dropping the SyncEngine connection.
 *
 * The contract:
 *   stop() must always succeed (idempotent + no-throw).
 *   start({ deviceId: newId }) after a stop() must acquire the new device.
 *   The reported activeDeviceId in state must reflect the new device.
 *   getUserMedia must be called with the new deviceId constraint.
 */

import { describe, it, expect, vi } from "vitest"
import { createAudioInput, type AudioContextLike, type AudioInputState, type MediaDevicesLike } from "./audio-input.js"
import type { Readable } from "../settings/observable.js"

function snapshotOf(store: Readable<AudioInputState>): AudioInputState {
    let snap: AudioInputState | null = null
    const unsub = store.subscribe((v) => (snap = v))
    unsub()
    if (!snap) throw new Error("store subscribe did not synchronously yield a value")
    return snap
}

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
            const list = listeners.get(event)
            if (!list) return
            listeners.set(
                event,
                list.filter((l) => l !== handler)
            )
        },
        emit(event) {
            for (const handler of listeners.get(event) ?? []) handler()
        }
    }
}

function makeFakeStream(): FakeStream {
    const track = makeFakeTrack()
    return {
        tracks: [track],
        getTracks: () => [track],
        getAudioTracks: () => [track]
    }
}

function makeFakeContext(): AudioContextLike & { closed: boolean } {
    return {
        sampleRate: 48000,
        state: "running",
        createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode)),
        close: vi.fn(async function (this: { closed: boolean }) {
            this.closed = true
        }),
        closed: false
    } as unknown as AudioContextLike & { closed: boolean }
}

describe("AudioInput hot-swap contract", () => {
    it("releases the old device and acquires a new one when the operator changes deviceId", async () => {
        const acquiredDeviceIds: (string | undefined)[] = []
        const streams: FakeStream[] = []
        const mediaDevices: MediaDevicesLike = {
            enumerateDevices: vi.fn(async () => [
                { deviceId: "mic-1", label: "Built-in", kind: "audioinput", groupId: "g1" } as MediaDeviceInfo,
                { deviceId: "mic-2", label: "USB Interface", kind: "audioinput", groupId: "g2" } as MediaDeviceInfo
            ]),
            getUserMedia: vi.fn(async (constraints) => {
                const audio = (constraints as MediaStreamConstraints).audio
                const deviceId =
                    typeof audio === "object" && audio && "deviceId" in audio
                        ? (audio.deviceId as { exact?: string }).exact
                        : undefined
                acquiredDeviceIds.push(deviceId)
                const stream = makeFakeStream()
                streams.push(stream)
                return stream as unknown as MediaStream
            })
        }
        const audioContextCtor = vi.fn(() => makeFakeContext())

        const ai = createAudioInput({ mediaDevices, audioContextCtor })

        // 1. Start with the built-in mic.
        await ai.start({ deviceId: "mic-1" })
        expect(ai.isRunning()).toBe(true)
        expect(snapshotOf(ai.state).activeDeviceId).toBe("mic-1")

        // 2. Operator switches to the USB interface mid-session.
        await ai.stop()
        expect(ai.isRunning()).toBe(false)
        // The previous stream's track must have been .stop()'d so the OS releases the device.
        expect(streams[0]!.tracks[0]!.stopped).toBe(true)

        await ai.start({ deviceId: "mic-2" })
        expect(ai.isRunning()).toBe(true)
        expect(snapshotOf(ai.state).activeDeviceId).toBe("mic-2")

        // Both deviceId constraints reached getUserMedia.
        expect(acquiredDeviceIds).toEqual(["mic-1", "mic-2"])
    })

    it("stop() is idempotent — calling it twice with no start in between does not throw", async () => {
        const mediaDevices: MediaDevicesLike = {
            enumerateDevices: vi.fn(async () => []),
            getUserMedia: vi.fn(async () => makeFakeStream() as unknown as MediaStream)
        }
        const ai = createAudioInput({ mediaDevices, audioContextCtor: vi.fn(() => makeFakeContext()) })
        await expect(ai.stop()).resolves.toBeUndefined()
        await expect(ai.stop()).resolves.toBeUndefined()
    })

    it("a hot-swap to a device that fails getUserMedia surfaces lastError without crashing the input module", async () => {
        let callCount = 0
        const mediaDevices: MediaDevicesLike = {
            enumerateDevices: vi.fn(async () => [
                { deviceId: "mic-1", label: "Built-in", kind: "audioinput", groupId: "g1" } as MediaDeviceInfo
            ]),
            getUserMedia: vi.fn(async () => {
                callCount++
                if (callCount === 2) throw new Error("NotFoundError: requested device is gone")
                return makeFakeStream() as unknown as MediaStream
            })
        }
        const ai = createAudioInput({ mediaDevices, audioContextCtor: vi.fn(() => makeFakeContext()) })
        await ai.start({ deviceId: "mic-1" })
        await ai.stop()
        // Second start fails — lastError is recorded; module remains usable for another retry.
        await expect(ai.start({ deviceId: "mic-2" })).rejects.toThrow()
        const snapshot = snapshotOf(ai.state)
        expect(snapshot.lastError).not.toBeNull()
        expect(snapshot.running).toBe(false)
    })
})
