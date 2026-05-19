# EP17 Rehearsal Segmentation QA Report — 2026-05-19
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP17 post-capture segmentation: saved rehearsal WAV → sidecar `segment_rehearsal` → operator rehearsal summary.
**Environment:** Local macOS dev; `LC_DEPLOYMENT_MODE=sister LC_E2E_MODE=1 LC_VERBOSE=1 LC_CAPTURE_EVIDENCE=1 LC_CAPTURE_OPERATOR_TOOLS=1 LC_CAPTURE_REHEARSAL_CAPTURE=1 LC_USER_DATA_DIR=/tmp/lyricue-rehearsal-segment-qa`.
**Status:** Pass

## Executive summary
The EP17 stop path now performs real segmentation after WAV capture instead of showing setlist-derived placeholder rows. The live Electron pass saved a 48 kHz mono WAV, invoked the Python sidecar, decoded/resampled it to 16 kHz, and returned one matched rehearsal segment for the active demo setlist.

One **MEDIUM** sidecar defect surfaced during this pass and was fixed. No **CRITICAL** defects surfaced.

## Test environment + persona setup
- PASS — Repo was local `main`; Node/Electron commands used the required `env -i` wrapper.
- PASS — Sister build emitted main, preload, karaoke renderer, and operator renderer bundles.
- PASS — Live tech-operator persona exercised the Rehearsal panel capture/stop path through the operator window bridge.
- PASS — Isolated userData path avoided mutating the operator’s real app data.
- PASS — Sidecar process started from `python-sidecar/.venv/bin/python` and exited cleanly after Electron quit.
- PASS — Renderer perf harness delivered `1000/1000` frames with `0` drops at `52.1 fps` against a `30 fps` threshold.
- N/A — DB, SSR/CSR, Redis, MinIO, mail, migrations, and seed/literal drift do not apply to this Electron-local pass.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP17-SEG-TC1 | Main stop orchestration | Live tech operator | Stop finalizes the WAV and calls `segment_rehearsal` with active setlist lyrics | Live log returned `stage=segments_ready` and one matched segment | PASS |
| EP17-SEG-TC2 | Sidecar zero-crossing tolerance | Developer/operator | Continuous audio with zero crossings remains one segment, not many discarded sub-threshold fragments | `test_segment_rehearsal_tolerates_zero_crossings` passes | PASS |
| EP17-SEG-TC3 | Operator summary hydration | Live tech operator | Renderer normalizes sidecar rows into `RehearsalSummary` statuses | Stop response included `segments:[{ index:0, status:"matched", title:"Walking-Skeleton Demo" }]` | PASS |
| EP17-SEG-TC4 | Live dual-window regression | Congregation + operator | Karaoke output and operator windows remain healthy while sidecar starts and segments | Live run completed with `dropped=0`; sidecar exited cleanly; renderer perf passed at `52.1 fps` | PASS |
| EP17-SEG-TC5 | Regression sweep | Developer/operator | TS, Svelte, Python, and sister build stay green | `tsc -b`, `npm run test:ts`, `svelte-check`, `pytest`, and sister build pass | PASS |

## Defects surfaced + fixed
D28 — **MEDIUM**  
Symptom: The first live segmentation run wrote a valid 2-second WAV and called `segment_rehearsal`, but the sidecar returned `segments: []`.  
Root cause: `_active_ranges` in [rehearsal.py](/Users/njabulomnisi/Projects/Dojo/worshipsync/python-sidecar/lyricue_sidecar/rehearsal.py:86) ended a segment as soon as a single sample dropped below the silence threshold. Periodic audio crosses zero every cycle, so continuous sound was split into fragments shorter than `minSegmentSeconds` and discarded.  
Latency: Introduced with the initial EP17 sidecar segmentation method. Existing tests used flat non-zero fixtures, so they did not exercise real waveform zero crossings.  
Repro steps: Capture or synthesize a continuous sine-wave WAV, then call `segment_rehearsal` with `minSegmentSeconds=1`; pre-fix result was an empty segment list.  
Evidence: First live run returned `segments:[]`; second run returned `segments:[{"index":0,"startSec":0,"endSec":2,"status":"matched","showId":"lyricue-demo-walking-skeleton","title":"Walking-Skeleton Demo","confidence":0.5}]`.  
Fix proposal: Track `last_active` and tolerate short below-threshold gaps via `maxSilenceSeconds` before closing a segment.  
Fix status: Fixed locally and covered by Python test.

## Network / data layer observations
- Network: No outbound calls.
- IPC: Reuses the sender-validated rehearsal start/chunk/stop bridge from the capture pass.
- Data layer: WAV remains under `<userData>/lyricue/rehearsals/`; segmentation reads the saved file and does not mutate timing maps.
- Sidecar: `segment_rehearsal` decoded the saved 48 kHz WAV to 16 kHz and returned deterministic setlist-index matching when no recognized lyrics were supplied.

## Cumulative defect tally (if multi-pass)
| Pass | Defects | Critical | High | Medium | Low | Fixed in pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| EP17 operator mount — 2026-05-18 | 0 | 0 | 0 | 0 | 0 | 0 |
| EP17 rehearsal capture — 2026-05-19 | 2 | 0 | 0 | 1 | 1 | 2 |
| EP17 rehearsal segmentation — 2026-05-19 | 1 | 0 | 0 | 1 | 0 | 1 |

## Recommendations before production shipping
1. **HIGH:** Run a manual physical-microphone rehearsal pass with multiple songs and real silence gaps to validate threshold defaults.
2. **MEDIUM:** Feed recognized text or phrase-match hints into `segment_rehearsal` once the EP08 STT chunk path is available, so matches are lyric-driven instead of index-driven.
3. **MEDIUM:** Replace the current review alert with the EP17.6 timing-review pane and persist approved rehearsal maps as `<showId>.rehearsal.timing.json`.

## Final verdict
EP17 post-capture segmentation is locally ship-ready for the walking skeleton. The app now proves the capture-to-sidecar loop end to end with a real WAV and a matched segment in the operator response. Production depth still depends on physical-input QA, STT hints, and the rehearsal review/promote workflow.
