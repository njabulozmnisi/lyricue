import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import PublishCredentialDialog from "./PublishCredentialDialog.svelte"

async function settle(): Promise<void> {
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await Promise.resolve()
}

function inputValue(input: HTMLInputElement, value: string): void {
    input.value = value
    input.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("PublishCredentialDialog", () => {
    let target: HTMLElement

    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })

    afterEach(() => {
        document.body.removeChild(target)
    })

    it("saves only when label and credential are present", async () => {
        const onSave = vi.fn(async () => undefined)
        const cmp = new PublishCredentialDialog({ target, props: { currentKeyId: null, onSave } })
        const save = target.querySelector(".primary") as HTMLButtonElement
        expect(save.disabled).toBe(true)

        inputValue(target.querySelector('input[aria-label="Credential label"]') as HTMLInputElement, "central-1")
        inputValue(target.querySelector('input[aria-label="Publish credential"]') as HTMLInputElement, "secret")
        await settle()
        expect(save.disabled).toBe(false)
        save.click()
        await settle()
        expect(onSave).toHaveBeenCalledWith({ keyId: "central-1", credential: "secret" })
        expect(target.textContent).toContain("Publish credential saved.")
        cmp.$destroy()
    })

    it("clears an existing credential", async () => {
        const onClear = vi.fn(async () => undefined)
        const cmp = new PublishCredentialDialog({
            target,
            props: { currentKeyId: "central-1", onSave: vi.fn(), onClear }
        })

        ;(target.querySelector(".danger") as HTMLButtonElement).click()
        await settle()
        expect(onClear).toHaveBeenCalledOnce()
        expect(target.textContent).toContain("Publish credential removed.")
        cmp.$destroy()
    })
})
