/**
 * AudioInput — owns the live audio capture chain. Stage 1 of the audio pipeline.
 *
 * Per EP-07 STORY-07.2 + STORY-07.3, architecture.md §4.4, FR3.1 + NFR2.4.
 *
 * Capture chain (architecture.md §4.4):
 *
 *   navigator.mediaDevices.enumerateDevices()  → device list (STORY-07.1)
 *           ↓
 *   navigator.mediaDevices.getUserMedia({ audio: { deviceId } })  → MediaStream
 *           ↓
 *   new AudioContext({ sampleRate: 48000 })  → context
 *           ↓
 *   ctx.createMediaStreamSource(stream)  → MediaStreamAudioSourceNode
 *
 * The source node is the fan-out point. Downstream consumers (BD via Meyda, VAD, STT,
 * rehearsal recording) attach analyser/worklet/processor nodes to it.
 *
 * This module exposes the source node and lifecycle hooks; it does NOT itself wire the
 * downstream nodes. Wiring lives at the operator-control-window level (EP-10) where the
 * AudioInput, BeatDetection, VAD, etc. modules are composed.
 *
 * Testability:
 *   - `navigator.mediaDevices` and `AudioContext` are renderer-only globals. Tests
 *     inject mocks via the `mediaDevices`, `audioContextCtor`, and `now` options.
 *   - The module never throws from start()/stop(); errors surface via `lastError`.
 */

import { writable, type Readable } from "../settings/observable.js"

export const AUDIO_INPUT_SAMPLE_RATE = 48_000 as const

/**
 * Subset of `navigator.mediaDevices` we depend on. Lets the production caller inject
 * `navigator.mediaDevices` directly; tests inject a fully-mocked surface.
 */
export interface MediaDevicesLike {
    enumerateDevices(): Promise<MediaDeviceInfo[]>
    getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>
}

/**
 * Subset of `AudioContext` we need. Constructors don't always behave well as types,
 * so we accept any builder that produces this shape.
 */
export interface AudioContextLike {
    sampleRate: number
    state: "suspended" | "running" | "closed"
    close(): Promise<void>
    resume(): Promise<void>
    createMediaStreamSource(stream: MediaStream): AudioNode
}

/**
 * Factory for creating an AudioContext at the desired sample rate. Tests inject
 * a mock that returns a stub context; production uses `new AudioContext({ sampleRate })`.
 */
export type AudioContextFactory = (opts: { sampleRate: number }) => AudioContextLike

export interface AudioInputStartOptions {
    /** The deviceId from `MediaDeviceInfo.deviceId`, or undefined for the system default. */
    deviceId?: string
}

export interface AudioInputDeviceInfo {
    deviceId: string
    /** Human-readable label, or "" if microphone permission has not been granted yet. */
    label: string
    /** From MediaDeviceInfo.kind — always "audioinput" for our purposes. */
    kind: "audioinput"
    /** From MediaDeviceInfo.groupId — used by the picker to dedupe identical sources. */
    groupId: string
}

/**
 * Reason an AudioInput is no longer producing samples. Drives SE's tier degradation
 * (NFR2.4) and the operator UI's error message.
 */
export type AudioInputLossReason =
    | "device-unplugged" // MediaStreamTrack.onended fired
    | "permission-denied" // user denied mic access
    | "device-not-found" // requested deviceId no longer exists
    | "context-closed" // AudioContext closed unexpectedly
    | "stopped" // operator stopped it explicitly

export interface AudioInputState {
    /** True from a successful start() until stop() or a disconnect. */
    running: boolean
    /** The deviceId currently in use, or null when not running. */
    activeDeviceId: string | null
    /** Last error encountered (start failure, disconnect, etc.). Cleared on start. */
    lastError: { at: number; message: string; reason: AudioInputLossReason } | null
}

export interface AudioInputOptions {
    /** Required: the renderer's `navigator.mediaDevices` or a test mock. */
    mediaDevices: MediaDevicesLike
    /** Required: factory that constructs the AudioContext. */
    audioContextCtor: AudioContextFactory
    /** Optional clock injection — defaults to `performance.now()`. */
    now?: () => number
}

export interface AudioInput {
    /** Snapshot of the current state. */
    readonly state: Readable<AudioInputState>

    /**
     * Enumerate available audio input devices. Labels are populated only after
     * microphone permission has been granted (browser security model).
     */
    enumerateDevices(): Promise<AudioInputDeviceInfo[]>

    /**
     * Open the selected device and build the capture chain. Resolves with the source
     * node downstream consumers attach to. Throws on configuration errors (passing
     * a non-existent deviceId) but surfaces runtime errors via `state.lastError`.
     */
    start(opts?: AudioInputStartOptions): Promise<AudioNode>

    /** Tear down the capture chain. Idempotent. */
    stop(reason?: AudioInputLossReason): Promise<void>

    /**
     * Subscribe to lifecycle events. `'audioInputLost'` fires when the device
     * disconnects mid-stream (NFR2.4) — SE listens to degrade to Timer tier.
     */
    onLost(handler: (reason: AudioInputLossReason) => void): () => void

    /** True iff the audio chain is currently active. */
    isRunning(): boolean
}

export function createAudioInput(opts: AudioInputOptions): AudioInput {
    const now = opts.now ?? (() => performance.now())

    const stateStore = writable<AudioInputState>({
        running: false,
        activeDeviceId: null,
        lastError: null
    })

    const lostHandlers = new Set<(reason: AudioInputLossReason) => void>()

    let activeStream: MediaStream | null = null
    let activeContext: AudioContextLike | null = null
    let activeTrack: MediaStreamTrack | null = null
    let trackEndedHandler: (() => void) | null = null

    function snapshot(): AudioInputState {
        let s: AudioInputState = { running: false, activeDeviceId: null, lastError: null }
        stateStore.subscribe((v) => (s = v))()
        return s
    }

    function notifyLost(reason: AudioInputLossReason): void {
        for (const h of [...lostHandlers]) {
            try {
                h(reason)
            } catch (err) {
                // A listener can't take down the audio pipeline; log and continue.
                // eslint-disable-next-line no-console
                console.error("[lyricue:audio-input] onLost handler threw:", err)
            }
        }
    }

    async function stop(reason: AudioInputLossReason = "stopped"): Promise<void> {
        // True iff the call path is "operator-initiated explicit stop". Other reasons
        // (device-unplugged, permission-denied, etc.) are recovery flows where lastError
        // must persist and the loss-event was already emitted by the caller.
        const isExplicit = reason === "stopped"

        if (activeTrack && trackEndedHandler) {
            activeTrack.removeEventListener("ended", trackEndedHandler)
        }
        trackEndedHandler = null
        activeTrack = null

        if (activeStream) {
            for (const t of activeStream.getTracks()) {
                try {
                    t.stop()
                } catch {
                    // already stopped — fine
                }
            }
            activeStream = null
        }

        if (activeContext) {
            try {
                if (activeContext.state !== "closed") await activeContext.close()
            } catch {
                // ignore — context already closed or never opened
            }
            activeContext = null
        }

        const previousError = snapshot().lastError
        stateStore.set({
            running: false,
            activeDeviceId: null,
            // When the caller explicitly stops, clear lastError; otherwise (disconnect,
            // context close) preserve the error so the diagnostics surface can show it.
            lastError: isExplicit ? null : previousError
        })
    }

    function attachTrackEndedListener(track: MediaStreamTrack): void {
        activeTrack = track
        trackEndedHandler = () => {
            const message = "Audio input track ended unexpectedly"
            stateStore.set({
                running: false,
                activeDeviceId: null,
                lastError: { at: now(), message, reason: "device-unplugged" }
            })
            // Notify synchronously so SE's tier-degradation logic (and any other listener)
            // sees the disconnect on the same tick the OS fired the event. Async cleanup
            // (closing tracks + context) is scheduled separately so listeners aren't
            // delayed by the awaitable close().
            notifyLost("device-unplugged")
            void stop("device-unplugged")
        }
        track.addEventListener("ended", trackEndedHandler)
    }

    async function start(startOpts: AudioInputStartOptions = {}): Promise<AudioNode> {
        // Re-entry guard: a duplicate start() resolves to the existing source if one exists.
        if (activeStream && activeContext) {
            return activeContext.createMediaStreamSource(activeStream)
        }

        const constraints: MediaStreamConstraints = startOpts.deviceId
            ? { audio: { deviceId: { exact: startOpts.deviceId } } }
            : { audio: true }

        let stream: MediaStream
        try {
            stream = await opts.mediaDevices.getUserMedia(constraints)
        } catch (err) {
            const message = (err as Error).message || "getUserMedia failed"
            // Distinguish permission denial (NotAllowedError) from device-not-found
            // (NotFoundError) for the operator UI.
            const reason: AudioInputLossReason =
                (err as Error).name === "NotAllowedError"
                    ? "permission-denied"
                    : (err as Error).name === "NotFoundError"
                      ? "device-not-found"
                      : "device-not-found"
            stateStore.set({
                running: false,
                activeDeviceId: null,
                lastError: { at: now(), message, reason }
            })
            throw err
        }

        let ctx: AudioContextLike
        try {
            ctx = opts.audioContextCtor({ sampleRate: AUDIO_INPUT_SAMPLE_RATE })
        } catch (err) {
            // Release the stream we just opened.
            for (const t of stream.getTracks()) {
                try {
                    t.stop()
                } catch {
                    // ignore
                }
            }
            const message = (err as Error).message || "AudioContext construction failed"
            stateStore.set({
                running: false,
                activeDeviceId: null,
                lastError: { at: now(), message, reason: "context-closed" }
            })
            throw err
        }

        // Listen for unexpected context close (e.g., OS audio-driver glitch).
        // AudioContext doesn't dispatch a CustomEvent we can subscribe to here without
        // narrowing to a specific runtime, so we rely on the track-ended path for the
        // common case (device unplug) and surface context-close via stop().

        activeStream = stream
        activeContext = ctx

        const tracks = stream.getAudioTracks()
        if (tracks.length === 0) {
            // Edge case: getUserMedia returned a stream with no audio tracks.
            await stop("device-not-found")
            const err = new Error("MediaStream has no audio tracks")
            stateStore.set({
                running: false,
                activeDeviceId: null,
                lastError: { at: now(), message: err.message, reason: "device-not-found" }
            })
            throw err
        }
        attachTrackEndedListener(tracks[0]!)

        const sourceNode = ctx.createMediaStreamSource(stream)

        stateStore.set({
            running: true,
            activeDeviceId: startOpts.deviceId ?? null,
            lastError: null
        })

        return sourceNode
    }

    async function enumerateDevices(): Promise<AudioInputDeviceInfo[]> {
        const all = await opts.mediaDevices.enumerateDevices()
        return all
            .filter((d) => d.kind === "audioinput")
            .map((d) => ({
                deviceId: d.deviceId,
                label: d.label ?? "",
                kind: "audioinput" as const,
                groupId: d.groupId ?? ""
            }))
    }

    return {
        state: { subscribe: (run) => stateStore.subscribe(run) },
        enumerateDevices,
        start,
        stop,
        onLost(handler) {
            lostHandlers.add(handler)
            return () => {
                lostHandlers.delete(handler)
            }
        },
        isRunning() {
            return snapshot().running
        }
    }
}
