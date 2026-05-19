# EP18-EP19 Operator Persistence QA Report — 2026-05-19
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** Operator Arrangement Builder and Translation Editor save paths, `TimingMapStorage` persistence under Electron userData, isolated live E2E write/read verification.
**Environment:** Local macOS dev; `LC_DEPLOYMENT_MODE=sister LC_E2E_MODE=1 LC_VERBOSE=1 LC_CAPTURE_EVIDENCE=1 LC_CAPTURE_OPERATOR_TOOLS=1 LC_CAPTURE_OPERATOR_PERSISTENCE=1 LC_USER_DATA_DIR=/tmp/lyricue-operator-persistence-qa`.
**Status:** Pass

## Executive summary
The prior EP18/EP19 caveat is closed for the sister walking skeleton: arrangement and translation saves no longer live only in process memory. The operator save commands now validate payloads, write through `TimingMapStorage`, and hydrate persisted timing maps/arrangements on startup.

One **MEDIUM** defect was fixed in this pass. No **CRITICAL** defects surfaced.

## Test environment + persona setup
- PASS — Repo was local `main`; Node/Electron commands used the required `env -i` wrapper.
- PASS — Sister app build emitted main/preload/karaoke/operator bundles.
- PASS — Live tech operator persona exercised Arrange and Translate through the operator window.
- PASS — Isolated userData path avoided mutating the operator’s real app data.
- PASS — DB, migrations, SSR/CSR, Redis, MinIO, mail, and seed drift are not in scope for this Electron-local persistence pass.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP18/19-PERSIST-TC1 | Arrangement save | Live tech operator | Saving an arrangement writes `<showId>.arrangements.json` atomically | `/tmp/lyricue-operator-persistence-qa/lyricue/arrangements/demo-show-reprise.arrangements.json` contains `QA Persistence Arrangement` | PASS |
| EP18/19-PERSIST-TC2 | Translation save | Live tech operator | Saving a translation writes updated timing map with `parallel` track | `/tmp/lyricue-operator-persistence-qa/lyricue/timing-maps/demo-show-reprise.timing.json` contains `zu-ZA` text | PASS |
| EP18/19-PERSIST-TC3 | Storage hydration | Live tech operator | Startup loads stored maps/arrangements before E2E/setlist wiring | Main process calls `hydrateDemoStorage()` before mode startup | PASS |
| EP18/19-PERSIST-TC4 | Live regression | Congregation + operator | Dual-window E2E still renders and frame path stays healthy | Evidence run completed; diagnostics reported `dropped=0` | PASS |

## Defects surfaced + fixed
D25 — **MEDIUM**  
Symptom: Arrange/Translate operator modals rendered and sent commands, but saves were process-local only; restarting the app lost edits.  
Root cause: `saveDemoArrangement` and `saveDemoTranslation` updated `DEMO_ARRANGEMENTS` / `DEMO_TIMING_MAPS` maps in [main.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/apps/sister/src/main.ts:621) without calling the existing `TimingMapStorage` persistence APIs.  
Latency: Introduced when EP18/EP19 were mounted into the operator shell. Unit/component tests did not catch it because they verified dispatch and rendering, not disk round-trip.  
Repro steps: Open E2E operator window, save an arrangement or translation, quit, restart; the edits were absent.  
Evidence: Live run with `LC_USER_DATA_DIR=/tmp/lyricue-operator-persistence-qa` wrote `demo-show-reprise.arrangements.json` and `demo-show-reprise.timing.json`; direct Node readback showed the saved arrangement and `zu-ZA` parallel lyric text.  
Fix proposal: Bind a `TimingMapStorage` to Electron userData, hydrate demo maps/arrangements on startup, and save validated arrangement/timing-map payloads through that storage.  
Fix status: Fixed locally and verified by live E2E save/readback.

## Network / data layer observations
- Network: No outbound calls.
- Data layer: `TimingMapStorage` uses `writeFileAtomic`, so arrangement/timing-map saves keep the project’s crash-safe persistence invariant.
- IPC: Existing operator sender validation still gates command delivery; new persistence remains behind `lyricue:operator:command`.
- Console: Live run emitted no operator renderer errors; karaoke diagnostics stayed healthy.

## Cumulative defect tally (if multi-pass)
| Pass | Defects | Critical | High | Medium | Low | Fixed in pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| EP18/19 operator tools — 2026-05-18 | 1 | 0 | 1 | 0 | 0 | 1 |
| EP18/19 operator persistence — 2026-05-19 | 1 | 0 | 0 | 1 | 0 | 1 |

## Recommendations before production shipping
1. **MEDIUM:** Add an automated Electron test that runs the same save/readback path without relying on screenshot capture.
2. **MEDIUM:** Persist active arrangement selection separately from the arrangement list when product requirements require a stable per-service default.
3. **LOW:** Add a UI toast or inline confirmation after successful arrangement/translation saves.

## Final verdict
EP18/EP19 operator persistence is locally ship-ready for the sister walking skeleton. The remaining production caveats are host integration depth, not this save path: FreeShow layout writeback still needs the real REST/fork adapter boundary, and translated-primary word-level highlighting still requires product decisions around per-language timing maps.
