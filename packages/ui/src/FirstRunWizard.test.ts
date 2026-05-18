import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import FirstRunWizard from "./FirstRunWizard.svelte"

function buttonByText(target: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(target.querySelectorAll("button")).find((item) => item.textContent?.includes(text))
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`)
    return button
}

function inputValue(element: Element | null, value: string): void {
    if (!(element instanceof HTMLInputElement)) throw new Error("Expected input")
    element.value = value
    element.dispatchEvent(new Event("input", { bubbles: true }))
}

async function settle(): Promise<void> {
    await Promise.resolve()
}

async function waitForText(target: HTMLElement, text: string): Promise<void> {
    for (let i = 0; i < 10; i += 1) {
        if (target.textContent?.includes(text)) return
        await settle()
    }
    throw new Error(`Text not found: ${text}`)
}

describe("FirstRunWizard EP15 identity and credential flow", () => {
    let target: HTMLElement

    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })

    afterEach(() => {
        document.body.removeChild(target)
    })

    it("uses catalog org and campuses from the library connect callback", async () => {
        const onComplete = vi.fn()
        const cmp = new FirstRunWizard({
            target,
            props: {
                onComplete,
                onLibraryConnect: vi.fn(async () => ({
                    orgId: "hillside",
                    orgName: "Hillside Church",
                    campuses: [
                        { id: "central", name: "Central" },
                        { id: "pretoria-north", name: "Pretoria North" }
                    ]
                }))
            }
        })

        buttonByText(target, "Get started").click()
        await settle()
        buttonByText(target, "Next").click()
        await settle()
        inputValue(target.querySelector('input[type="url"]'), "https://library.example.org")
        await settle()
        buttonByText(target, "Connect & continue").click()
        await settle()
        await settle()

        expect(target.textContent).toContain("Detected organisation")
        const campus = target.querySelector('select[aria-label="Campus"]') as HTMLSelectElement
        expect(Array.from(campus.options).map((option) => option.value)).toEqual(["central", "pretoria-north", ""])
        cmp.$destroy()
    })

    it("records accepted credential key ids in the completed draft", async () => {
        const onComplete = vi.fn()
        const cmp = new FirstRunWizard({
            target,
            props: {
                onComplete,
                onCredentialTest: vi.fn(async () => ({ ok: true, keyId: "central-1" }))
            }
        })

        buttonByText(target, "Get started").click()
        await settle()
        buttonByText(target, "Next").click()
        await settle()
        buttonByText(target, "Continue").click()
        await settle()
        buttonByText(target, "Next").click()
        await settle()
        inputValue(target.querySelector('input[type="password"]'), "credential-secret")
        await settle()
        buttonByText(target, "Test").click()
        await waitForText(target, "Credential accepted")
        buttonByText(target, "Finish").click()

        expect(onComplete).toHaveBeenCalledOnce()
        expect(onComplete.mock.calls[0]?.[0]).toMatchObject({
            publishCredentialEntered: true,
            publishCredentialKeyId: "central-1"
        })
        expect(target.textContent).toContain("Credential accepted")
        cmp.$destroy()
    })
})
