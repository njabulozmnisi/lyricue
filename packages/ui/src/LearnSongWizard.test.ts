import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { SCHEMA_LYRICUE_TIMING_V1, type TimingMap } from "@lyricue/core/types"
import LearnSongWizard from "./LearnSongWizard.svelte"

function click(el: Element | null): void {
    if (!(el instanceof HTMLButtonElement)) throw new Error("Expected button")
    el.click()
}

function input(el: Element | null, value: string): void {
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
        throw new Error("Expected input or textarea")
    }
    el.value = value
    el.dispatchEvent(new Event("input", { bubbles: true }))
}

function select(el: Element | null, value: string): void {
    if (!(el instanceof HTMLSelectElement)) throw new Error("Expected select")
    el.value = value
    el.dispatchEvent(new Event("change", { bubbles: true }))
}

function buttonByText(target: HTMLElement, text: string): HTMLButtonElement {
    const btn = Array.from(target.querySelectorAll("button")).find((b) => b.textContent?.includes(text))
    if (!(btn instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`)
    return btn
}

async function settle(): Promise<void> {
    await Promise.resolve()
}

async function waitForText(target: HTMLElement, text: string): Promise<void> {
    for (let i = 0; i < 10; i++) {
        if (target.textContent?.includes(text)) return
        await settle()
    }
    throw new Error(`Text not found: ${text}`)
}

function timingMap(): TimingMap {
    return {
        $schema: SCHEMA_LYRICUE_TIMING_V1,
        showId: "learned-song",
        learnedFrom: { method: "studio", filename: "song.wav", duration: 2, learnedAt: "2026-05-19T17:00:00.000Z" },
        bpm: 120,
        language: "en",
        sections: [
            {
                id: "v1",
                type: "verse",
                label: "Verse 1",
                slideIndex: 0,
                startMs: 0,
                endMs: 2000,
                words: [
                    { text: "Line", startMs: 0, endMs: 1000, confidence: 0.92, lineIndex: 0 },
                    { text: "one", startMs: 1000, endMs: 2000, confidence: null, lineIndex: 0 }
                ],
                lines: [{ startMs: 0, endMs: 2000, wordStartIndex: 0, wordEndIndex: 2 }]
            }
        ],
        metadata: { schemaVersion: "1", version: "1.0.0", demucsModel: "htdemucs", whisperxModel: "small" }
    }
}

describe("LearnSongWizard", () => {
    let target: HTMLElement

    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })

    afterEach(() => {
        document.body.removeChild(target)
    })

    it("renders the five-step scaffold and gates Next until lyrics parse into sections", async () => {
        const cmp = new LearnSongWizard({ target })
        expect(Array.from(target.querySelectorAll(".steps li")).map((li) => li.textContent)).toEqual([
            "1. Source lyrics",
            "2. Review sections",
            "3. Attach audio",
            "4. Learn",
            "5. Preview"
        ])
        expect(buttonByText(target, "Next").disabled).toBe(true)

        input(target.querySelector(".lyrics-input"), "[Verse 1]\nAmazing grace\n\n[Chorus]\nI once was lost")
        await settle()
        expect(target.textContent).toContain("2 detected sections")
        expect(buttonByText(target, "Next").disabled).toBe(false)
        cmp.$destroy()
    })

    it("shows parsed sections for review and allows label/text edits", async () => {
        const cmp = new LearnSongWizard({ target })
        input(target.querySelector(".lyrics-input"), "[Verse 1]\nLine one\nLine two\n\n[Chorus]\nSing")
        await settle()
        click(buttonByText(target, "Next"))
        await settle()

        const label = target.querySelector(".section-editor input")
        input(label, "Verse A")
        const text = target.querySelector(".section-editor textarea")
        input(text, "Edited line")
        await settle()

        expect(target.querySelector(".section-editor input") instanceof HTMLInputElement).toBe(true)
        expect((target.querySelector(".section-editor input") as HTMLInputElement).value).toBe("Verse A")
        expect((target.querySelector(".section-editor textarea") as HTMLTextAreaElement).value).toBe("Edited line")
        cmp.$destroy()
    })

    it("uses injected lyric search results to populate the source step", async () => {
        const cmp = new LearnSongWizard({
            target,
            props: {
                searchLyrics: vi.fn(async () => [
                    { id: "r1", title: "Way Maker", artist: "Sinach", lyrics: "[Chorus]\nWay maker" }
                ])
            }
        })
        input(target.querySelector('input[aria-label="Lyric search query"]'), "Way Maker")
        await settle()
        click(buttonByText(target, "Search"))
        await waitForText(target, "Way Maker")
        click(buttonByText(target, "Way Maker"))
        await settle()

        expect((target.querySelector(".lyrics-input") as HTMLTextAreaElement).value).toContain("Way maker")
        expect(target.textContent).toContain("1 detected section")
        cmp.$destroy()
    })

    it("requires cancel confirmation when the draft is dirty", async () => {
        const confirmCancel = vi.fn(() => false)
        const onCancel = vi.fn()
        const cmp = new LearnSongWizard({ target, props: { confirmCancel } })
        cmp.$on("cancel", onCancel)
        input(target.querySelector(".lyrics-input"), "[Chorus]\nSing")
        await settle()
        click(buttonByText(target, "Cancel"))
        expect(confirmCancel).toHaveBeenCalledOnce()
        expect(onCancel).not.toHaveBeenCalled()
        cmp.$destroy()
    })

    it("can skip audio, create a manual preview, and emit complete", async () => {
        const onComplete = vi.fn()
        const cmp = new LearnSongWizard({ target })
        cmp.$on("complete", onComplete)

        input(target.querySelector(".lyrics-input"), "[Verse 1]\nLine one\n\n[Chorus]\nLine two")
        await settle()
        click(buttonByText(target, "Next"))
        await settle()
        click(buttonByText(target, "Next"))
        await settle()
        click(buttonByText(target, "Skip audio"))
        await settle()
        click(buttonByText(target, "Create manual preview"))
        await settle()
        await settle()

        expect(target.textContent).toContain("2 sections ready for manual mode")
        click(buttonByText(target, "Finish"))
        expect(onComplete).toHaveBeenCalledOnce()
        cmp.$destroy()
    })

    it("updates the progress label from the injected learning callback", async () => {
        const learnSong = vi.fn(async (_draft, onProgress: (label: string) => void) => {
            onProgress("Decoding and resampling audio")
            await settle()
            onProgress("Assembling timing map")
            return { progressLabel: "Timing map ready for review", timingMap: timingMap() }
        })
        const cmp = new LearnSongWizard({
            target,
            props: {
                initialDraft: {
                    step: "progress",
                    title: "Progress Song",
                    lyricsText: "[Verse 1]\nLine one",
                    sections: [{ id: "v1", type: "verse", label: "Verse 1", text: "Line one", lines: ["Line one"] }],
                    audioFileName: "song.wav",
                    audioFileSize: 1024,
                    audioPath: "/tmp/song.wav"
                },
                learnSong
            }
        })

        click(buttonByText(target, "Start learning"))
        await waitForText(target, "Decoding and resampling audio")
        await waitForText(target, "Assembling timing map")
        await waitForText(target, "Timing map learned and ready for review.")

        expect(learnSong).toHaveBeenCalledOnce()
        cmp.$destroy()
    })

    it("passes production model choices to the learning callback", async () => {
        const learnSong = vi.fn(async (draft) => {
            expect(draft.alignmentMode).toBe("production")
            expect(draft.demucsModel).toBe("mdx_extra")
            expect(draft.whisperxModel).toBe("base")
            return { progressLabel: "Timing map ready", timingMap: timingMap() }
        })
        const cmp = new LearnSongWizard({
            target,
            props: {
                initialDraft: {
                    step: "audio",
                    title: "Production Song",
                    lyricsText: "[Verse 1]\nLine one",
                    sections: [{ id: "v1", type: "verse", label: "Verse 1", text: "Line one", lines: ["Line one"] }],
                    audioFileName: "song.wav",
                    audioFileSize: 1024,
                    audioPath: "/tmp/song.wav"
                },
                learnSong
            }
        })

        select(target.querySelector('select[aria-label="Learning mode"]'), "production")
        await settle()
        select(target.querySelector('select[aria-label="Demucs model"]'), "mdx_extra")
        select(target.querySelector('select[aria-label="WhisperX model"]'), "base")
        await settle()
        click(buttonByText(target, "Next"))
        await settle()
        click(buttonByText(target, "Start learning"))
        await waitForText(target, "Timing map learned and ready for review.")

        expect(learnSong).toHaveBeenCalledOnce()
        cmp.$destroy()
    })

    it("reviews timing maps with editable word boundaries and save callback", async () => {
        const saveTimingMap = vi.fn()
        const onDraftChange = vi.fn()
        const cmp = new LearnSongWizard({
            target,
            props: {
                initialDraft: {
                    step: "preview",
                    title: "Review Song",
                    lyricsText: "[Verse 1]\nLine one",
                    sections: [{ id: "v1", type: "verse", label: "Verse 1", text: "Line one", lines: ["Line one"] }],
                    audioFileName: "song.wav",
                    audioFileSize: 2048,
                    audioPath: "/tmp/song.wav",
                    timingMap: timingMap()
                },
                saveTimingMap
            }
        })
        cmp.$on("draft-change", onDraftChange)

        expect(target.textContent).toContain("Timing map learned and ready for review.")
        expect(target.querySelector('[aria-label="Timing waveform"]')).not.toBeNull()

        const endInputs = Array.from(target.querySelectorAll('input[type="number"]')).filter((input) => (input as HTMLInputElement).value === "1000")
        input(endInputs[0] ?? null, "1250")
        await settle()
        click(buttonByText(target, "Save timing edits"))
        await settle()

        expect(saveTimingMap).toHaveBeenCalledOnce()
        const saved = saveTimingMap.mock.calls[0]?.[0] as TimingMap
        expect(saved.sections[0]?.words[0]?.endMs).toBe(1250)
        expect(saved.sections[0]?.words[1]?.startMs).toBe(1250)
        expect(target.textContent).toContain("Timing edits saved.")
        expect(onDraftChange).toHaveBeenCalled()
        cmp.$destroy()
    })
})
