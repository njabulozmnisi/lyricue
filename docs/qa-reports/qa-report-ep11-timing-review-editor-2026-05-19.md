# EP-11 Timing Review Editor QA Report — 2026-05-19

**QA persona:** Senior QA analyst — component flow + persistence boundary + local gate verification
**Scope:** STORY-11.7 timing preview, waveform boundary editing, reference playback control, and TimingMapStorage save path.
**Environment:** Local dev, macOS arm64, Node 25 via isolated shell wrapper, Python sidecar venv.
**Status:** Pass-with-caveats

## Executive summary

STORY-11.7 now has an operator-facing timing review surface inside the Learn Song preview step. The pass covered waveform rendering, word boundary edits, preview play control, and persistence from renderer to sister-mode main through `TimingMapStorage`. No product defects were found in the automated verification pass.

The caveat is the same as the preceding EP-11 evidence pass: browser screenshot capture for static local evidence remains blocked by the in-app browser URL policy, so this pass relies on Svelte/jsdom assertions, bundle builds, and generated HTML evidence.

## Test environment + persona setup

- Local repository: pass, branch `main`.
- Node/Electron shell isolation: pass, all Node commands used the documented `env -i` wrapper.
- Python sidecar environment: pass, `.venv/bin/pytest` completed successfully.
- Persona: operator reviewing a learned song with a valid timing map after the Learn Song pipeline completes.
- Persistence boundary: pass, renderer sends `saveTimingMap`; main validates and writes through `TimingMapStorage`.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| TC-E11-TR-001 | Timing review render | Operator | Preview step renders a waveform lane for a valid timing map. | `LearnSongWizard.test.ts` finds the `Timing waveform` surface. | Pass |
| TC-E11-TR-002 | Manual boundary edit | Operator | Editing a word end updates that word and the adjacent word start. | Changing first word end to `1250` also moved the next word start to `1250`. | Pass |
| TC-E11-TR-003 | Save timing edits | Operator | Save action emits the updated timing map to the host save callback. | `saveTimingMap` called once with the adjusted map. | Pass |
| TC-E11-TR-004 | Renderer-to-main persistence | Operator | Operator window forwards learned timing maps to main; main validates and persists via TimingMapStorage. | `saveTimingMap` command added in renderer and handled in main with validation and atomic storage. | Pass |
| TC-E11-TR-005 | Regression gate | Developer/operator | TypeScript, Svelte, Python, UI evidence, and sister bundles remain clean. | Full local gate passed; existing Vite dependency warning remains. | Pass |

## Defects surfaced + fixed

None.

## Network / data layer observations

- No outbound network calls are used by the timing review editor.
- Main-process persistence validates incoming timing maps before writing.
- Timing map writes use the existing `TimingMapStorage.save()` path, preserving the atomic-write invariant.
- Browser `file://` inspection remained blocked by test-surface policy before app code ran.

## Cumulative defect tally

| Pass | Critical | High | Medium | Low | Info |
| --- | ---: | ---: | ---: | ---: | ---: |
| EP-11 timing review editor — 2026-05-19 | 0 | 0 | 0 | 0 | 1 |

## Recommendations before production shipping

1. **MEDIUM:** Add an Electron operator-window smoke harness that drives Learn Song through actual file selection, model learning, timing edit, save, reload, and active setlist selection.
2. **LOW:** Replace the current deterministic waveform rendering with decoded audio peaks once the production audio asset stays available after wizard reopen.

## Final verdict

STORY-11.7 is functionally covered for the local MVP: learned timing maps can be reviewed, edited at word boundaries, and persisted through the main-process timing map store. It is acceptable for Gate A, with real-audio waveform fidelity deferred to the Electron smoke harness and asset-retention work.
