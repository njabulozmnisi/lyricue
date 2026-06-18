# Evidence Output Directory QA Report — 2026-06-18
**QA persona:** Senior QA analyst — smoke harness + evidence hygiene + release artifact traceability
**Scope:** App-side screenshot output routing for `LC_SMOKE_TEST` / `LC_CAPTURE_EVIDENCE` and packaged sister smoke artifact layout.
**Environment:** Local dev; `/Users/njabulomnisi/Projects/Dojo/worshipsync`; focused TypeScript/Vitest; sister renderer build; Electron E2E smoke with temporary `LC_USER_DATA_DIR` and `LC_CAPTURE_EVIDENCE_DIR`.
**Status:** Pass

## Executive summary
Screenshot capture can now write to a pass-specific directory via `LC_CAPTURE_EVIDENCE_DIR`, with karaoke and operator screenshots split under `karaoke/` and `operator/`. The packaged sister smoke script now passes `--output-dir/screenshots` into the app and records that path in its JSON summary.

One **LOW** evidence-hygiene defect was fixed. No product behavior defects were found.

## Test environment + persona setup
- PASS: Branch `main`; starting HEAD `cf41e55`.
- PASS: Focused TypeScript build passed.
- PASS: Focused packaged-smoke-summary tests passed.
- PASS: `npm run build:sister` passed with the existing `svelte-dnd-action` Vite warning.
- PASS: Electron E2E smoke ran with temp user data and `LC_CAPTURE_EVIDENCE_DIR=/tmp/.../screenshots`.
- N/A: No DB, login persona, Cloudflare, GitHub, or physical audio hardware applies to this evidence-routing pass.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| TC-01 | Pass-specific evidence root | QA analyst | App writes screenshots under `LC_CAPTURE_EVIDENCE_DIR` | Smoke wrote files under `/tmp/.../screenshots/karaoke` and `/tmp/.../screenshots/operator` | PASS |
| TC-02 | Historical evidence preservation | QA analyst | Existing dated evidence files are not touched when override is set | `find docs/qa-reports/evidence -newermt ...` returned no files | PASS |
| TC-03 | Packaged smoke artifact routing | Release engineer | Packaged smoke passes its output directory into app screenshots | `smoke-packaged-sister.ts` sets `LC_CAPTURE_EVIDENCE_DIR=<outputDir>/screenshots` and records `screenshotDir` | PASS |
| TC-04 | Existing smoke assertions | Operator | Learn Song, settings bridge, stale payload, rehearsal, and sidecar smoke still pass | Electron smoke ended with `[smoke] complete: pass` | PASS |

## Defects surfaced + fixed
**D-EVID-01 — LOW**

Symptom: Local and packaged smoke runs wrote screenshots into historical evidence directories such as `ep09-e2e-2026-05-15` and `ep10-operator-window-2026-05-15`, forcing later QA slices to restore old screenshots after every run.

Root cause: `captureEp06Evidence()` hardcoded dated evidence directories and had no run-scoped override. The packaged smoke script already accepted `--output-dir` for logs and summary JSON, but did not pass a screenshot directory to the Electron app.

Latency: Present since the original evidence capture helper. It became more visible after the smoke harness started clicking operator tools on every `LC_SMOKE_TEST=1` run.

Repro steps: Run `LC_SMOKE_TEST=1` before this fix and inspect `git status`; historical evidence PNGs are modified.

Evidence: The verification smoke wrote twelve screenshots under `/tmp/.../screenshots` and left `docs/qa-reports/evidence` untouched.

Fix status: Fixed locally with `LC_CAPTURE_EVIDENCE_DIR` and packaged smoke `screenshotDir` propagation.

## Network / data layer observations
- Network: none.
- Data layer: no persisted LyriCue data was mutated; smoke used temporary user data.
- Filesystem boundary: pass-specific evidence writes are opt-in. Existing dated paths remain the default so old report links stay stable.

## Cumulative defect tally (if multi-pass)
| Pass | Defects | CRITICAL | HIGH | MEDIUM | LOW | INFO |
|---|---:|---:|---:|---:|---:|---:|
| Evidence output directory | 1 | 0 | 0 | 0 | 1 | 0 |

## Recommendations before production shipping
1. **MEDIUM:** Use `LC_CAPTURE_EVIDENCE_DIR` for every release-matrix smoke so screenshots, logs, and JSON summaries stay in the same retained artifact.
2. **LOW:** Keep the historical evidence directories as immutable baseline references unless a QA report explicitly refreshes them.

## Final verdict
Ship this evidence-routing increment. Smoke screenshots are now usable as per-run artifacts without dirtying historical QA evidence.
