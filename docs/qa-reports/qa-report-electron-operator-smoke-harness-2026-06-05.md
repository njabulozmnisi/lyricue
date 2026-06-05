# Electron Operator Smoke Harness QA Report — 2026-06-05

**QA persona:** Senior QA analyst — Electron dual-window smoke + IPC + visual evidence + local gate verification
**Scope:** Gate A Electron smoke coverage for sister-mode operator hydration, command IPC, Learn Song wizard, persistence, and rehearsal capture.
**Environment:** Local dev, macOS arm64, Node 25 via isolated shell wrapper, `LC_E2E_MODE=1`, `LC_CAPTURE_EVIDENCE=1`, `LC_SMOKE_TEST=1`, isolated `LC_USER_DATA_DIR`.
**Status:** Pass

## Executive summary

The Electron smoke harness now has a real pass/fail mode. It exercises the dual-window app through the production BrowserWindow and preload paths, captures evidence screenshots, drives operator tools, completes the Learn Song wizard, verifies persistence IPC, records a synthetic rehearsal WAV, invokes sidecar segmentation, and approves the matched rehearsal segment. No smoke defects were surfaced.

The harness is intentionally local and deterministic; real microphone and packaged-installer smoke remain release gates.

## Test environment + persona setup

- Local repository: pass, branch `main`.
- Node/Electron shell isolation: pass, launch used the documented `env -i` wrapper.
- User data isolation: pass, smoke ran against `.tmp/smoke-user-data` and the directory was removed afterward.
- Persona: operator running sister-mode E2E with synthetic 120 BPM audio.
- IPC sender validation: pass, smoke exercised renderer calls through the operator preload bridge; no rejected authorized sender calls occurred.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| TC-EL-SM-001 | Dual-window hydration | Operator | Karaoke and operator BrowserWindows render and receive initial state. | Four karaoke/operator evidence capture rounds completed. | Pass |
| TC-EL-SM-002 | Frame delivery | Operator | Real SyncEngine frames reach the karaoke output with no dropped-frame failure. | Smoke logs showed frame delivery at about 57-58 fps and `dropped=0`. | Pass |
| TC-EL-SM-003 | Operator tools | Operator | Arrangement, translation, and rehearsal overlays open without console or DOM failures. | Evidence screenshots `05`, `06`, and `07` were captured. | Pass |
| TC-EL-SM-004 | Learn Song wizard | Operator | Wizard can open, accept lyrics, progress through manual preview, and finish. | Smoke result `learn-song-complete`. | Pass |
| TC-EL-SM-005 | Persistence IPC | Operator | Arrangement and translation saves travel through operator command IPC and reload active state. | Smoke result `persisted`; main logged `saveArrangement` and `saveTranslation`. | Pass |
| TC-EL-SM-006 | Rehearsal capture | Operator | Synthetic WAV capture stops, sidecar segmentation runs, and matched segment approval succeeds. | Smoke result `captured-approved`; sidecar returned `segments_ready`. | Pass |
| TC-EL-SM-007 | Smoke failure semantics | Developer/operator | Any failed smoke step sets nonzero exit status. | `LC_SMOKE_TEST=1` finished with `[smoke] complete: pass`. | Pass |

## Defects surfaced + fixed

None.

## Network / data layer observations

- No outbound network calls are required for the smoke run.
- Rehearsal capture wrote a 192000-byte WAV to isolated user data, then sidecar decoded it and returned one matched segment.
- The smoke run created and cleaned isolated local project, arrangement, timing-map, and rehearsal files under `.tmp/smoke-user-data`.
- Updated evidence screenshots are under `docs/qa-reports/evidence/ep09-e2e-2026-05-15/` and `docs/qa-reports/evidence/ep10-operator-window-2026-05-15/`.

## Cumulative defect tally

| Pass | Critical | High | Medium | Low | Info |
| --- | ---: | ---: | ---: | ---: | ---: |
| Electron operator smoke harness — 2026-06-05 | 0 | 0 | 0 | 0 | 0 |

## Recommendations before production shipping

1. **HIGH:** Add packaged-app smoke using the same `LC_SMOKE_TEST=1` path once installer builds are available.
2. **HIGH:** Run the rehearsal portion with a real microphone and multi-song capture before pilot deployment.
3. **MEDIUM:** Move the smoke launch into CI on macOS once Electron can run in the CI environment with a display server.

## Final verdict

The local Electron operator smoke harness is now a real release gate for Gate A. It proved the current dual-window sister-mode app beyond unit correctness by exercising the actual renderer, preload, main-process IPC, sidecar segmentation, and evidence capture path end to end.
