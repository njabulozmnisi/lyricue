// LyriCue sister-mode Electron main entry.
// Standalone app — does not embed FreeShow; drives FreeShow externally via its public APIs.
//
// This file is a stub. Real entry-point logic lands in:
//   - EP-02 STORY-02.3 (OwnWindowOutputAdapter scaffold)
//   - EP-01 STORY-01.5 (first-run wizard integration)
//   - EP-04 STORY-04.3 (SidecarController boot)

import { DEPLOYMENT_MODE } from "@lyricue/core/types"

if (DEPLOYMENT_MODE !== "sister") {
    // Defensive: if a fork-mode build mistakenly runs this entry, fail fast with a clear message.
    console.error(
        `[lyricue:sister] Refusing to start: LC_DEPLOYMENT_MODE is "${DEPLOYMENT_MODE}", expected "sister". ` +
            `Build with LC_DEPLOYMENT_MODE=sister, or use the fork-mode entry instead.`
    )
    process.exit(1)
}

console.info("[lyricue:sister] Entry point reached. Full app boot lands in EP-02.")
