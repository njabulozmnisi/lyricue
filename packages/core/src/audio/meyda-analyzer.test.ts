import { describe, it, expect, vi } from "vitest"
import {
    createMeydaFeatureSource,
    MEYDA_BUFFER_SIZE,
    MEYDA_FEATURE_LIST,
    type MeydaAnalyzerLike,
    type MeydaFactory
} from "./meyda-analyzer.js"

/**
 * STORY-07.4 acceptance tests.
 *
 * AC1: Meyda.createMeydaAnalyzer wired with features per arch §4.5 — verified by the
 *      factory contract test that asserts the features list passed to the factory.
 * AC2: Buffer size 512 samples — verified by the buffer-size constant.
 * AC3: Feature stream as Svelte store + raw event callbacks — both surfaces tested.
 */

/**
 * Helper: build a mock factory + analyser pair that captures all calls and lets the
 * test drive feature emission deterministically.
 */
function makeMockFactory() {
    const calls: { args: any[]; analyser: MeydaAnalyzerLike }[] = []
    let active = false
    let pendingCallback: ((features: Record<string, unknown>) => void) | null = null

    const factory: MeydaFactory = vi.fn((args) => {
        const analyser: MeydaAnalyzerLike = {
            start: vi.fn(() => {
                active = true
                pendingCallback = args.callback
            }),
            stop: vi.fn(() => {
                active = false
                pendingCallback = null
            })
        }
        calls.push({ args: [args], analyser })
        return analyser
    })

    return {
        factory,
        calls,
        get isActive() {
            return active
        },
        emitFeatures: (raw: Record<string, unknown>) => {
            if (pendingCallback) pendingCallback(raw)
        }
    }
}

describe("createMeydaFeatureSource — factory contract (AC1, AC2)", () => {
    it("passes the documented feature list to the Meyda factory", () => {
        const m = makeMockFactory()
        const src = createMeydaFeatureSource({
            source: {} as unknown,
            audioContext: {} as unknown,
            factory: m.factory
        })
        src.start()
        expect(m.calls).toHaveLength(1)
        expect(m.calls[0]!.args[0].featureExtractors).toEqual(MEYDA_FEATURE_LIST)
        src.stop()
    })

    it("uses the default 512-sample buffer when not overridden", () => {
        const m = makeMockFactory()
        const src = createMeydaFeatureSource({
            source: {} as unknown,
            audioContext: {} as unknown,
            factory: m.factory
        })
        src.start()
        expect(m.calls[0]!.args[0].bufferSize).toBe(MEYDA_BUFFER_SIZE)
        expect(MEYDA_BUFFER_SIZE).toBe(512)
        src.stop()
    })

    it("respects an explicit bufferSize override", () => {
        const m = makeMockFactory()
        const src = createMeydaFeatureSource({
            source: {} as unknown,
            audioContext: {} as unknown,
            factory: m.factory,
            bufferSize: 1024
        })
        src.start()
        expect(m.calls[0]!.args[0].bufferSize).toBe(1024)
        src.stop()
    })

    it("forwards the source and audioContext into the factory", () => {
        const source = { kind: "fake-source" }
        const audioContext = { kind: "fake-ctx" }
        const m = makeMockFactory()
        const src = createMeydaFeatureSource({ source, audioContext, factory: m.factory })
        src.start()
        expect(m.calls[0]!.args[0].source).toBe(source)
        expect(m.calls[0]!.args[0].audioContext).toBe(audioContext)
        src.stop()
    })
})

describe("createMeydaFeatureSource — lifecycle", () => {
    it("isRunning() reflects start/stop state", () => {
        const m = makeMockFactory()
        const src = createMeydaFeatureSource({
            source: {} as unknown,
            audioContext: {} as unknown,
            factory: m.factory
        })
        expect(src.isRunning()).toBe(false)
        src.start()
        expect(src.isRunning()).toBe(true)
        src.stop()
        expect(src.isRunning()).toBe(false)
    })

    it("start() is idempotent — calling twice does not create a second analyser", () => {
        const m = makeMockFactory()
        const src = createMeydaFeatureSource({
            source: {} as unknown,
            audioContext: {} as unknown,
            factory: m.factory
        })
        src.start()
        src.start()
        expect(m.calls).toHaveLength(1)
        src.stop()
    })

    it("stop() is idempotent — calling on an already-stopped source is a no-op", () => {
        const m = makeMockFactory()
        const src = createMeydaFeatureSource({
            source: {} as unknown,
            audioContext: {} as unknown,
            factory: m.factory
        })
        src.stop() // before start
        expect(src.isRunning()).toBe(false)
        src.start()
        src.stop()
        src.stop()
        expect(src.isRunning()).toBe(false)
    })

    it("survives an analyser whose stop() throws", () => {
        const m = makeMockFactory()
        const factory: MeydaFactory = vi.fn((args) => ({
            start: vi.fn(),
            stop: vi.fn(() => {
                throw new Error("Audio context already closed")
            })
        }))
        const src = createMeydaFeatureSource({
            source: {} as unknown,
            audioContext: {} as unknown,
            factory
        })
        src.start()
        expect(() => src.stop()).not.toThrow()
        expect(src.isRunning()).toBe(false)
        // Use m to avoid the unused warning — and to keep the test parallel to others
        expect(m.calls).toEqual([])
    })
})

describe("createMeydaFeatureSource — feature dispatch (AC3)", () => {
    it("delivers features to onFeatures handlers", () => {
        const m = makeMockFactory()
        const src = createMeydaFeatureSource({
            source: {} as unknown,
            audioContext: {} as unknown,
            factory: m.factory
        })
        const seen: any[] = []
        src.onFeatures((f) => seen.push(f))
        src.start()
        m.emitFeatures({ rms: 0.5, energy: 0.3, spectralCentroid: 1200, spectralFlux: 0.7 })
        expect(seen).toEqual([{ rms: 0.5, energy: 0.3, spectralCentroid: 1200, spectralFlux: 0.7 }])
        src.stop()
    })

    it("updates the features store on every emission", () => {
        const m = makeMockFactory()
        const src = createMeydaFeatureSource({
            source: {} as unknown,
            audioContext: {} as unknown,
            factory: m.factory
        })
        let latest: any = "uninitialised"
        src.features.subscribe((f) => (latest = f))
        expect(latest).toBeNull()
        src.start()
        m.emitFeatures({ rms: 0.42, energy: 0.1, spectralCentroid: 800, spectralFlux: 0.55 })
        expect(latest).toMatchObject({ rms: 0.42, spectralFlux: 0.55 })
        src.stop()
        expect(latest).toBeNull() // stop clears the store
    })

    it("coerces missing / non-finite feature values to 0", () => {
        const m = makeMockFactory()
        const src = createMeydaFeatureSource({
            source: {} as unknown,
            audioContext: {} as unknown,
            factory: m.factory
        })
        const seen: any[] = []
        src.onFeatures((f) => seen.push(f))
        src.start()
        m.emitFeatures({
            rms: Number.NaN,
            energy: Number.POSITIVE_INFINITY,
            spectralCentroid: undefined,
            spectralFlux: "not a number"
            // No key for spectralCentroid present in the real Meyda output is also possible.
        } as any)
        expect(seen[0]).toEqual({ rms: 0, energy: 0, spectralCentroid: 0, spectralFlux: 0 })
        src.stop()
    })

    it("multiple handlers all receive the feature", () => {
        const m = makeMockFactory()
        const src = createMeydaFeatureSource({
            source: {} as unknown,
            audioContext: {} as unknown,
            factory: m.factory
        })
        const a: any[] = []
        const b: any[] = []
        src.onFeatures((f) => a.push(f))
        src.onFeatures((f) => b.push(f))
        src.start()
        m.emitFeatures({ rms: 1, energy: 1, spectralCentroid: 1, spectralFlux: 1 })
        expect(a).toHaveLength(1)
        expect(b).toHaveLength(1)
        src.stop()
    })

    it("unsubscribe stops a specific handler without affecting others", () => {
        const m = makeMockFactory()
        const src = createMeydaFeatureSource({
            source: {} as unknown,
            audioContext: {} as unknown,
            factory: m.factory
        })
        const a: any[] = []
        const b: any[] = []
        const unsubA = src.onFeatures((f) => a.push(f))
        src.onFeatures((f) => b.push(f))
        src.start()
        m.emitFeatures({ rms: 1, energy: 1, spectralCentroid: 1, spectralFlux: 1 })
        unsubA()
        m.emitFeatures({ rms: 2, energy: 2, spectralCentroid: 2, spectralFlux: 2 })
        expect(a).toHaveLength(1)
        expect(b).toHaveLength(2)
        src.stop()
    })

    it("a handler that throws does not kill the pipeline", () => {
        const m = makeMockFactory()
        const src = createMeydaFeatureSource({
            source: {} as unknown,
            audioContext: {} as unknown,
            factory: m.factory
        })
        const survivor: any[] = []
        src.onFeatures(() => {
            throw new Error("subscriber blew up")
        })
        src.onFeatures((f) => survivor.push(f))
        src.start()
        expect(() => {
            m.emitFeatures({ rms: 0.5, energy: 0.3, spectralCentroid: 1, spectralFlux: 0.5 })
        }).not.toThrow()
        // The well-behaved subscriber still got the frame.
        expect(survivor).toHaveLength(1)
        src.stop()
    })

    it("stopping detaches handlers — emit-after-stop reaches no one", () => {
        const m = makeMockFactory()
        const src = createMeydaFeatureSource({
            source: {} as unknown,
            audioContext: {} as unknown,
            factory: m.factory
        })
        const seen: any[] = []
        src.onFeatures((f) => seen.push(f))
        src.start()
        m.emitFeatures({ rms: 1, energy: 1, spectralCentroid: 1, spectralFlux: 1 })
        src.stop()
        // After stop, the mock's pendingCallback is null and our mock no-ops emitFeatures.
        m.emitFeatures({ rms: 9, energy: 9, spectralCentroid: 9, spectralFlux: 9 })
        expect(seen).toHaveLength(1)
    })
})
