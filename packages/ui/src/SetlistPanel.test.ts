import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import SetlistPanel from "./SetlistPanel.svelte"
import type { SetlistSong } from "./SetlistPanel.svelte"

/**
 * STORY-10.2 acceptance tests for the SetlistPanel.
 *
 * AC1 — layout matches the architecture sketch: tested via element presence.
 * AC2 — ≤3 clicks to start sync: tested by exercising the device-pick → song-select →
 *       start-sync sequence and verifying the start-sync event fires.
 * AC3 — per-song icons by sync status: tested via status-icon data attributes.
 * AC4 — click any song to jump: tested via the select-song event dispatcher.
 * AC5 — updates reactively as state changes: tested with $set props.
 */

function makeSongs(): SetlistSong[] {
    return [
        { id: "s1", title: "Way Maker", syncStatus: "learned", bpm: 72 },
        { id: "s2", title: "Good Good Father", syncStatus: "learned", bpm: 68 },
        { id: "s3", title: "Great Are You Lord", syncStatus: "partial", bpm: 71 },
        { id: "s4", title: "Build My Life", syncStatus: "not-learned", bpm: null }
    ]
}

describe("SetlistPanel — layout (AC1)", () => {
    let target: HTMLElement
    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })
    afterEach(() => {
        document.body.removeChild(target)
    })

    it("renders the project title in the header", () => {
        const cmp = new SetlistPanel({
            target,
            props: { projectTitle: "Sunday Morning", setlist: makeSongs() }
        })
        const titleEl = target.querySelector('[data-testid="project-title"]')
        expect(titleEl?.textContent).toContain("Sunday Morning")
        cmp.$destroy()
    })

    it("renders the mode indicator badge", () => {
        const cmp = new SetlistPanel({ target, props: { tier: "auto" } })
        const badge = target.querySelector('[data-testid="mode-indicator-badge"]')
        expect(badge).not.toBeNull()
        expect(badge?.textContent).toContain("AUTO")
        cmp.$destroy()
    })

    it("renders the Learn Song command", () => {
        const cmp = new SetlistPanel({ target })
        expect(target.querySelector('[data-testid="learn-song"]')?.textContent).toContain("Learn Song")
        cmp.$destroy()
    })

    it("renders extended operator action commands", () => {
        const cmp = new SetlistPanel({ target })
        expect(target.querySelector('[data-testid="edit-arrangement"]')?.textContent).toContain("Arrange")
        expect(target.querySelector('[data-testid="translate-song"]')?.textContent).toContain("Translate")
        expect(target.querySelector('[data-testid="publish-song"]')?.textContent).toContain("Publish")
        expect(target.querySelector('[data-testid="toggle-rehearsal"]')?.textContent).toContain("Rehearsal")
        expect(target.querySelector('[data-testid="open-project-source"]')?.textContent).toContain("Setlist")
        expect(target.querySelector('[data-testid="open-settings"]')?.textContent).toContain("Settings")
        cmp.$destroy()
    })

    it("renders the audio device picker", () => {
        const cmp = new SetlistPanel({
            target,
            props: {
                enumerateDevices: async () => [
                    { deviceId: "mic-1", label: "Built-in Mic", kind: "audioinput" as const, groupId: "g1" }
                ]
            }
        })
        expect(target.querySelector('[data-testid="audio-device-picker"]')).not.toBeNull()
        cmp.$destroy()
    })

    it("renders the timing-map source selector", () => {
        const cmp = new SetlistPanel({
            target,
            props: {
                setlist: makeSongs(),
                activeSongId: "s1",
                activeTimingMapVariant: "rehearsal",
                availableTimingMapVariants: ["studio", "rehearsal"]
            }
        })
        const select = target.querySelector('[data-testid="timing-map-source"]') as HTMLSelectElement
        expect(select.value).toBe("rehearsal")
        expect(Array.from(select.options).map((option) => option.value)).toEqual(["studio", "rehearsal"])
        cmp.$destroy()
    })

    it("renders the Start Sync button when sync is not active", () => {
        const cmp = new SetlistPanel({ target, props: { syncActive: false } })
        expect(target.querySelector('[data-testid="start-sync"]')).not.toBeNull()
        cmp.$destroy()
    })

    it("renders the sync-active indicator (and hides Start Sync) when syncActive is true", () => {
        const cmp = new SetlistPanel({ target, props: { syncActive: true } })
        expect(target.querySelector('[data-testid="start-sync"]')).toBeNull()
        expect(target.querySelector('[data-testid="sync-active-indicator"]')).not.toBeNull()
        cmp.$destroy()
    })

    it("renders the Next: row when nextSongTitle is set", () => {
        const cmp = new SetlistPanel({ target, props: { nextSongTitle: "Good Good Father" } })
        const next = target.querySelector('[data-testid="next-row"]')
        expect(next?.textContent).toContain("Good Good Father")
        cmp.$destroy()
    })

    it("hides the Next: row when nextSongTitle is null", () => {
        const cmp = new SetlistPanel({ target, props: { nextSongTitle: null } })
        expect(target.querySelector('[data-testid="next-row"]')).toBeNull()
        cmp.$destroy()
    })

    it("shows empty-list placeholder when the setlist is empty", () => {
        const cmp = new SetlistPanel({ target, props: { setlist: [] } })
        expect(target.querySelector('[data-testid="setlist-empty"]')).not.toBeNull()
        cmp.$destroy()
    })
})

describe("SetlistPanel — per-song sync status icons (AC3)", () => {
    let target: HTMLElement
    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })
    afterEach(() => {
        document.body.removeChild(target)
    })

    it("renders ✓ for learned songs", () => {
        const cmp = new SetlistPanel({
            target,
            props: { setlist: [{ id: "x", title: "T", syncStatus: "learned", bpm: 100 }] }
        })
        const icon = target.querySelector('[data-status="learned"]')
        expect(icon?.textContent?.trim()).toBe("✓")
        cmp.$destroy()
    })

    it("renders ⚠ for partial songs", () => {
        const cmp = new SetlistPanel({
            target,
            props: { setlist: [{ id: "x", title: "T", syncStatus: "partial", bpm: 100 }] }
        })
        const icon = target.querySelector('[data-status="partial"]')
        expect(icon?.textContent?.trim()).toBe("⚠")
        cmp.$destroy()
    })

    it("renders — for not-learned songs and keeps the row selectable for pass-through", () => {
        const cmp = new SetlistPanel({
            target,
            props: { setlist: [{ id: "x", title: "T", syncStatus: "not-learned", bpm: null }] }
        })
        const icon = target.querySelector('[data-status="not-learned"]')
        expect(icon?.textContent?.trim()).toBe("—")
        const btn = target.querySelector('[data-testid="setlist-item-button"]') as HTMLButtonElement
        expect(btn.disabled).toBe(false)
        cmp.$destroy()
    })

    it("shows BPM for learned songs and (partial)/(not learned) for the others", () => {
        const cmp = new SetlistPanel({ target, props: { setlist: makeSongs() } })
        const metas = Array.from(target.querySelectorAll('[data-testid="setlist-item-meta"]')).map((el) =>
            el.textContent?.trim()
        )
        expect(metas[0]).toContain("72 BPM")
        expect(metas[1]).toContain("68 BPM")
        expect(metas[2]).toContain("(partial)")
        expect(metas[3]).toContain("(not learned)")
        cmp.$destroy()
    })

    it("renders the ▶ Now marker on the active song", () => {
        const cmp = new SetlistPanel({
            target,
            props: { setlist: makeSongs(), activeSongId: "s2" }
        })
        const nowMarker = target.querySelector('[data-testid="now-marker"]')
        expect(nowMarker).not.toBeNull()
        // The marker belongs to the s2 row.
        const items = Array.from(target.querySelectorAll('[data-testid="setlist-item"]'))
        const s2 = items.find((el) => el.getAttribute("data-song-id") === "s2")
        expect(s2?.classList.contains("active")).toBe(true)
        cmp.$destroy()
    })
})

describe("SetlistPanel — click any song to jump (AC4)", () => {
    let target: HTMLElement
    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })
    afterEach(() => {
        document.body.removeChild(target)
    })

    it("dispatches select-song with the songId on click", () => {
        const cmp = new SetlistPanel({ target, props: { setlist: makeSongs() } })
        const events: Array<{ songId: string }> = []
        cmp.$on("select-song", (e: any) => events.push(e.detail))
        const items = Array.from(target.querySelectorAll('[data-testid="setlist-item"]'))
        const s2Btn = items.find((el) => el.getAttribute("data-song-id") === "s2")?.querySelector(
            '[data-testid="setlist-item-button"]'
        ) as HTMLButtonElement
        s2Btn.click()
        expect(events).toEqual([{ songId: "s2" }])
        cmp.$destroy()
    })

    it("dispatches select-song for not-learned songs so host can pass through", () => {
        const cmp = new SetlistPanel({ target, props: { setlist: makeSongs() } })
        const events: Array<{ songId: string }> = []
        cmp.$on("select-song", (e: any) => events.push(e.detail))
        const items = Array.from(target.querySelectorAll('[data-testid="setlist-item"]'))
        const s4Btn = items.find((el) => el.getAttribute("data-song-id") === "s4")?.querySelector(
            '[data-testid="setlist-item-button"]'
        ) as HTMLButtonElement
        s4Btn.click()
        expect(events).toEqual([{ songId: "s4" }])
        cmp.$destroy()
    })
})

describe("SetlistPanel — Learn Song command", () => {
    let target: HTMLElement
    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })
    afterEach(() => {
        document.body.removeChild(target)
    })

    it("dispatches learn-song when the command is clicked", () => {
        const cmp = new SetlistPanel({ target })
        const events: void[] = []
        cmp.$on("learn-song", () => events.push(undefined))
        ;(target.querySelector('[data-testid="learn-song"]') as HTMLButtonElement).click()
        expect(events).toHaveLength(1)
        cmp.$destroy()
    })
})

describe("SetlistPanel — extended operator action commands", () => {
    let target: HTMLElement
    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })
    afterEach(() => {
        document.body.removeChild(target)
    })

    it("dispatches edit-arrangement for the active learned song", () => {
        const cmp = new SetlistPanel({
            target,
            props: { setlist: makeSongs(), activeSongId: "s1" }
        })
        const events: Array<{ songId: string }> = []
        cmp.$on("edit-arrangement", (e: any) => events.push(e.detail))
        ;(target.querySelector('[data-testid="edit-arrangement"]') as HTMLButtonElement).click()
        expect(events).toEqual([{ songId: "s1" }])
        cmp.$destroy()
    })

    it("disables edit-arrangement when the active song is not learned", () => {
        const cmp = new SetlistPanel({
            target,
            props: { setlist: makeSongs(), activeSongId: "s4" }
        })
        const btn = target.querySelector('[data-testid="edit-arrangement"]') as HTMLButtonElement
        expect(btn.disabled).toBe(true)
        cmp.$destroy()
    })

    it("dispatches translate-song for the active learned song", () => {
        const cmp = new SetlistPanel({
            target,
            props: { setlist: makeSongs(), activeSongId: "s1" }
        })
        const events: Array<{ songId: string }> = []
        cmp.$on("translate-song", (e: any) => events.push(e.detail))
        ;(target.querySelector('[data-testid="translate-song"]') as HTMLButtonElement).click()
        expect(events).toEqual([{ songId: "s1" }])
        cmp.$destroy()
    })

    it("disables translate-song when the active song is not learned", () => {
        const cmp = new SetlistPanel({
            target,
            props: { setlist: makeSongs(), activeSongId: "s4" }
        })
        const btn = target.querySelector('[data-testid="translate-song"]') as HTMLButtonElement
        expect(btn.disabled).toBe(true)
        cmp.$destroy()
    })

    it("dispatches publish-song for the active song and disables without an active song", async () => {
        const cmp = new SetlistPanel({ target, props: { setlist: makeSongs(), activeSongId: null } })
        const btn = target.querySelector('[data-testid="publish-song"]') as HTMLButtonElement
        expect(btn.disabled).toBe(true)

        const events: Array<{ songId: string }> = []
        cmp.$on("publish-song", (e: any) => events.push(e.detail))
        cmp.$set({ activeSongId: "s2" })
        await Promise.resolve()
        expect(btn.disabled).toBe(false)
        btn.click()
        expect(events).toEqual([{ songId: "s2" }])
        cmp.$destroy()
    })

    it("dispatches toggle-rehearsal when clicked", () => {
        const cmp = new SetlistPanel({ target })
        const events: void[] = []
        cmp.$on("toggle-rehearsal", () => events.push(undefined))
        ;(target.querySelector('[data-testid="toggle-rehearsal"]') as HTMLButtonElement).click()
        expect(events).toHaveLength(1)
        cmp.$destroy()
    })

    it("dispatches select-timing-map-variant when the timing source changes", () => {
        const cmp = new SetlistPanel({
            target,
            props: {
                setlist: makeSongs(),
                activeSongId: "s1",
                availableTimingMapVariants: ["studio", "rehearsal"]
            }
        })
        const events: Array<{ variant: string }> = []
        cmp.$on("select-timing-map-variant", (e: any) => events.push(e.detail))
        const select = target.querySelector('[data-testid="timing-map-source"]') as HTMLSelectElement
        select.value = "rehearsal"
        select.dispatchEvent(new Event("change"))
        expect(events).toEqual([{ variant: "rehearsal" }])
        cmp.$destroy()
    })
})

describe("SetlistPanel — Start Sync gating + dispatch (AC2)", () => {
    let target: HTMLElement
    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })
    afterEach(() => {
        document.body.removeChild(target)
    })

    it("disables Start Sync when no device is selected", () => {
        const cmp = new SetlistPanel({
            target,
            props: { setlist: makeSongs(), activeSongId: "s1", selectedDeviceId: null }
        })
        const btn = target.querySelector('[data-testid="start-sync"]') as HTMLButtonElement
        expect(btn.disabled).toBe(true)
        cmp.$destroy()
    })

    it("disables Start Sync when no song is selected", () => {
        const cmp = new SetlistPanel({
            target,
            props: { setlist: makeSongs(), activeSongId: null, selectedDeviceId: "mic-1" }
        })
        const btn = target.querySelector('[data-testid="start-sync"]') as HTMLButtonElement
        expect(btn.disabled).toBe(true)
        cmp.$destroy()
    })

    it("disables Start Sync when the active song is not learned", () => {
        const cmp = new SetlistPanel({
            target,
            props: { setlist: makeSongs(), activeSongId: "s4", selectedDeviceId: "mic-1" }
        })
        const btn = target.querySelector('[data-testid="start-sync"]') as HTMLButtonElement
        expect(btn.disabled).toBe(true)
        cmp.$destroy()
    })

    it("enables Start Sync when device + learned song are both selected", () => {
        const cmp = new SetlistPanel({
            target,
            props: { setlist: makeSongs(), activeSongId: "s1", selectedDeviceId: "mic-1" }
        })
        const btn = target.querySelector('[data-testid="start-sync"]') as HTMLButtonElement
        expect(btn.disabled).toBe(false)
        cmp.$destroy()
    })

    it("dispatches start-sync on click", () => {
        const cmp = new SetlistPanel({
            target,
            props: { setlist: makeSongs(), activeSongId: "s1", selectedDeviceId: "mic-1" }
        })
        const events: any[] = []
        cmp.$on("start-sync", () => events.push("fired"))
        const btn = target.querySelector('[data-testid="start-sync"]') as HTMLButtonElement
        btn.click()
        expect(events).toEqual(["fired"])
        cmp.$destroy()
    })

    it("the full 3-action sequence emits select-song → change-device → start-sync", async () => {
        const cmp = new SetlistPanel({
            target,
            props: {
                setlist: makeSongs(),
                enumerateDevices: async () => [
                    { deviceId: "mic-1", label: "Built-in Mic", kind: "audioinput" as const, groupId: "g1" }
                ]
            }
        })
        const events: string[] = []
        cmp.$on("change-device", () => events.push("change-device"))
        cmp.$on("select-song", () => events.push("select-song"))
        cmp.$on("start-sync", () => events.push("start-sync"))

        // Action 1: pick a song (s1 — learned).
        const items = Array.from(target.querySelectorAll('[data-testid="setlist-item"]'))
        const s1Btn = items.find((el) => el.getAttribute("data-song-id") === "s1")?.querySelector(
            '[data-testid="setlist-item-button"]'
        ) as HTMLButtonElement
        s1Btn.click()

        // Action 2: the host's typical handler now sets activeSongId. Simulate that:
        cmp.$set({ activeSongId: "s1", selectedDeviceId: "mic-1" })
        await Promise.resolve()

        // Action 3: click Start Sync.
        const startBtn = target.querySelector('[data-testid="start-sync"]') as HTMLButtonElement
        startBtn.click()

        expect(events).toEqual(["select-song", "start-sync"])
        cmp.$destroy()
    })
})

describe("SetlistPanel — reactive updates (AC5)", () => {
    let target: HTMLElement
    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })
    afterEach(() => {
        document.body.removeChild(target)
    })

    it("re-renders when tier changes", async () => {
        const cmp = new SetlistPanel({ target, props: { tier: "auto" } })
        let badge = target.querySelector('[data-testid="mode-indicator-badge"]')
        expect(badge?.textContent).toContain("AUTO")
        cmp.$set({ tier: "timer" })
        await Promise.resolve()
        badge = target.querySelector('[data-testid="mode-indicator-badge"]')
        expect(badge?.textContent).toContain("TIMER")
        cmp.$destroy()
    })

    it("re-renders when activeSongId changes", async () => {
        const cmp = new SetlistPanel({
            target,
            props: { setlist: makeSongs(), activeSongId: "s1" }
        })
        let activeItem = target.querySelector(".setlist-item.active") as HTMLElement
        expect(activeItem?.getAttribute("data-song-id")).toBe("s1")
        cmp.$set({ activeSongId: "s2" })
        await Promise.resolve()
        activeItem = target.querySelector(".setlist-item.active") as HTMLElement
        expect(activeItem?.getAttribute("data-song-id")).toBe("s2")
        cmp.$destroy()
    })

    it("re-renders when setlist changes", async () => {
        const cmp = new SetlistPanel({ target, props: { setlist: makeSongs() } })
        expect(target.querySelectorAll('[data-testid="setlist-item"]')).toHaveLength(4)
        cmp.$set({ setlist: makeSongs().slice(0, 2) })
        await Promise.resolve()
        expect(target.querySelectorAll('[data-testid="setlist-item"]')).toHaveLength(2)
        cmp.$destroy()
    })
})

describe("SetlistPanel — force-tier event bubbling", () => {
    let target: HTMLElement
    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })
    afterEach(() => {
        document.body.removeChild(target)
    })

    it("bubbles force-tier events from the embedded ModeIndicator", async () => {
        const cmp = new SetlistPanel({ target, props: { tier: "auto" } })
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
})
