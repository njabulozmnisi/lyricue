/**
 * Renders LearnSongWizard production-learning states to static HTML evidence.
 *
 * These snapshots are documentation artifacts for QA reports. They exercise the
 * browser-rendered Svelte component without depending on Electron or external audio files.
 */
import { describe, it, beforeEach, afterEach } from "vitest"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import LearnSongWizard, { type LearnSongDraft } from "./LearnSongWizard.svelte"

const EVIDENCE_DIR = resolve(
    __dirname,
    "..",
    "..",
    "..",
    "docs",
    "qa-reports",
    "evidence",
    "ep11-production-learning-ui-2026-05-19"
)
const COMPONENT_SOURCE = readFileSync(resolve(__dirname, "LearnSongWizard.svelte"), "utf8")
const COMPONENT_STYLE = COMPONENT_SOURCE.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? ""

const baseDraft: LearnSongDraft = {
    step: "audio",
    title: "Siyabonga",
    lyricsText: "[Verse 1]\nSiyabonga Nkosi\n\n[Chorus]\nHallelujah amen",
    sections: [
        { id: "verse-1", type: "verse", label: "Verse 1", text: "Siyabonga Nkosi", lines: ["Siyabonga Nkosi"] },
        { id: "chorus", type: "chorus", label: "Chorus", text: "Hallelujah amen", lines: ["Hallelujah amen"] }
    ],
    audioFileName: "siyabonga.wav",
    audioFileSize: 2_400_000,
    audioPath: "/tmp/siyabonga.wav",
    progressLabel: "Ready to learn",
    warnings: [],
    timingMap: null,
    alignmentMode: "production",
    demucsModel: "htdemucs",
    whisperxModel: "small"
}

function writeSnapshot(name: string, draft: LearnSongDraft): void {
    const target = document.createElement("div")
    document.body.appendChild(target)
    const cmp = new LearnSongWizard({
        target,
        props: {
            initialDraft: draft,
            confirmCancel: () => true,
            learnSong: async () => ({ progressLabel: draft.progressLabel })
        }
    })
    if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true })
    writeFileSync(
        resolve(EVIDENCE_DIR, `${name}.html`),
        `<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <title>${name}</title>
    <style>${COMPONENT_STYLE}</style>
</head>
<body style="margin:0;background:#050505;padding:24px;">${target.innerHTML}</body>
</html>`
    )
    cmp.$destroy()
    document.body.removeChild(target)
}

describe("LearnSongWizard production-learning evidence snapshots", () => {
    beforeEach(() => {
        document.head.innerHTML = ""
        document.body.innerHTML = ""
        if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true })
    })
    afterEach(() => {
        document.head.innerHTML = ""
        document.body.innerHTML = ""
    })

    it("renders production model controls on the audio step", () => {
        writeSnapshot("01-production-model-controls", baseDraft)
    })

    it("renders model download progress state", () => {
        writeSnapshot("02-model-download-progress", {
            ...baseDraft,
            step: "progress",
            progressLabel: "Downloading htdemucs-v1 (25%)"
        })
    })

    it("renders cached-model progress state", () => {
        writeSnapshot("03-cached-model-progress", {
            ...baseDraft,
            step: "progress",
            progressLabel: "Using cached htdemucs-v1"
        })
    })
})
