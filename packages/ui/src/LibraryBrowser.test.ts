import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import LibraryBrowser from "./LibraryBrowser.svelte"
import type { LibraryCatalogEntry } from "@lyricue/core"

const entries: LibraryCatalogEntry[] = [
    { songId: "song-1", title: "Way Maker", bundleVersion: "1.0.0", bundleUrl: "https://cdn/1", sha256: "a" },
    { songId: "song-2", title: "Good Grace", bundleVersion: "2.0.0", bundleUrl: "https://cdn/2", sha256: "b" }
]

function input(element: Element | null, value: string): void {
    if (!(element instanceof HTMLInputElement)) throw new Error("Expected input")
    element.value = value
    element.dispatchEvent(new Event("input", { bubbles: true }))
}

async function settle(): Promise<void> {
    await Promise.resolve()
}

describe("LibraryBrowser", () => {
    let target: HTMLElement

    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })

    afterEach(() => {
        document.body.removeChild(target)
    })

    it("filters catalog entries by title", async () => {
        const cmp = new LibraryBrowser({ target, props: { entries, onDownloadSelected: vi.fn() } })
        input(target.querySelector('input[aria-label="Filter library"]'), "grace")
        await settle()

        expect(target.textContent).not.toContain("Way Maker")
        expect(target.textContent).toContain("Good Grace")
        cmp.$destroy()
    })

    it("downloads selected entries and clears selection on success", async () => {
        const onDownloadSelected = vi.fn(async () => undefined)
        const cmp = new LibraryBrowser({ target, props: { entries, onDownloadSelected } })
        ;(target.querySelector('input[aria-label="Select Way Maker"]') as HTMLInputElement).click()
        await settle()
        ;(target.querySelector("button") as HTMLButtonElement).click()
        await settle()
        await settle()

        expect(onDownloadSelected).toHaveBeenCalledWith([entries[0]])
        expect(target.textContent).toContain("Downloaded 1 bundle.")
        expect((target.querySelector('input[aria-label="Select Way Maker"]') as HTMLInputElement).checked).toBe(false)
        cmp.$destroy()
    })
})
