# EP17 Rehearsal Operator QA Report — 2026-05-18
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** Rehearsal Mode operator mounting, existing sidecar segmentation handler, reusable rehearsal UI components, and live dual-window evidence capture.
**Environment:** Local macOS dev; `LC_DEPLOYMENT_MODE=sister LC_E2E_MODE=1 LC_VERBOSE=1 LC_CAPTURE_EVIDENCE=1 LC_CAPTURE_OPERATOR_TOOLS=1`; no real audio input or external services.
**Status:** Pass-with-caveats

## Executive summary
EP17 is locally verified for the operator surface now: the Rehearsal button opens the real `RehearsalModePanel` in the live sister operator window, and the sidecar already exposes `segment_rehearsal` with deterministic unit coverage. No new **CRITICAL** defects surfaced.

The caveat is material: the live operator panel is still a preview/control surface. Real selected-device WAV capture to `<userData>/lyricue/rehearsals/` and durable storage cleanup remain open.

## Test environment + persona setup
- PASS — Repo was local `main`; Node/Electron commands used the required `env -i` wrapper.
- PASS — Sister app build emitted both karaoke and operator bundles.
- PASS — Live tech operator persona verified by launching the dual-window E2E app and clicking Rehearsal through the operator evidence harness.
- PASS — Python sidecar tests include `segment_rehearsal` splitting and lyric matching.
- N/A — DB, migrations, SSR/CSR, Redis, MinIO, mail, and seed/literal drift do not apply to this Electron-local rehearsal pass.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP17-TC1 | Rehearsal operator entry | Live tech operator | Rehearsal button opens a rehearsal panel, not a no-op placeholder | Screenshot `07-rehearsal-mode-operator.png` shows panel with Ready, meter, elapsed, Start/Stop | PASS |
| EP17-TC2 | Rehearsal UI component | Live tech operator | Start/Stop controls, elapsed time, and level meter render | `RehearsalModePanel.test.ts` passes and live modal renders | PASS |
| EP17-TC3 | Rehearsal summary component | Live tech operator | Segment statuses render learned/partial/failed and can open review | `RehearsalSummary.test.ts` passes | PASS |
| EP17-TC4 | Sidecar segmentation | Developer/operator | `segment_rehearsal` splits active ranges and matches setlist lyrics | `python-sidecar/tests/test_rehearsal.py` passes | PASS |
| EP17-TC5 | Live app regression | Live tech operator | Dual-window E2E still runs with no console errors and dropped frames remain zero | Evidence run completed; diagnostics logged `dropped=0` | PASS |

## Defects surfaced + fixed
No new defects were surfaced in this pass.

Carry-forward caveat: EP17.1 AC2/AC3 are not production-complete because the operator panel does not yet capture real selected-device audio into a chunked WAV file. This is tracked as remaining host/audio integration, not a regression in this pass.

## Network / data layer observations
- Network: No outbound calls.
- Data layer: No persisted files are written by this mounted preview. Existing sidecar segmentation consumes an audio file path when called by host code.
- IPC: Rehearsal panel mounting is renderer-local for now; no new privileged IPC channel was added.
- Console: Live E2E evidence run emitted no operator renderer errors.

## Cumulative defect tally (if multi-pass)
| Pass | Defects | Critical | High | Medium | Low | Fixed in pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| EP17 operator mount — 2026-05-18 | 0 | 0 | 0 | 0 | 0 | 0 |

## Recommendations before production shipping
1. **HIGH:** Wire Rehearsal Mode Start/Stop to the real selected audio device and write chunked WAV files under `<userData>/lyricue/rehearsals/`.
2. **HIGH:** Add an Electron integration test that starts rehearsal capture, verifies file growth, stops, then runs `segment_rehearsal` against the saved file.
3. **MEDIUM:** Add storage cleanup UI for rehearsal files, including per-file delete and age-based sweep.

## Final verdict
EP17 is locally ship-ready as a mounted operator preview plus tested sidecar segmentation foundation. It is not production-complete for FR8 until real audio capture, chunked WAV persistence, and cleanup controls are wired.
