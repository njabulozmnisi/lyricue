import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import LibraryPublishDialog from "./LibraryPublishDialog.svelte"

const identity = {
    $schema: "lyricue-identity-v1" as const,
    org: { id: "hillside", name: "Hillside Church" },
    campus: { id: "central", name: "Central" },
    user: { isAnonymous: true }
}

function input(element: Element | null, value: string): void {
    if (!(element instanceof HTMLInputElement)) throw new Error("Expected input")
    element.value = value
    element.dispatchEvent(new Event("input", { bubbles: true }))
}

async function settle(): Promise<void> {
    await Promise.resolve()
}

describe("LibraryPublishDialog", () => {
    let target: HTMLElement

    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })

    afterEach(() => {
        document.body.removeChild(target)
    })

    it("disables publish when no credential is configured", () => {
        const cmp = new LibraryPublishDialog({ target, props: { identity, hasCredential: false, onPublish: vi.fn() } })
        expect((target.querySelector("button.primary") as HTMLButtonElement).disabled).toBe(true)
        expect(target.textContent).toContain("No publish credential")
        cmp.$destroy()
    })

    it("emits metadata and shows the returned bundle URL", async () => {
        const onPublish = vi.fn(async () => ({ bundleUrl: "https://cdn.example/song.lcbundle" }))
        const cmp = new LibraryPublishDialog({ target, props: { identity, hasCredential: true, onPublish } })

        input(target.querySelector('input[aria-label="Publish title"]'), "Song One")
        input(target.querySelector('input[aria-label="Publish tags"]'), "fast, opener")
        input(target.querySelector('input[aria-label="Publish attribution"]'), "Central team")
        await settle()
        ;(target.querySelector("button.primary") as HTMLButtonElement).click()
        await settle()
        await settle()

        expect(onPublish).toHaveBeenCalledWith({
            title: "Song One",
            tags: ["fast", "opener"],
            attribution: "Central team",
            target: "central",
            anonymous: true
        })
        expect(target.textContent).toContain("https://cdn.example/song.lcbundle")
        cmp.$destroy()
    })
})
