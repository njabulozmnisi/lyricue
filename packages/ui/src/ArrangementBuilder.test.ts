import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ArrangementBuilder from "./ArrangementBuilder.svelte"
import type { Arrangement, TimingMap, TimingSection, TimingSectionType } from "@lyricue/core/types"
import { SCHEMA_LYRICUE_TIMING_V1 } from "@lyricue/core/types"

async function settle(): Promise<void> {
    await Promise.resolve()
}

function section(id: string, type: TimingSectionType, label: string, slideIndex: number): TimingSection {
    return {
        id,
        type,
        label,
        slideIndex,
        startMs: slideIndex * 1000,
        endMs: slideIndex * 1000 + 1000,
        words: [],
        lines: []
    }
}

const timingMap: TimingMap = {
    $schema: SCHEMA_LYRICUE_TIMING_V1,
    showId: "show-1",
    learnedFrom: { method: "studio", duration: 30, learnedAt: "2026-05-18T00:00:00Z" },
    bpm: 120,
    language: "en",
    metadata: { schemaVersion: "1", version: "1.0.0" },
    sections: [section("verse1", "verse", "Verse 1", 0), section("chorus", "chorus", "Chorus", 1), section("bridge", "bridge", "Bridge", 2)]
}

const arrangement: Arrangement = {
    id: "default",
    name: "Default",
    showId: "show-1",
    isDefault: true,
    sequence: [{ sectionId: "verse1" }],
    createdAt: "2026-05-18T00:00:00Z",
    updatedAt: "2026-05-18T00:00:00Z"
}

const secondTimingMap: TimingMap = {
    ...timingMap,
    showId: "show-2",
    sections: [section("chorus2", "chorus", "Chorus", 0)]
}

describe("ArrangementBuilder", () => {
    let target: HTMLElement

    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })

    afterEach(() => {
        document.body.removeChild(target)
    })

    it("applies shorthand and surfaces unknown tokens", async () => {
        const cmp = new ArrangementBuilder({
            target,
            props: {
                timingMap,
                arrangements: [],
                onSave: vi.fn()
            }
        })

        const name = target.querySelector('input[aria-label="Arrangement name"]') as HTMLInputElement
        name.value = "Sunday"
        name.dispatchEvent(new Event("input", { bubbles: true }))
        const shorthand = target.querySelector('input[aria-label="Arrangement shorthand"]') as HTMLInputElement
        shorthand.value = "V1 Vamp C"
        shorthand.dispatchEvent(new Event("input", { bubbles: true }))
        ;(Array.from(target.querySelectorAll("button")).find((button) => button.textContent === "Apply") as HTMLButtonElement).click()
        await settle()

        expect(target.textContent).toContain("Verse 1")
        expect(target.textContent).toContain("Chorus")
        expect(target.textContent).toContain("Unrecognized: Vamp")
        cmp.$destroy()
    })

    it("edits a sequence and saves the named arrangement", async () => {
        const onSave = vi.fn()
        const cmp = new ArrangementBuilder({
            target,
            props: {
                timingMap,
                arrangements: [],
                onSave
            }
        })

        const name = target.querySelector('input[aria-label="Arrangement name"]') as HTMLInputElement
        name.value = "Sunday"
        name.dispatchEvent(new Event("input", { bubbles: true }))
        ;(target.querySelector('button[title="Verse 1 - slide 1"]') as HTMLButtonElement).click()
        ;(target.querySelector('button[title="Chorus - slide 2"]') as HTMLButtonElement).click()
        await settle()
        ;(target.querySelector('button[title="Duplicate"]') as HTMLButtonElement).click()
        await settle()
        ;(target.querySelector('button[title="Move down"]') as HTMLButtonElement).click()
        await settle()
        ;(target.querySelector('button[title="Remove"]') as HTMLButtonElement).click()
        await settle()
        ;(Array.from(target.querySelectorAll("button")).find((button) => button.textContent === "Save Arrangement") as HTMLButtonElement).click()

        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                id: "sunday",
                name: "Sunday",
                showId: "show-1",
                sequence: [{ sectionId: "verse1" }, { sectionId: "chorus" }]
            })
        )
        cmp.$destroy()
    })

    it("loads and selects an existing arrangement", async () => {
        const onSelectArrangement = vi.fn()
        const cmp = new ArrangementBuilder({
            target,
            props: {
                timingMap,
                arrangements: [arrangement],
                activeArrangementId: "default",
                onSave: vi.fn(),
                onSelectArrangement
            }
        })
        await settle()
        const select = target.querySelector('select[aria-label="Saved arrangement"]') as HTMLSelectElement
        select.value = "default"
        select.dispatchEvent(new Event("change", { bubbles: true }))
        expect(onSelectArrangement).toHaveBeenCalledWith(arrangement)
        expect((target.querySelector('input[aria-label="Arrangement name"]') as HTMLInputElement).value).toBe("Default")
        cmp.$destroy()
    })

    it("refreshes when the selected arrangement object changes without changing id or count", async () => {
        const cmp = new ArrangementBuilder({
            target,
            props: {
                timingMap,
                arrangements: [arrangement],
                activeArrangementId: "default",
                onSave: vi.fn()
            }
        })
        await settle()

        const updatedArrangement: Arrangement = {
            ...arrangement,
            name: "Updated Default",
            sequence: [{ sectionId: "chorus" }]
        }
        cmp.$set({ arrangements: [updatedArrangement] })
        await settle()

        expect((target.querySelector('input[aria-label="Arrangement name"]') as HTMLInputElement).value).toBe("Updated Default")
        expect((target.querySelector(".sequence li span") as HTMLSpanElement).textContent).toBe("Chorus")
        cmp.$destroy()
    })

    it("saves only sections that exist in the active timing map", async () => {
        const onSave = vi.fn()
        const staleArrangement: Arrangement = {
            ...arrangement,
            showId: "show-2",
            sequence: [{ sectionId: "verse1" }, { sectionId: "chorus2" }]
        }
        const cmp = new ArrangementBuilder({
            target,
            props: {
                timingMap: secondTimingMap,
                arrangements: [staleArrangement],
                activeArrangementId: "default",
                onSave
            }
        })
        await settle()

        ;(Array.from(target.querySelectorAll("button")).find((button) => button.textContent === "Save Arrangement") as HTMLButtonElement).click()

        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                showId: "show-2",
                sequence: [{ sectionId: "chorus2" }]
            })
        )
        cmp.$destroy()
    })
})
