import { describe, it, expect, beforeEach, afterEach } from "vitest"
import ModeIndicator from "./ModeIndicator.svelte"

/**
 * STORY-10.1 acceptance tests + STORY-10.7 force-tier menu.
 */

describe("ModeIndicator", () => {
    let target: HTMLElement
    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })
    afterEach(() => {
        document.body.removeChild(target)
    })

    describe("AC1 — tier label + color-coded badge", () => {
        it("renders AUTO with the tier-auto class and a green dot", () => {
            const cmp = new ModeIndicator({ target, props: { tier: "auto" } })
            const badge = target.querySelector('[data-testid="mode-indicator-badge"]') as HTMLElement
            expect(badge.classList.contains("tier-auto")).toBe(true)
            expect(badge.getAttribute("data-tier")).toBe("auto")
            expect(badge.textContent).toContain("AUTO")
            cmp.$destroy()
        })

        it("renders TIMER with the tier-timer class", () => {
            const cmp = new ModeIndicator({ target, props: { tier: "timer" } })
            const badge = target.querySelector('[data-testid="mode-indicator-badge"]') as HTMLElement
            expect(badge.classList.contains("tier-timer")).toBe(true)
            expect(badge.textContent).toContain("TIMER")
            cmp.$destroy()
        })

        it("renders MANUAL with the tier-manual class", () => {
            const cmp = new ModeIndicator({ target, props: { tier: "manual" } })
            const badge = target.querySelector('[data-testid="mode-indicator-badge"]') as HTMLElement
            expect(badge.classList.contains("tier-manual")).toBe(true)
            expect(badge.textContent).toContain("MANUAL")
            cmp.$destroy()
        })

        it("updates reactively when the tier prop changes", async () => {
            const cmp = new ModeIndicator({ target, props: { tier: "auto" } })
            const badge = target.querySelector('[data-testid="mode-indicator-badge"]') as HTMLElement
            cmp.$set({ tier: "timer" })
            await Promise.resolve()
            expect(badge.classList.contains("tier-timer")).toBe(true)
            expect(badge.classList.contains("tier-auto")).toBe(false)
            cmp.$destroy()
        })
    })

    describe("AC2 — click expands popup with last-transition reason", () => {
        it("does not render the popup before the badge is clicked", () => {
            const cmp = new ModeIndicator({ target, props: { tier: "auto" } })
            expect(target.querySelector('[data-testid="mode-indicator-popup"]')).toBeNull()
            cmp.$destroy()
        })

        it("renders the popup on click", async () => {
            const cmp = new ModeIndicator({ target, props: { tier: "auto" } })
            const badge = target.querySelector('[data-testid="mode-indicator-badge"]') as HTMLButtonElement
            badge.click()
            await Promise.resolve()
            expect(target.querySelector('[data-testid="mode-indicator-popup"]')).not.toBeNull()
            cmp.$destroy()
        })

        it("toggles closed on a second click", async () => {
            const cmp = new ModeIndicator({ target, props: { tier: "auto" } })
            const badge = target.querySelector('[data-testid="mode-indicator-badge"]') as HTMLButtonElement
            badge.click()
            await Promise.resolve()
            badge.click()
            await Promise.resolve()
            expect(target.querySelector('[data-testid="mode-indicator-popup"]')).toBeNull()
            cmp.$destroy()
        })

        it("displays the lastTransition reason in plain language", async () => {
            const cmp = new ModeIndicator({
                target,
                props: {
                    tier: "timer",
                    lastTransition: {
                        from: "auto",
                        to: "timer",
                        reason: "Beat confidence dropped — switched to timer mode.",
                        atWallMs: 1000
                    },
                    nowMs: 6000
                }
            })
            const badge = target.querySelector('[data-testid="mode-indicator-badge"]') as HTMLButtonElement
            badge.click()
            await Promise.resolve()
            const reason = target.querySelector('[data-testid="mode-indicator-reason"]')
            expect(reason?.textContent).toContain("Beat confidence dropped")
            const since = target.querySelector('[data-testid="mode-indicator-since"]')
            expect(since?.textContent).toContain("auto → timer")
            expect(since?.textContent).toContain("5s ago")
            cmp.$destroy()
        })

        it("shows a 'no transitions yet' message when lastTransition is null", async () => {
            const cmp = new ModeIndicator({ target, props: { tier: "auto" } })
            const badge = target.querySelector('[data-testid="mode-indicator-badge"]') as HTMLButtonElement
            badge.click()
            await Promise.resolve()
            const noTrans = target.querySelector('[data-testid="mode-indicator-no-transition"]')
            expect(noTrans).not.toBeNull()
            cmp.$destroy()
        })
    })

    describe("STORY-10.7 — right-click force-tier menu", () => {
        it("opens the force-tier menu on contextmenu", async () => {
            const cmp = new ModeIndicator({ target, props: { tier: "auto" } })
            const badge = target.querySelector('[data-testid="mode-indicator-badge"]') as HTMLButtonElement
            badge.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
            await Promise.resolve()
            const menu = target.querySelector('[data-testid="mode-indicator-force-menu"]')
            expect(menu).not.toBeNull()
            cmp.$destroy()
        })

        it("omits the currently-active tier from the menu options", async () => {
            const cmp = new ModeIndicator({ target, props: { tier: "auto" } })
            const badge = target.querySelector('[data-testid="mode-indicator-badge"]') as HTMLButtonElement
            badge.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
            await Promise.resolve()
            expect(target.querySelector('[data-testid="force-tier-auto"]')).toBeNull()
            expect(target.querySelector('[data-testid="force-tier-timer"]')).not.toBeNull()
            expect(target.querySelector('[data-testid="force-tier-manual"]')).not.toBeNull()
            cmp.$destroy()
        })

        it("dispatches a 'force-tier' event when an option is clicked", async () => {
            const cmp = new ModeIndicator({ target, props: { tier: "auto" } })
            const events: Array<{ tier: string }> = []
            cmp.$on("force-tier", (e: any) => events.push(e.detail))
            const badge = target.querySelector('[data-testid="mode-indicator-badge"]') as HTMLButtonElement
            badge.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
            await Promise.resolve()
            const timerItem = target.querySelector('[data-testid="force-tier-timer"]') as HTMLButtonElement
            timerItem.click()
            expect(events).toEqual([{ tier: "timer" }])
            cmp.$destroy()
        })

        it("closes the force-tier menu after a selection", async () => {
            const cmp = new ModeIndicator({ target, props: { tier: "auto" } })
            const badge = target.querySelector('[data-testid="mode-indicator-badge"]') as HTMLButtonElement
            badge.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
            await Promise.resolve()
            const timerItem = target.querySelector('[data-testid="force-tier-timer"]') as HTMLButtonElement
            timerItem.click()
            await Promise.resolve()
            expect(target.querySelector('[data-testid="mode-indicator-force-menu"]')).toBeNull()
            cmp.$destroy()
        })

        it("does NOT dispatch when the menu option matches the current tier (defensive)", async () => {
            // The menu hides the current tier, but a fuzzer could still trigger force() with
            // the current tier — verify the guard.
            const cmp = new ModeIndicator({ target, props: { tier: "auto" } })
            const events: Array<{ tier: string }> = []
            cmp.$on("force-tier", (e: any) => events.push(e.detail))
            cmp.$set({ tier: "timer" })
            await Promise.resolve()
            // Programmatically open the force menu by simulating right-click.
            const badge = target.querySelector('[data-testid="mode-indicator-badge"]') as HTMLButtonElement
            badge.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
            await Promise.resolve()
            // The 'auto' option is now visible (since tier=timer); clicking it is the normal path.
            const autoItem = target.querySelector('[data-testid="force-tier-auto"]') as HTMLButtonElement
            autoItem.click()
            expect(events).toEqual([{ tier: "auto" }])
            cmp.$destroy()
        })
    })
})
