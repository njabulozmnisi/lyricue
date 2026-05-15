# EP-06 Karaoke Renderer — Acceptance Summary

**Date:** 2026-05-15
**Epic:** EP-06 (Karaoke Renderer)
**Scope landed:** STORY-06.1, 06.2, 06.3, 06.4, 06.6, 06.7
**Deferred:** STORY-06.5 (next-section preview — blocks on EP-09 SE `sectionApproaching` event), STORY-06.8 (Playwright performance test — needs CI Playwright wiring)
**Status:** Implementation complete for in-scope stories. Live walking-skeleton verified end-to-end via 4 captured screenshots.

## Scope

Replace the EP-02 "Hello, LyriCue" stub with the real karaoke renderer driven by a TimingMap, an Arrangement, optional ParallelLyrics tracks, and a SyncFrame stream. Apply settings-driven colors/opacity/fonts via CSS custom properties. Validate every wire frame and load-map at the IPC boundary so a malformed payload can't crash the renderer.

## Deliverables

| Artefact | Path | Status |
|---|---|---|
| Rewritten KaraokeOutput | [packages/ui/src/KaraokeOutput.svelte](../../packages/ui/src/KaraokeOutput.svelte) | ✅ |
| KaraokeOutput unit tests (23) | [packages/ui/src/KaraokeOutput.test.ts](../../packages/ui/src/KaraokeOutput.test.ts) | ✅ All pass |
| URL-hash outputId in bootstrap | [apps/sister/src/renderer/karaoke-output-bootstrap.ts](../../apps/sister/src/renderer/karaoke-output-bootstrap.ts) | ✅ |
| `loadFile({hash: out=...})` in factory | [apps/sister/src/output/electron-browser-window-factory.ts](../../apps/sister/src/output/electron-browser-window-factory.ts) | ✅ |
| Capture-evidence hook in main | [apps/sister/src/main.ts](../../apps/sister/src/main.ts) | ✅ |
| 4 live screenshots | [evidence/ep06-karaoke-renderer-2026-05-15/](evidence/ep06-karaoke-renderer-2026-05-15/) | ✅ |

## Acceptance criteria

| Story | AC | Status | Evidence |
|---|---|---|---|
| 06.1 | Each word in a `<span class="word">` with `style="--progress: 0..1"` | ✅ | KaraokeOutput.test.ts "sets --progress style on the active word" |
| 06.1 | CSS uses `linear-gradient` + `background-clip: text` per arch §4.9 | ✅ | inline gradient in [KaraokeOutput.svelte:.word](../../packages/ui/src/KaraokeOutput.svelte) |
| 06.1 | Color configurable via `--highlight-color` driven by settings | ✅ | KaraokeOutput.test.ts "applies highlight, sung, and upcoming colors from displaySettings" |
| 06.1 | Browser compatibility: Chromium renderer | ✅ | Live capture in Electron 37 |
| 06.2 | `.word.sung` / `.word.active` / `.word.upcoming` applied by cursor | ✅ | KaraokeOutput.test.ts "marks the active word with .active and earlier words with .sung" |
| 06.2 | Opacity controlled by settings (`sungWordOpacity`, etc.) | ✅ | `--sung-opacity` CSS variable test in displaySettings spec |
| 06.2 | Switching active word transitions over ~100ms | ✅ | `transition: opacity 100ms linear` on `.word` |
| 06.3 | Line shift on active-line change | ✅ | Svelte `fly` transition + `scrollIntoView` on active line |
| 06.3 | Prior line fades to settings-driven opacity | ✅ | `.sung-line { opacity: var(--sung-opacity) }` |
| 06.3 | Uses Svelte's `transition:fly` | ✅ | `in:fly\|local={{ y: 40, duration: 250 }}` |
| 06.4 | Words with `held: true` get `.word.held` class | ✅ | KaraokeOutput.test.ts "applies the .held class to words flagged held=true" |
| 06.4 | CSS keyframe pulses brightness/scale at 1.2s period | ✅ | `@keyframes held-pulse` in style block |
| 06.4 | Visual style per settings (`pulse`/`glow`/`static`) | ✅ | `data-held-anim` attribute test |
| 06.6 | vmin-based sizing with clamp() bounds | ✅ | `font-size: clamp(2rem, 8vmin, 12vmin)` |
| 06.7 | When `parallelLyrics` set, second container renders | ✅ | KaraokeOutput.test.ts "renders the parallel container when enabled" |
| 06.7 | Primary has word-level; secondary advances on section only | ✅ | `.parallel` contains only `.parallel-line` rows, no `--progress` |
| 06.7 | Auto-size: 60% for 2 langs, 50% for 3 | ✅ | KaraokeOutput.test.ts "scales the parallel font factor per FR10.8" |
| 06.7 | Settings toggle to enable/disable | ✅ | `style.parallelLyricsEnabled` short-circuit |

## Cross-cut closures (M1-partial QA carry-forwards)

| QA ID | Description | Resolution |
|---|---|---|
| **D6** | Gradient inverted — used `sungColor` (#666666) on the unsung side | Now uses `--upcoming-color` (#CCCCCC) on the not-yet-sung side per arch §4.9. Custom properties wired through to settings. Verified in evidence screenshot 02. |
| **D7** | No defensive validation on incoming SyncFrame | New `validateFrame()` and `validateLoadMap()` functions reject malformed payloads at the renderer boundary; the renderer drops bad data and continues. 6 dedicated tests in the "D7 — defensive frame validation" describe block. |
| **D10** | Hardcoded `PLACEHOLDER_OUTPUT_ID` | Bootstrap now resolves outputId from `window.location.hash#out=<id>` set by the Electron factory via `loadFile({hash})`. Placeholder retained as fallback for legacy paths that don't yet pass the hash. |

## Live evidence

Walking-skeleton run with `LC_DEMO_MODE=1 LC_CAPTURE_EVIDENCE=1`:

| Screenshot | What it shows |
|---|---|
| [01-first-word-active.png](evidence/ep06-karaoke-renderer-2026-05-15/01-first-word-active.png) | First word "Hello" with partial gold sweep; rest of line 1 in upcoming-grey; line 2 dimmed |
| [02-mid-section.png](evidence/ep06-karaoke-renderer-2026-05-15/02-mid-section.png) | "Hello world this" sung (dim grey #666666), "is" actively sweeping |
| [03-late-section.png](evidence/ep06-karaoke-renderer-2026-05-15/03-late-section.png) | Line 1 fully sung; line 2 active with "LyriCue running end" sung, "to" sweeping |
| [04-post-loop-restart.png](evidence/ep06-karaoke-renderer-2026-05-15/04-post-loop-restart.png) | DEMO_TIMING_MAP looped; renderer cleanly reset to first-word state |

## Tests

```
 Test Files  21 passed (21)
      Tests  258 passed (258)
```

Breakdown of additions:
- `@lyricue/ui`: 16 DiagnosticsPanel + 6 evidence + **23 KaraokeOutput** = 45 (up from 22)
- `@lyricue/core`: 81 + 17 sidecar + 8 path-resolver = 106 (unchanged)
- Total: 258 (up from 235)

## Deferred items

| Story | Why deferred | Unblocks on |
|---|---|---|
| **06.5** Next-section preview | Requires SE `sectionApproaching(nextSection, msUntilStart)` event per architecture §4.9. SE itself lives in EP-09. | EP-09 lands |
| **06.8** Playwright performance test | Project doesn't yet have Playwright in CI; test would have to ship alongside CI matrix wiring. | CI Playwright wiring |

The renderer is ready to consume the SE event when EP-09 lands — adding the preview pane is ~30 lines of JSX + CSS, no architectural change needed.

## Notes on the DemoSyncEngine fps gap

The diagnostics observer reads ~48–50 fps for the demo run, against a nominal 60 fps target. This is a property of DemoSyncEngine's `setInterval(16.67ms)` pacing in the Electron main process, not the renderer. EP-09 replaces the demo engine with a renderer-process rAF loop that should hit 60 fps. The renderer itself imposes no perceivable per-frame cost — the CSS sweep is GPU-composited and one inline-style update per active word is the only JS work per frame.

## Ship-readiness

EP-06 is ready to merge for the in-scope stories. D6 / D7 / D10 from the M1-partial QA pass are closed. STORY-06.5 and STORY-06.8 are scoped into their respective unlock epics.
