import { describe, it, expect } from "vitest"
import {
    createVadDetector,
    DEFAULT_VAD_ENTER_MS,
    DEFAULT_VAD_ENTER_THRESHOLD,
    DEFAULT_VAD_EXIT_MS,
    DEFAULT_VAD_EXIT_THRESHOLD
} from "./vad.js"

/**
 * STORY-08.1 acceptance tests.
 *
 * AC1: consumes rms from Meyda — verified by the feed(rms, t) signature.
 * AC2: Schmitt-trigger with enterMs=300ms / exitMs=1500ms — verified.
 * AC3: vadState Svelte store + transition callbacks — verified.
 * AC4: defaults match DEFAULT_LYRICUE_SETTINGS — verified.
 */

describe("createVadDetector — initial state", () => {
    it("starts in 'silent' by default", () => {
        const v = createVadDetector()
        expect(v.snapshot()).toBe("silent")
    })

    it("honours an explicit initialState override", () => {
        const v = createVadDetector({ initialState: "active" })
        expect(v.snapshot()).toBe("active")
    })

    it("publishes the initial state to subscribers immediately", () => {
        const v = createVadDetector()
        let seen: string | undefined
        v.state.subscribe((s) => (seen = s))()
        expect(seen).toBe("silent")
    })
})

describe("createVadDetector — silent → active transition", () => {
    it("transitions only after rms > enterThreshold sustained for ≥enterMs", () => {
        const v = createVadDetector({ enterMs: 300, enterThreshold: 0.05 })
        // First sample crosses the threshold but doesn't trigger yet.
        expect(v.feed(0.1, 0)).toBe("silent")
        // 200ms in — still under the 300ms dwell.
        expect(v.feed(0.1, 200)).toBe("silent")
        // 299ms in — still under.
        expect(v.feed(0.1, 299)).toBe("silent")
        // 300ms — exactly meets the dwell, transitions.
        expect(v.feed(0.1, 300)).toBe("active")
    })

    it("does NOT transition when rms is exactly at the threshold (strict >)", () => {
        const v = createVadDetector({ enterMs: 100, enterThreshold: 0.05 })
        // RMS exactly at threshold — must NOT count toward active dwell.
        expect(v.feed(0.05, 0)).toBe("silent")
        expect(v.feed(0.05, 200)).toBe("silent")
    })

    it("resets the dwell when rms dips back below the enter threshold", () => {
        const v = createVadDetector({ enterMs: 300, enterThreshold: 0.05 })
        v.feed(0.1, 0) // start dwell
        v.feed(0.04, 200) // dip below — dwell abandoned
        v.feed(0.1, 300) // restart dwell
        v.feed(0.1, 599) // 299ms after restart — still under
        expect(v.snapshot()).toBe("silent")
        v.feed(0.1, 600) // 300ms after restart — triggers
        expect(v.snapshot()).toBe("active")
    })

    it("emits a 'transition' callback on silent → active", () => {
        const v = createVadDetector({ enterMs: 100, enterThreshold: 0.05 })
        const events: string[] = []
        v.onTransition((s) => events.push(s))
        v.feed(0.1, 0)
        v.feed(0.1, 100)
        expect(events).toEqual(["active"])
    })

    it("updates the Svelte store on transition", () => {
        const v = createVadDetector({ enterMs: 100, enterThreshold: 0.05 })
        const seen: string[] = []
        v.state.subscribe((s) => seen.push(s))
        v.feed(0.1, 0)
        v.feed(0.1, 100)
        // Subscribe captures initial 'silent' immediately, then 'active' on transition.
        expect(seen).toEqual(["silent", "active"])
    })
})

describe("createVadDetector — active → silent transition", () => {
    function makeActive(opts: { enterMs?: number; enterThreshold?: number; exitMs?: number; exitThreshold?: number } = {}) {
        const v = createVadDetector({
            enterMs: opts.enterMs ?? 100,
            enterThreshold: opts.enterThreshold ?? 0.05,
            exitMs: opts.exitMs ?? 1500,
            exitThreshold: opts.exitThreshold ?? 0.02
        })
        v.feed(0.1, 0)
        v.feed(0.1, 100)
        // Now active.
        return v
    }

    it("transitions only after rms < exitThreshold sustained for ≥exitMs", () => {
        const v = makeActive({ exitMs: 1500, exitThreshold: 0.02 })
        // RMS drops below exit threshold — dwell starts.
        expect(v.feed(0.01, 100)).toBe("active")
        // 1499ms later — still active.
        expect(v.feed(0.01, 1599)).toBe("active")
        // 1500ms later — transitions.
        expect(v.feed(0.01, 1600)).toBe("silent")
    })

    it("does NOT transition when rms is exactly at the exit threshold (strict <)", () => {
        const v = makeActive({ exitMs: 100, exitThreshold: 0.02 })
        v.feed(0.02, 100)
        v.feed(0.02, 200)
        // Strict <: 0.02 is NOT below 0.02. Active still.
        expect(v.snapshot()).toBe("active")
    })

    it("resets the dwell when rms climbs back above the exit threshold", () => {
        const v = makeActive({ exitMs: 1500, exitThreshold: 0.02 })
        v.feed(0.01, 100) // start exit dwell
        v.feed(0.03, 800) // climbs above exit threshold — dwell abandoned
        v.feed(0.01, 1000) // restart dwell
        v.feed(0.01, 2499) // 1499ms after restart
        expect(v.snapshot()).toBe("active")
        v.feed(0.01, 2500) // 1500ms after restart — triggers
        expect(v.snapshot()).toBe("silent")
    })

    it("emits a 'transition' callback on active → silent", () => {
        const v = makeActive({ exitMs: 100, exitThreshold: 0.02 })
        const events: string[] = []
        v.onTransition((s) => events.push(s))
        v.feed(0.01, 200)
        v.feed(0.01, 300)
        expect(events).toEqual(["silent"])
    })
})

describe("createVadDetector — hysteresis (no flicker between thresholds)", () => {
    it("does NOT transition when rms hovers between exitThreshold and enterThreshold", () => {
        // Hysteresis band: 0.02–0.05. Hovering at 0.03 should:
        //   - NOT trigger silent→active (not above enterThreshold)
        //   - NOT trigger active→silent (not below exitThreshold) once active
        const v = createVadDetector({
            enterMs: 100,
            enterThreshold: 0.05,
            exitMs: 100,
            exitThreshold: 0.02
        })
        // From silent: hover at 0.03 → never triggers.
        for (let t = 0; t < 5_000; t += 100) v.feed(0.03, t)
        expect(v.snapshot()).toBe("silent")

        // Push into active.
        v.feed(0.1, 5_000)
        v.feed(0.1, 5_100)
        expect(v.snapshot()).toBe("active")

        // Hover at 0.03 — neither side triggers because:
        //   - 0.03 > exitThreshold (0.02) so the exit dwell never starts
        //   - 0.03 < enterThreshold so we're not "more active"
        // After 5s of hovering, state is still active.
        for (let t = 5_100; t < 10_100; t += 100) v.feed(0.03, t)
        expect(v.snapshot()).toBe("active")
    })

    it("never re-fires a transition on rms changes within the same state band", () => {
        const v = createVadDetector({ enterMs: 100, enterThreshold: 0.05 })
        const events: string[] = []
        v.onTransition((s) => events.push(s))
        v.feed(0.1, 0)
        v.feed(0.1, 100)
        // Vary RMS within active band — no new transitions.
        v.feed(0.2, 200)
        v.feed(0.5, 300)
        v.feed(0.1, 400)
        expect(events).toEqual(["active"]) // single transition only
    })
})

describe("createVadDetector — defensive guards", () => {
    it("coerces non-finite RMS to 0 (does not crash, does not propagate NaN)", () => {
        const v = createVadDetector({ initialState: "active", exitMs: 100, exitThreshold: 0.02 })
        expect(() => v.feed(Number.NaN, 0)).not.toThrow()
        expect(() => v.feed(Number.POSITIVE_INFINITY, 100)).not.toThrow()
        expect(() => v.feed(-1, 200)).not.toThrow()
        // NaN coerced to 0, which is < exitThreshold — exit dwell starts.
        v.feed(0, 300)
        v.feed(0, 400)
        // After 100ms of "silence", should fall to silent.
        expect(v.snapshot()).toBe("silent")
    })

    it("a throwing onTransition subscriber does not block other subscribers", () => {
        const v = createVadDetector({ enterMs: 100, enterThreshold: 0.05 })
        const survivor: string[] = []
        v.onTransition(() => {
            throw new Error("bad subscriber")
        })
        v.onTransition((s) => survivor.push(s))
        expect(() => {
            v.feed(0.1, 0)
            v.feed(0.1, 100)
        }).not.toThrow()
        expect(survivor).toEqual(["active"])
    })

    it("uses the injected clock for default nowMs", () => {
        let t = 0
        const v = createVadDetector({ enterMs: 100, enterThreshold: 0.05, now: () => t })
        v.feed(0.1) // injected now = 0
        t = 100
        v.feed(0.1) // injected now = 100 — should trigger
        expect(v.snapshot()).toBe("active")
    })
})

describe("createVadDetector — reset()", () => {
    it("clears in-flight dwell + returns to initial state", () => {
        const v = createVadDetector({ enterMs: 100, enterThreshold: 0.05 })
        v.feed(0.1, 0)
        v.feed(0.1, 100)
        expect(v.snapshot()).toBe("active")
        v.reset()
        expect(v.snapshot()).toBe("silent")
    })

    it("publishes the reset transition to subscribers", () => {
        const v = createVadDetector({ enterMs: 100, enterThreshold: 0.05 })
        const seen: string[] = []
        v.state.subscribe((s) => seen.push(s))
        v.feed(0.1, 0)
        v.feed(0.1, 100)
        v.reset()
        // initial + silent→active + reset→silent.
        expect(seen).toEqual(["silent", "active", "silent"])
    })

    it("is a no-op when already at initial state", () => {
        const v = createVadDetector()
        const seen: string[] = []
        v.state.subscribe((s) => seen.push(s))
        v.reset()
        // Only the initial 'silent' from subscribe — no reset emission.
        expect(seen).toEqual(["silent"])
    })

    it("a fresh detector after reset can re-trigger normally", () => {
        const v = createVadDetector({ enterMs: 100, enterThreshold: 0.05 })
        v.feed(0.1, 0)
        v.feed(0.1, 100)
        v.reset()
        v.feed(0.1, 200)
        v.feed(0.1, 300)
        expect(v.snapshot()).toBe("active")
    })
})

describe("createVadDetector — defaults (AC4)", () => {
    it("DEFAULT_VAD_ENTER_THRESHOLD matches DEFAULT_LYRICUE_SETTINGS.sync.vadEnterThreshold (0.05)", () => {
        expect(DEFAULT_VAD_ENTER_THRESHOLD).toBe(0.05)
    })
    it("DEFAULT_VAD_EXIT_THRESHOLD matches DEFAULT_LYRICUE_SETTINGS.sync.vadExitThreshold (0.02)", () => {
        expect(DEFAULT_VAD_EXIT_THRESHOLD).toBe(0.02)
    })
    it("DEFAULT_VAD_ENTER_MS matches architecture.md §4.6 (300ms)", () => {
        expect(DEFAULT_VAD_ENTER_MS).toBe(300)
    })
    it("DEFAULT_VAD_EXIT_MS matches architecture.md §4.6 (1500ms)", () => {
        expect(DEFAULT_VAD_EXIT_MS).toBe(1500)
    })

    it("a default-constructed detector uses the documented defaults", () => {
        const v = createVadDetector({ now: (() => 0) })
        // Push above enterThreshold for exactly enterMs.
        v.feed(0.1, 0)
        v.feed(0.1, 299)
        expect(v.snapshot()).toBe("silent") // not yet
        v.feed(0.1, 300)
        expect(v.snapshot()).toBe("active") // triggers at default 300ms
    })
})

describe("createVadDetector — realistic worship scenarios", () => {
    /**
     * Worship leader: builds intro (low energy), launches into chorus (high energy),
     * mid-song quiet moment for ~1s, then back to verse. The VAD should:
     *   - go active during the chorus
     *   - HOLD active through the 1s quiet moment (because exitMs=1500ms)
     *   - eventually go silent after the song ends + several seconds of true silence
     */
    it("holds active through brief mid-song quiet moments", () => {
        const v = createVadDetector() // defaults
        let t = 0
        // Build-up: 1 second below threshold.
        for (; t <= 1_000; t += 50) v.feed(0.03, t)
        expect(v.snapshot()).toBe("silent")
        // Chorus kicks in — sustained high energy.
        for (; t <= 5_000; t += 50) v.feed(0.2, t)
        expect(v.snapshot()).toBe("active")
        // 800ms quiet moment — should NOT drop to silent because exitMs=1500ms.
        const quietStart = t
        for (; t <= quietStart + 800; t += 50) v.feed(0.01, t)
        expect(v.snapshot()).toBe("active")
        // Back to chorus.
        for (; t <= 8_000; t += 50) v.feed(0.2, t)
        expect(v.snapshot()).toBe("active")
        // Song ends — 2 seconds of true silence. Should drop to silent.
        for (; t <= 11_000; t += 50) v.feed(0.01, t)
        expect(v.snapshot()).toBe("silent")
    })
})
