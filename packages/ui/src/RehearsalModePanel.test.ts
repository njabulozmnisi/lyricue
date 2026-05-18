import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import RehearsalModePanel from "./RehearsalModePanel.svelte"

describe("RehearsalModePanel", () => {
    let target: HTMLElement

    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })

    afterEach(() => {
        document.body.removeChild(target)
    })

    it("shows elapsed time, level, and start/stop controls", () => {
        const onStart = vi.fn()
        const onStop = vi.fn()
        const cmp = new RehearsalModePanel({
            target,
            props: { elapsedMs: 65_000, level: 0.5, recording: false, onStart, onStop }
        })

        expect(target.textContent).toContain("00:01:05")
        ;(target.querySelector("button") as HTMLButtonElement).click()
        expect(onStart).toHaveBeenCalledOnce()
        expect((target.querySelectorAll("button")[1] as HTMLButtonElement).disabled).toBe(true)
        cmp.$destroy()
    })
})
