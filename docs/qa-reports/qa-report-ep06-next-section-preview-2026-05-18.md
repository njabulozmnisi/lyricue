# EP06 Next-Section Preview QA Report — 2026-05-18
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** STORY-06.5 next-section preview in `KaraokeOutput`: lead-time detection from TimingMap word timings, next-section first-line render, settings-driven lead-time suppression, and sister-mode walking skeleton regression.
**Environment:** Local dev on macOS; sister-mode Electron E2E with synthetic 120 BPM audio; Node commands run with the documented `env -i` wrapper.
**Status:** Pass

## Executive summary
STORY-06.5 is now locally implemented and verified. No **CRITICAL** defects surfaced.

The renderer derives the preview from the active section, current SyncFrame word progress, and `display.leadTimeSeconds`; no new IPC channel or SyncEngine event is required.

## Test environment + persona setup
- Pass: `npx tsc -b --pretty false`.
- Pass: `svelte-check` found 0 errors and 0 warnings.
- Pass: `KaraokeOutput.test.ts`: `33 passed`.
- Pass: Sister-mode E2E capture launched dual windows, delivered frames, and reported `dropped=0`.
- Persona: Congregation viewer for preview rendering.
- Persona: Tech operator for settings-driven lead-time behavior.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| TC-01 | Preview inside lead window | Congregation viewer | Last N seconds of a section show the next section label and first line. | Unit test renders `Chorus` and `Then sings my soul` when the cursor enters the default 2s lead window. | Pass |
| TC-02 | Preview before lead window | Tech operator | Preview remains hidden when `leadTimeSeconds` is shorter than remaining section time. | Unit test with `leadTimeSeconds: 0.25` suppresses preview for the same frame. | Pass |
| TC-03 | Walking skeleton regression | Tech operator | Existing dual-window E2E still renders and advances with no dropped frames. | Electron capture completed; diagnostics reported `dropped=0`. | Pass |

## Defects surfaced + fixed
No defects surfaced in this pass.

## Network / data layer observations
- IPC shape is unchanged: preview uses existing `LC_LOAD_MAP` + `LC_SYNC_FRAME` payloads.
- Channel/literal drift does not apply because no new channel was added.
- Data layer, SSR/CSR, seed, migration, and privacy checks do not apply to the renderer-only change.
- The demo TimingMap does not contain a second section in the captured E2E path, so visual preview proof is covered by component-level render tests rather than the current live demo fixture.

## Cumulative defect tally (if multi-pass)
| Pass | Scope | Defects | Critical | Remaining |
|---|---|---:|---:|---:|
| 2026-05-18 | EP06.5 next-section preview | 0 | 0 | 0 |

## Recommendations before production shipping
1. **MEDIUM:** Add an Electron evidence fixture with a two-section TimingMap so the next-section preview is visually captured in the live renderer path.
2. **MEDIUM:** Keep the future Playwright renderer-performance test scoped to include the section-preview DOM path.

## Final verdict
STORY-06.5 is ship-ready for the local walking skeleton. The only caveat is evidence breadth: the current live demo does not exercise a multi-section preview visually, but the renderer behavior is pinned by component tests and the existing E2E path remains clean.
