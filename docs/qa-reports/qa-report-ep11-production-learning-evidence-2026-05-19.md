# EP-11 Production Learning Evidence QA Report — 2026-05-19

**QA persona:** Senior QA analyst — component render + progress-state evidence + local gate verification
**Scope:** EP-11 Learn Song production controls added for Demucs + WhisperX model selection and model-download progress messaging.
**Environment:** Local dev, macOS arm64, Node 25 via isolated shell wrapper, Python sidecar venv.
**Status:** Pass-with-caveats

## Executive summary

The EP-11 production learning UI evidence pass is green at the component and build layers. The Learn Song wizard now has reproducible evidence artifacts for production model controls, first-run model download progress, and cached-model progress. No product defect was surfaced in this pass.

One QA caveat remains: the in-app browser refused `file://` evidence pages under its local URL policy, so visual screenshot capture for these static artifacts could not be completed through that surface.

## Test environment + persona setup

- Local repository: pass, branch `main`, working against the current roadmap branch state.
- Node/Electron shell isolation: pass, all Node commands used the documented `env -i` wrapper.
- Python sidecar environment: pass, `.venv/bin/pytest` completed successfully.
- Browser evidence capture: caveat, local `file://` evidence pages were blocked by browser URL policy before page load.
- Persona: operator using the Learn Song wizard with lyrics, parsed sections, and an attached audio file.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| TC-E11-EV-001 | Production controls snapshot | Operator | Audio step renders production alignment, Demucs model, and WhisperX model controls for an attached audio file. | `01-production-model-controls.html` contains production alignment and both model selectors. | Pass |
| TC-E11-EV-002 | First-run model download progress | Operator | Progress step displays model download status from the host progress event. | `02-model-download-progress.html` renders `Downloading htdemucs-v1 (25%)`. | Pass |
| TC-E11-EV-003 | Cached model progress | Operator | Progress step displays cached-model status when no download is needed. | `03-cached-model-progress.html` renders `Using cached htdemucs-v1`. | Pass |
| TC-E11-EV-004 | Regression tests | Developer/operator | Learn Song wizard and progress-label mapping continue to pass targeted tests. | 13 targeted tests passed. | Pass |
| TC-E11-EV-005 | Full local gate | Developer/operator | TypeScript, Python, Svelte, and sister renderer builds remain clean. | Full gate passed; one existing Vite dependency warning remains. | Pass |

## Defects surfaced + fixed

None.

## Network / data layer observations

- No outbound network calls are required by these evidence tests.
- No DB or persisted project data is touched.
- The evidence generator renders the Svelte component directly into jsdom and writes static HTML under `docs/qa-reports/evidence/ep11-production-learning-ui-2026-05-19/`.
- Browser URL policy blocked `file://` evidence inspection before the app code ran. This is a test-surface limitation, not a LyriCue runtime defect.

## Cumulative defect tally

| Pass | Critical | High | Medium | Low | Info |
| --- | ---: | ---: | ---: | ---: | ---: |
| EP-11 production learning evidence — 2026-05-19 | 0 | 0 | 0 | 0 | 1 |

## Recommendations before production shipping

1. **MEDIUM:** Add an Electron operator-window smoke harness that can drive the Learn Song wizard in the real renderer process, capture screenshots, and inspect console output without relying on local `file://` browser access.
2. **LOW:** Keep the static evidence snapshots for fast regression review; they catch accidental removal of production controls or progress labels before the heavier Electron QA pass runs.

## Final verdict

EP-11 production learning controls are evidence-backed at the component and local gate layers. This slice is ready to commit, with the remaining browser-level screenshot limitation tracked as harness work rather than a product blocker.
