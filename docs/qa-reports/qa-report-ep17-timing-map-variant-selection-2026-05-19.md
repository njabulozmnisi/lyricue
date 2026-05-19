# EP17 Timing-Map Variant Selection QA Report — 2026-05-19
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP17 rehearsal-derived timing-map variant selection across SetlistController, sister-mode operator IPC, operator renderer state hydration, and SetlistPanel UI.
**Environment:** Local dev on macOS arm64; Electron sister-mode E2E with `LC_DEPLOYMENT_MODE=sister LC_E2E_MODE=1 LC_VERBOSE=1 LC_CAPTURE_EVIDENCE=1 LC_USER_DATA_DIR=/tmp/lyricue-variant-selection-qa`.
**Status:** Pass-with-caveats

## Executive summary
Bottom line: the studio/rehearsal timing-map source path is wired end-to-end and did not surface new defects. No **CRITICAL** or **HIGH** defects were found in this pass.

The caveat is intentional product scope: this pass verifies variant storage/selection and correct fallback behavior. It does not claim rehearsal segmentation produces a word-level replacement map yet; no fake rehearsal map is generated from segment boundaries.

## Test environment + persona setup
- PASS: Repo was on the local implementation branch with a clean tree before edits; `.claude/` ignored.
- PASS: TypeScript composite build completed with the mandatory `env -i` Node wrapper.
- PASS: Electron sister-mode launch completed in E2E mode; karaoke output and operator windows rendered.
- PASS: Operator renderer signalled ready and received a buffered state snapshot.
- PASS: No login/persona setup applies; this is a local Electron operator workflow with no auth boundary.
- PASS: No DB, migrations, Redis, MinIO, mail, or queue services apply to this scope.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| TC-EP17-VAR-01 | Setlist variant state | Live operator | Controller exposes active/available variants and defaults to studio. | `activeTimingMapVariant` defaults to `studio`; available list defaults to `["studio"]` at `packages/core/src/setlist/setlist-controller.ts:81`. | PASS |
| TC-EP17-VAR-02 | Rehearsal variant load | Live operator | Selecting an available rehearsal variant reloads SyncEngine and OutputAdapter with that map. | Unit test loads a rehearsal map and verifies `SyncEngine.loadSong` receives `learnedFrom.method="rehearsal"`. | PASS |
| TC-EP17-VAR-03 | Unavailable variant fallback | Live operator | Selecting rehearsal when no variant exists must not change the active source or reload the song. | Unit test verifies active source remains `studio` and `loadSong` is not called again. | PASS |
| TC-EP17-VAR-04 | Operator IPC command | Live operator | Renderer sends a bounded command; main accepts only `studio` or `rehearsal`. | Command is routed through `selectTimingMapVariant`; invalid values are ignored at `apps/sister/src/main.ts:610`. | PASS |
| TC-EP17-VAR-05 | Operator UI hydration | Live operator | SetlistPanel renders a timing selector and dispatches changes. | Component test verifies render and `select-timing-map-variant` dispatch from `packages/ui/src/SetlistPanel.svelte:235`. | PASS |
| TC-EP17-VAR-06 | Live dual-window smoke | Live operator | E2E launch renders both windows, no crash, frames continue, operator ready state flushes. | Live run delivered frames with `dropped=0`, operator ready logged, evidence capture completed. | PASS |

## Defects surfaced + fixed
No new defects surfaced in this pass.

Confirmed-correct behavior worth pinning:
- **INFO D-EP17-VAR-01:** Variant literal boundary is constrained to `studio | rehearsal` in controller state and UI dispatch. Evidence: `packages/core/src/setlist/setlist-controller.ts:8`, `packages/ui/src/types.ts:10`.
- **INFO D-EP17-VAR-02:** Sister-mode main does not write rehearsal edits into the canonical studio map; `learnedFrom.method === "rehearsal"` persists through `saveVariant`. Evidence: `apps/sister/src/main.ts:767`.

## Network / data layer observations
- IPC/channel drift: PASS. Operator commands still enter through one command channel with sender validation already installed at `apps/sister/src/main.ts:531`; the new command is a bounded `kind` branch.
- Pre-ready buffer behavior: PASS. Live run logged `operator window: renderer signalled ready` and the operator received the state snapshot after the buffered flush path at `apps/sister/src/main.ts:520`.
- Data persistence: PASS for code path. Rehearsal variants are read via `TimingMapStorage.loadVariant` and writes are routed to `saveVariant`; canonical studio maps remain on `save`.
- Console: PASS with caveat. Live Electron logs contained renderer lifecycle/info lines and no runtime errors. Vite emitted the existing `svelte-dnd-action` resolve warning during operator bundle build; it is unrelated to this change.

## Cumulative defect tally (if multi-pass)
| Pass | Scope | New defects | Critical | High | Medium | Low | Info |
|---|---|---:|---:|---:|---:|---:|---:|
| 2026-05-19 | EP17 timing-map variant selection | 0 | 0 | 0 | 0 | 0 | 2 |

## Recommendations before production shipping
1. **MEDIUM:** Add an integration-level operator IPC test that seeds a real rehearsal variant and verifies the renderer selector can switch source without touching the studio map.
2. **MEDIUM:** When the timing-review workflow lands, add a data-layer round-trip test that promotes reviewed rehearsal word timings into the rehearsal variant slot and then reloads the song from that source.
3. **LOW:** Move evidence capture output for ad hoc QA runs into pass-specific folders so historical screenshot artifacts are not overwritten during smoke runs.

## Final verdict
Ship this slice into the walking skeleton. The variant selector is now a real operator-facing path for choosing studio versus rehearsal timing maps, with safe fallback when rehearsal data is absent. The feature remains incomplete at the product level until reviewed rehearsal word timings can be produced and promoted; this pass does not mark that later workflow done.
