import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import TranslationEditor from "./TranslationEditor.svelte"
import { SCHEMA_LYRICUE_TIMING_V1, type TimingMap } from "@lyricue/core/types"

async function settle(): Promise<void> {
    await Promise.resolve()
}

const timingMap: TimingMap = {
    $schema: SCHEMA_LYRICUE_TIMING_V1,
    showId: "show-1",
    learnedFrom: { method: "studio", duration: 20, learnedAt: "2026-05-18T00:00:00Z" },
    bpm: 90,
    language: "en",
    sections: [
        {
            id: "v1",
            type: "verse",
            label: "Verse 1",
            slideIndex: 0,
            startMs: 0,
            endMs: 1000,
            words: [
                { text: "Amazing", startMs: 0, endMs: 500, confidence: 0.9, lineIndex: 0 },
                { text: "grace", startMs: 500, endMs: 1000, confidence: 0.9, lineIndex: 0 }
            ],
            lines: [{ startMs: 0, endMs: 1000, wordStartIndex: 0, wordEndIndex: 2 }]
        }
    ]
}

describe("TranslationEditor", () => {
    let target: HTMLElement

    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })

    afterEach(() => {
        document.body.removeChild(target)
    })

    it("renders original section text next to editable translation text and saves on the map", async () => {
        const onSave = vi.fn()
        const cmp = new TranslationEditor({ target, props: { timingMap, language: "zu-ZA", onSave } })
        expect(target.textContent).toContain("Amazing grace")

        const textarea = target.querySelector('textarea[aria-label="Translation for Verse 1"]') as HTMLTextAreaElement
        textarea.value = "Umusa omangalisayo"
        textarea.dispatchEvent(new Event("input", { bubbles: true }))
        await settle()
        ;(target.querySelector("button") as HTMLButtonElement).click()

        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                parallel: [{ language: "zu-ZA", sections: [{ sectionId: "v1", text: "Umusa omangalisayo" }] }]
            })
        )
        cmp.$destroy()
    })
})
