import { describe, expect, it } from "vitest"
import { selectSisterOutputAdapter } from "./sister-output-selector.js"

describe("selectSisterOutputAdapter", () => {
    it("keeps own-window as the default sister-mode adapter", () => {
        expect(selectSisterOutputAdapter()).toEqual({ mode: "own-window", reason: "default" })
    })

    it("keeps own-window when the operator disables caption injection", () => {
        expect(
            selectSisterOutputAdapter({
                preferCaptionInjection: false,
                freeShowCaptions: { reachable: true, captions: { wordSweep: true } }
            })
        ).toEqual({ mode: "own-window", reason: "operator-disabled" })
    })

    it("keeps own-window when FreeShow is unreachable", () => {
        expect(
            selectSisterOutputAdapter({
                preferCaptionInjection: true,
                freeShowCaptions: { reachable: false, captions: { wordSweep: true } }
            })
        ).toEqual({ mode: "own-window", reason: "freeshow-unreachable" })
    })

    it("keeps own-window when FreeShow captions lack word-sweep support", () => {
        expect(
            selectSisterOutputAdapter({
                preferCaptionInjection: true,
                freeShowCaptions: { reachable: true, captions: { wordSweep: false } }
            })
        ).toEqual({ mode: "own-window", reason: "caption-word-sweep-missing" })
    })

    it("selects caption injection only when word-sweep support is advertised", () => {
        expect(
            selectSisterOutputAdapter({
                preferCaptionInjection: true,
                freeShowCaptions: { reachable: true, captions: { wordSweep: true } }
            })
        ).toEqual({
            mode: "caption-injection",
            reason: "caption-word-sweep-supported",
            wordSweepSupported: true
        })
    })
})
