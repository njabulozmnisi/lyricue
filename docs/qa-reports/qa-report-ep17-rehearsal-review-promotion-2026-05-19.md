# EP17 Rehearsal Review Promotion QA Report — 2026-05-19
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP17.6 rehearsal review and approval path: segmentation result → review pane → skipped-word controls → rehearsal timing-map variant persistence → active rehearsal selection.
**Environment:** Local macOS dev; Electron sister-mode E2E with `LC_DEPLOYMENT_MODE=sister LC_E2E_MODE=1 LC_VERBOSE=1 LC_CAPTURE_EVIDENCE=1 LC_CAPTURE_OPERATOR_TOOLS=1 LC_CAPTURE_REHEARSAL_CAPTURE=1 LC_USER_DATA_DIR=/tmp/lyricue-rehearsal-review-qa`.
**Status:** Pass-with-caveats

## Executive summary
Bottom line: the rehearsal review/promote path now works for a matched segment in the walking skeleton. No **CRITICAL** or **HIGH** defects surfaced in this pass.

The implementation still uses the studio map as the editable baseline and scales it into the reviewed rehearsal segment duration. That is acceptable for the current skeleton, but production-quality review still needs waveform/manual word timing controls from STORY-11.7.

## Test environment + persona setup
- PASS: Local repo compiled with the mandatory isolated Node wrapper.
- PASS: Live tech-operator persona exercised the sister-mode dual-window app.
- PASS: Sidecar started, segmented the synthetic WAV, and exited cleanly.
- PASS: Isolated userData folder avoided mutating the operator's real library.
- N/A: Auth, DB migrations, Redis, MinIO, mail, queues, SSR/CSR, and privacy-boundary checks do not apply to this local Electron flow.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| TC-EP17-REV-01 | Core promotion logic | Developer/operator | Reviewed segment produces a `learnedFrom.method="rehearsal"` timing map with scaled word times. | `rehearsal-review.test.ts` verifies a 6s studio map scales into a 3s rehearsal map. | PASS |
| TC-EP17-REV-02 | Skipped lyrics | Developer/operator | Words marked skipped remain in lyric structure but are unaligned. | Test verifies skipped word `demo-1:1` persists with `confidence: null`. | PASS |
| TC-EP17-REV-03 | Review UI | Live tech operator | Review pane renders words, supports skipped-word toggles, and disables approval for unmatched segments. | `RehearsalReviewPanel.test.ts` covers approve payload and unmatched-segment disablement. | PASS |
| TC-EP17-REV-04 | Renderer → main IPC | Live tech operator | Approval command is bounded and persists only valid matched segments. | Main validates `showId`, finite range, and `endSec > startSec` before writing. | PASS |
| TC-EP17-REV-05 | Data-layer persistence | Live tech operator | Approval writes `<showId>.rehearsal.timing.json`, not the studio map. | Live run wrote `/tmp/lyricue-rehearsal-review-qa/lyricue/timing-maps/lyricue-demo-walking-skeleton.rehearsal.timing.json`. | PASS |
| TC-EP17-REV-06 | End-to-end live path | Live tech operator | Capture → segment → approve → select rehearsal path runs without dropped frames or app errors. | Live log returned `status:"captured-approved"` and diagnostics showed `dropped=0`. | PASS |

## Defects surfaced + fixed
**D-EP17-REV-01 — MEDIUM — Browser bundle pulled Node-only rehearsal code**

Symptom: Operator Vite build failed with Rollup externalization errors for `node:fs/promises` and `node:path`.

Root cause: `RehearsalReviewPanel.svelte` imported `wordReviewKey` from `@lyricue/core/rehearsal`, whose barrel also exports Node-only WAV/storage modules. Vite followed the full barrel into browser code.

Latency: Introduced during this pass; unit tests and `tsc` did not catch it because only the browser bundle observes Rollup's Node externalization boundary.

Repro steps: Run `cd apps/sister && npx vite build --config vite.config.operator.mjs` after importing from `@lyricue/core/rehearsal` in UI.

Evidence: Build failed on `"mkdir" is not exported by "__vite-browser-external"` from `packages/core/dist/rehearsal/rehearsal-capture.js`.

Fix proposal/status: Fixed in this pass by keeping the simple review-key helper local to the browser component and leaving Node-owning rehearsal modules on the main-process side.

## Network / data layer observations
- IPC: PASS. The new `approveRehearsalSegment` command is accepted only through the existing operator command channel and main validates the payload before write.
- Data layer: PASS. Live readback found method `rehearsal`, duration `2`, filename from the WAV, first word scaled to `0..167ms`, and skipped word `world` persisted with `confidence:null`.
- Console: PASS. Live run showed renderer info logs, sidecar clean shutdown, `status:"captured-approved"`, and no runtime errors.
- Performance: PASS. Live diagnostics stayed at `dropped=0` during capture, segmentation, and approval.

## Cumulative defect tally (if multi-pass)
| Pass | Scope | New defects | Critical | High | Medium | Low | Info |
|---|---|---:|---:|---:|---:|---:|---:|
| 2026-05-19 | EP17 rehearsal capture | 2 | 0 | 0 | 1 | 1 | 2 |
| 2026-05-19 | EP17 rehearsal segmentation | 1 | 0 | 0 | 1 | 0 | 1 |
| 2026-05-19 | EP17 timing-map variant selection | 0 | 0 | 0 | 0 | 0 | 2 |
| 2026-05-19 | EP17 rehearsal review promotion | 1 | 0 | 0 | 1 | 0 | 0 |

## Recommendations before production shipping
1. **HIGH:** Replace duration-scaling approval with the full STORY-11.7 waveform/manual word timing editor before claiming production-grade rehearsal learning.
2. **MEDIUM:** Split browser-safe rehearsal helpers from Node-owned capture/storage exports if more UI code needs core rehearsal utilities.
3. **MEDIUM:** Add a live multi-song rehearsal QA pass with physical audio input, real silence gaps, and at least one unmatched segment that must be manually matched before approval.

## Final verdict
Ship this walking-skeleton slice. EP17 now has an end-to-end local path from rehearsal WAV capture through segmentation, review approval, and persistent rehearsal timing-map selection. The remaining caveat is fidelity: the current approval path is a safe, review-gated scaffold over the studio map, not a substitute for the future waveform-level timing editor.
