import type { OutputAdapterMode } from "./output-adapter.js"

export interface FreeShowCaptionCapabilitySnapshot {
    reachable: boolean
    captions: {
        wordSweep: boolean
    } | null
}

export interface SisterOutputSelectionOptions {
    /**
     * Operator/install opt-in. Caption injection is never selected implicitly because
     * OwnWindowOutputAdapter is the fidelity-preserving sister-mode default.
     */
    preferCaptionInjection?: boolean
    freeShowCaptions?: FreeShowCaptionCapabilitySnapshot | null
}

export type SisterOutputSelection =
    | {
          mode: Extract<OutputAdapterMode, "own-window">
          reason: "default" | "operator-disabled" | "freeshow-unreachable" | "caption-word-sweep-missing"
      }
    | {
          mode: Extract<OutputAdapterMode, "caption-injection">
          reason: "caption-word-sweep-supported"
          wordSweepSupported: true
      }

export function selectSisterOutputAdapter(options: SisterOutputSelectionOptions = {}): SisterOutputSelection {
    if (options.preferCaptionInjection !== true) return { mode: "own-window", reason: options.preferCaptionInjection === false ? "operator-disabled" : "default" }
    const snapshot = options.freeShowCaptions
    if (!snapshot?.reachable) return { mode: "own-window", reason: "freeshow-unreachable" }
    if (snapshot.captions?.wordSweep !== true) return { mode: "own-window", reason: "caption-word-sweep-missing" }
    return { mode: "caption-injection", reason: "caption-word-sweep-supported", wordSweepSupported: true }
}
