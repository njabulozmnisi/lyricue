import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEMO_TIMING_MAP } from "@lyricue/core/output/test-utils"
import RehearsalReviewPanel from "./RehearsalReviewPanel.svelte"

describe("RehearsalReviewPanel", () => {
    let target: HTMLElement

    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })

    afterEach(() => {
        document.body.removeChild(target)
    })

    it("approves a reviewed segment with skipped word keys", async () => {
        const onApprove = vi.fn()
        const cmp = new RehearsalReviewPanel({
            target,
            props: {
                timingMap: DEMO_TIMING_MAP,
                segment: {
                    index: 0,
                    showId: DEMO_TIMING_MAP.showId,
                    title: "Walking-Skeleton Demo",
                    status: "matched",
                    confidence: 0.5,
                    startSec: 0,
                    endSec: 3
                },
                onApprove,
                onCancel: vi.fn()
            }
        })

        const checkboxes = target.querySelectorAll("input[type='checkbox']")
        ;(checkboxes[1] as HTMLInputElement).checked = false
        ;(checkboxes[1] as HTMLInputElement).dispatchEvent(new Event("change"))
        await Promise.resolve()
        ;(Array.from(target.querySelectorAll("button")).find((button) => button.textContent?.includes("Approve")) as HTMLButtonElement).click()

        expect(onApprove).toHaveBeenCalledWith({
            segment: expect.objectContaining({ showId: DEMO_TIMING_MAP.showId }),
            skippedWordKeys: ["demo-1:1"]
        })
        cmp.$destroy()
    })

    it("disables approval for unmatched segments", () => {
        const cmp = new RehearsalReviewPanel({
            target,
            props: {
                timingMap: DEMO_TIMING_MAP,
                segment: { index: 0, showId: null, status: "review" },
                onApprove: vi.fn(),
                onCancel: vi.fn()
            }
        })

        const approve = Array.from(target.querySelectorAll("button")).find((button) => button.textContent?.includes("Approve")) as HTMLButtonElement
        expect(approve.disabled).toBe(true)
        cmp.$destroy()
    })
})
