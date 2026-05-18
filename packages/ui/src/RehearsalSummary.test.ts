import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import RehearsalSummary from "./RehearsalSummary.svelte"

describe("RehearsalSummary", () => {
    let target: HTMLElement

    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })

    afterEach(() => {
        document.body.removeChild(target)
    })

    it("renders learned/partial/failed statuses and opens review", () => {
        const onReview = vi.fn()
        const segments = [
            { index: 0, title: "Way Maker", status: "matched" as const, confidence: 0.9 },
            { index: 1, title: "Good Grace", status: "review" as const, confidence: 0.2 },
            { index: 2, title: "Unknown", status: "failed" as const }
        ]
        const cmp = new RehearsalSummary({ target, props: { segments, onReview } })

        expect(Array.from(target.querySelectorAll("li")).map((li) => li.getAttribute("data-status"))).toEqual([
            "learned",
            "partial",
            "failed"
        ])
        ;(target.querySelector("button") as HTMLButtonElement).click()
        expect(onReview).toHaveBeenCalledWith(segments[0])
        cmp.$destroy()
    })
})
