import { describe, it, expect, beforeEach, afterEach } from "vitest"
import TierChangeBanner from "./TierChangeBanner.svelte"

/**
 * STORY-10.7 acceptance tests for the tier-change banner.
 *
 * Uses an injected `scheduleTimeout` mock so we don't depend on real timers — tests
 * run synchronously and deterministically.
 */

interface ManualScheduler {
    scheduleTimeout: (cb: () => void, ms: number) => () => void
    fire(): void
    pending: number
}

function makeManualScheduler(): ManualScheduler {
    const callbacks: (() => void)[] = []
    return {
        scheduleTimeout(cb) {
            callbacks.push(cb)
            return () => {
                const i = callbacks.indexOf(cb)
                if (i >= 0) callbacks.splice(i, 1)
            }
        },
        fire() {
            const queue = callbacks.splice(0, callbacks.length)
            for (const cb of queue) cb()
        },
        get pending() {
            return callbacks.length
        }
    }
}

const SAMPLE_TRANSITION = {
    from: "auto" as const,
    to: "timer" as const,
    reason: "Beat confidence dropped — switched to timer mode.",
    atWallMs: 1000
}

describe("TierChangeBanner", () => {
    let target: HTMLElement

    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })
    afterEach(() => {
        document.body.removeChild(target)
    })

    it("renders nothing when transition is null", () => {
        const cmp = new TierChangeBanner({ target, props: { transition: null } })
        expect(target.querySelector('[data-testid="tier-change-banner"]')).toBeNull()
        expect(target.querySelector('[data-testid="tier-change-icon"]')).toBeNull()
        cmp.$destroy()
    })

    it("renders the expanded banner immediately when transition arrives", () => {
        const scheduler = makeManualScheduler()
        const cmp = new TierChangeBanner({
            target,
            props: {
                transition: SAMPLE_TRANSITION,
                scheduleTimeout: scheduler.scheduleTimeout
            }
        })
        const banner = target.querySelector('[data-testid="tier-change-banner"]')
        expect(banner).not.toBeNull()
        expect(banner?.getAttribute("data-tier-to")).toBe("timer")
        expect(banner?.textContent).toContain("Beat confidence dropped")
        cmp.$destroy()
    })

    it("renders the arrow showing from → to", () => {
        const scheduler = makeManualScheduler()
        const cmp = new TierChangeBanner({
            target,
            props: { transition: SAMPLE_TRANSITION, scheduleTimeout: scheduler.scheduleTimeout }
        })
        const arrow = target.querySelector('[data-testid="tier-change-arrow"]')
        expect(arrow?.textContent).toContain("AUTO → TIMER")
        cmp.$destroy()
    })

    it("AC2 — auto-collapses to the icon after autoCollapseMs", async () => {
        const scheduler = makeManualScheduler()
        const cmp = new TierChangeBanner({
            target,
            props: {
                transition: SAMPLE_TRANSITION,
                autoCollapseMs: 5000,
                scheduleTimeout: scheduler.scheduleTimeout
            }
        })
        expect(target.querySelector('[data-testid="tier-change-banner"]')).not.toBeNull()
        scheduler.fire()
        await Promise.resolve()
        expect(target.querySelector('[data-testid="tier-change-banner"]')).toBeNull()
        expect(target.querySelector('[data-testid="tier-change-icon"]')).not.toBeNull()
        cmp.$destroy()
    })

    it("the collapsed icon re-expands on click", async () => {
        const scheduler = makeManualScheduler()
        const cmp = new TierChangeBanner({
            target,
            props: { transition: SAMPLE_TRANSITION, scheduleTimeout: scheduler.scheduleTimeout }
        })
        scheduler.fire()
        await Promise.resolve()
        const icon = target.querySelector('[data-testid="tier-change-icon"]') as HTMLButtonElement
        icon.click()
        await Promise.resolve()
        expect(target.querySelector('[data-testid="tier-change-banner"]')).not.toBeNull()
        cmp.$destroy()
    })

    it("a new transition resets the collapse timer", async () => {
        const scheduler = makeManualScheduler()
        const cmp = new TierChangeBanner({
            target,
            props: { transition: SAMPLE_TRANSITION, scheduleTimeout: scheduler.scheduleTimeout }
        })
        // Banner expanded; one timer scheduled.
        expect(scheduler.pending).toBe(1)
        // Push a new transition.
        cmp.$set({
            transition: { ...SAMPLE_TRANSITION, to: "manual", atWallMs: 2000 }
        })
        await Promise.resolve()
        // Old timer cancelled, new one scheduled.
        expect(scheduler.pending).toBe(1)
        expect(target.querySelector('[data-testid="tier-change-banner"]')?.getAttribute("data-tier-to")).toBe(
            "manual"
        )
        cmp.$destroy()
    })

    it("dismiss button collapses immediately and emits 'dismiss'", async () => {
        const scheduler = makeManualScheduler()
        const cmp = new TierChangeBanner({
            target,
            props: { transition: SAMPLE_TRANSITION, scheduleTimeout: scheduler.scheduleTimeout }
        })
        const events: number[] = []
        cmp.$on("dismiss", () => events.push(1))
        const dismiss = target.querySelector('[data-testid="tier-change-dismiss"]') as HTMLButtonElement
        dismiss.click()
        await Promise.resolve()
        expect(target.querySelector('[data-testid="tier-change-banner"]')).toBeNull()
        expect(events).toHaveLength(1)
        cmp.$destroy()
    })

    it("setting transition to null after a transition clears both banner and icon", async () => {
        const scheduler = makeManualScheduler()
        const cmp = new TierChangeBanner({
            target,
            props: { transition: SAMPLE_TRANSITION, scheduleTimeout: scheduler.scheduleTimeout }
        })
        cmp.$set({ transition: null })
        await Promise.resolve()
        expect(target.querySelector('[data-testid="tier-change-banner"]')).toBeNull()
        expect(target.querySelector('[data-testid="tier-change-icon"]')).toBeNull()
        cmp.$destroy()
    })

    it("icon carries the destination tier's color class", async () => {
        const scheduler = makeManualScheduler()
        const cmp = new TierChangeBanner({
            target,
            props: {
                transition: { ...SAMPLE_TRANSITION, to: "manual" as const },
                scheduleTimeout: scheduler.scheduleTimeout
            }
        })
        scheduler.fire()
        await Promise.resolve()
        const icon = target.querySelector('[data-testid="tier-change-icon"]') as HTMLButtonElement
        expect(icon.classList.contains("tier-manual")).toBe(true)
        cmp.$destroy()
    })
})
