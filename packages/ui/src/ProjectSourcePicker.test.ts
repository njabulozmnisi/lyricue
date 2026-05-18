import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ProjectSourcePicker from "./ProjectSourcePicker.svelte"

async function settle(): Promise<void> {
    await Promise.resolve()
}

describe("ProjectSourcePicker", () => {
    let target: HTMLElement

    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })

    afterEach(() => {
        document.body.removeChild(target)
    })

    it("selects dated central plans", () => {
        const onSelectCentral = vi.fn()
        const cmp = new ProjectSourcePicker({
            target,
            props: {
                centralProjects: [{ id: "p1", name: "Sunday Morning", date: "2026-05-24", songs: [] }],
                localProjects: [],
                onSelectCentral,
                onSelectLocal: vi.fn(),
                onBuildNew: vi.fn()
            }
        })

        ;(target.querySelector("button") as HTMLButtonElement).click()
        expect(onSelectCentral).toHaveBeenCalledWith({ id: "p1", name: "Sunday Morning", date: "2026-05-24", songs: [] })
        cmp.$destroy()
    })

    it("selects local projects and build-new mode", async () => {
        const onSelectLocal = vi.fn()
        const onBuildNew = vi.fn()
        const cmp = new ProjectSourcePicker({
            target,
            props: {
                centralProjects: [],
                localProjects: [{ id: "local", title: "Local Sunday", shows: [] }],
                onSelectCentral: vi.fn(),
                onSelectLocal,
                onBuildNew
            }
        })

        const radios = Array.from(target.querySelectorAll('input[type="radio"]')) as HTMLInputElement[]
        radios[1]!.click()
        await settle()
        const select = target.querySelector('select[aria-label="Local project"]') as HTMLSelectElement
        select.value = "local"
        select.dispatchEvent(new Event("change", { bubbles: true }))
        expect(onSelectLocal).toHaveBeenCalledWith({ id: "local", title: "Local Sunday", shows: [] })

        radios[2]!.click()
        await settle()
        ;(target.querySelector("button") as HTMLButtonElement).click()
        expect(onBuildNew).toHaveBeenCalledOnce()
        cmp.$destroy()
    })
})
