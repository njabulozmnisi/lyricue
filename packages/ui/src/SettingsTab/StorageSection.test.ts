import { describe, expect, it, vi } from "vitest"
import StorageSection from "./StorageSection.svelte"

async function flush(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
}

describe("StorageSection", () => {
    it("lists rehearsal recordings and dispatches delete actions", async () => {
        const target = document.createElement("div")
        const onRefresh = vi.fn()
        const onDelete = vi.fn()
        const onDeleteOlderThan = vi.fn()

        const cmp = new StorageSection({
            target,
            props: {
                recordings: [
                    {
                        fileName: "capture.wav",
                        filePath: "/tmp/capture.wav",
                        sizeBytes: 2048,
                        modifiedAtMs: Date.UTC(2026, 4, 19, 1, 0, 0)
                    }
                ],
                onRefresh,
                onDelete,
                onDeleteOlderThan
            }
        })

        expect(target.textContent).toContain("capture.wav")
        expect(target.textContent).toContain("2.0 KB")

        const buttons = [...target.querySelectorAll("button")]
        buttons.find((button) => button.textContent === "Refresh")?.click()
        await flush()
        expect(onRefresh).toHaveBeenCalledOnce()

        ;[...target.querySelectorAll("button")].find((button) => button.textContent === "Delete")?.click()
        await flush()
        expect(onDelete).toHaveBeenCalledWith("capture.wav")

        ;(target.querySelector('input[type="number"]') as HTMLInputElement).value = "14"
        ;(target.querySelector('input[type="number"]') as HTMLInputElement).dispatchEvent(new Event("input"))
        ;[...target.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Delete older"))?.click()
        await flush()
        expect(onDeleteOlderThan).toHaveBeenCalledWith(14)

        cmp.$destroy()
    })
})
