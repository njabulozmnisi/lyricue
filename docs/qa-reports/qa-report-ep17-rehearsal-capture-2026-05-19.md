# EP17 Rehearsal Capture QA Report — 2026-05-19
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP17.1 rehearsal capture closure: selected-device renderer capture path, preload IPC boundary, main-process chunked WAV storage under Electron userData, live dual-window regression.
**Environment:** Local macOS dev; `LC_DEPLOYMENT_MODE=sister LC_E2E_MODE=1 LC_VERBOSE=1 LC_CAPTURE_EVIDENCE=1 LC_CAPTURE_OPERATOR_TOOLS=1 LC_CAPTURE_REHEARSAL_CAPTURE=1 LC_USER_DATA_DIR=/tmp/lyricue-rehearsal-capture-qa`.
**Status:** Pass-with-caveats

## Executive summary
EP17 rehearsal capture now has a production-shaped WAV path instead of a preview-only meter. The operator renderer captures microphone PCM chunks, the preload exposes a narrow sender-validated IPC bridge, and the main process writes a finalized 16-bit PCM WAV under `<userData>/lyricue/rehearsals/`.

One **MEDIUM** defect surfaced during live QA and was fixed in-pass. No **CRITICAL** defects surfaced.

## Test environment + persona setup
- PASS — Repo was local `main`; Node/Electron commands used the required `env -i` wrapper.
- PASS — Sister app build emitted main, preload, karaoke renderer, and operator renderer bundles.
- PASS — Live tech-operator persona exercised the Rehearsal panel in the operator window.
- PASS — Isolated userData path avoided mutating the operator’s real app data.
- PASS — Sidecar segmentation remains covered by existing Python tests.
- PASS — Renderer perf harness delivered `1000/1000` frames with `0` drops at `46 fps` against a `30 fps` threshold.
- N/A — DB, SSR/CSR, Redis, MinIO, mail, migrations, and seed/literal drift do not apply to this Electron-local capture path.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP17-CAP-TC1 | Core WAV writer | Developer/operator | Chunks stream to disk without full-recording buffering; stop finalizes RIFF/WAVE header | `rehearsal-capture.test.ts` verifies `RIFF`, `WAVE`, `data`, byte length, and PCM payload | PASS |
| EP17-CAP-TC2 | Main-process storage | Live tech operator | Rehearsal capture writes to `<userData>/lyricue/rehearsals/<timestamp>.wav` | Live Electron run wrote `/tmp/lyricue-rehearsal-capture-qa/lyricue/rehearsals/2026-05-19T01-10-59-278Z.wav` | PASS |
| EP17-CAP-TC3 | WAV readback | Developer/operator | Saved file is valid 48 kHz mono 16-bit PCM WAV | Direct Node readback: `RIFF/WAVE/data`, `sampleRate=48000`, `channels=1`, `dataBytes=9600`, `totalBytes=9644` | PASS |
| EP17-CAP-TC4 | IPC boundary | Developer/operator | Rehearsal start/chunk/stop are only callable from the operator window sender | Main handlers reject unknown senders and are registered through preload-only channels | PASS |
| EP17-CAP-TC5 | Live regression | Congregation + operator | Dual-window E2E still renders and frame path stays healthy | Evidence run completed; diagnostics reported `dropped=0`; renderer perf delivered `1000/1000` frames at `46 fps` | PASS |
| EP17-CAP-TC6 | Renderer selected-device path | Live tech operator | Start uses `navigator.mediaDevices.getUserMedia` with selected device and streams PCM chunks | Code path is wired; automated run used synthetic IPC chunks to avoid macOS microphone permission dependency | PASS-with-caveat |

## Defects surfaced + fixed
D26 — **MEDIUM**  
Symptom: The EP17 operator panel showed Start/Stop, elapsed time, and a synthetic level meter, but did not write a rehearsal WAV file.  
Root cause: `startRehearsalPreview` and `stopRehearsalPreview` in [operator-window-bootstrap.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/apps/sister/src/renderer/operator-window-bootstrap.ts:257) were UI-only preview functions with no renderer audio capture, preload IPC, or main-process storage session.  
Latency: Introduced when EP17 was mounted as an operator preview. Existing UI tests verified controls and summary rendering, not disk persistence.  
Repro steps: Open E2E operator window, click Rehearsal, Start, Stop; no `<userData>/lyricue/rehearsals/*.wav` existed.  
Evidence: Live run with isolated userData wrote a valid WAV at `/tmp/lyricue-rehearsal-capture-qa/lyricue/rehearsals/2026-05-19T01-10-59-278Z.wav`; direct readback confirmed RIFF/WAVE header and `dataBytes=9600`.  
Fix proposal: Replace preview-only rehearsal code with Web Audio PCM chunk capture, preload invoke methods, main-process sender-validated capture handlers, and a reusable core WAV chunk writer.  
Fix status: Fixed locally and verified.

D27 — **LOW**  
Symptom: The first live rehearsal-capture evidence run completed the WAV write, then Electron logged `No handler registered for 'lyricue:operator:rehearsal-discard'` on shutdown.  
Root cause: The renderer’s generic overlay cleanup always invoked `discardRehearsalCapture()` during `beforeunload`, even when no renderer-owned capture session was active and after main had removed IPC handlers.  
Latency: Introduced in the first rehearsal-capture implementation during this pass; no unit test covered Electron shutdown ordering.  
Repro steps: Run the live evidence command with `LC_CAPTURE_REHEARSAL_CAPTURE=1`; quit after capture completion.  
Evidence: First live run logged the missing-handler error after `[capture] evidence run complete; quitting`.  
Fix proposal: Track whether the renderer actually owns an active rehearsal capture session and call discard only in that state.  
Fix status: Fixed locally; second live run exited cleanly.

## Network / data layer observations
- Network: No outbound calls.
- IPC: New channels are `lyricue:operator:rehearsal-start`, `lyricue:operator:rehearsal-chunk`, `lyricue:operator:rehearsal-stop`, and `lyricue:operator:rehearsal-discard`; all main handlers validate `event.sender === operatorWindow.webContents`.
- Data layer: WAV writing is chunked and bounded-memory; the main process owns the canonical file path under `resolveLyriCuePaths(...).rehearsalsDir`.
- Console: Second live run emitted no rehearsal IPC shutdown error and kept karaoke diagnostics healthy with `dropped=0`.

## Cumulative defect tally (if multi-pass)
| Pass | Defects | Critical | High | Medium | Low | Fixed in pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| EP17 operator mount — 2026-05-18 | 0 | 0 | 0 | 0 | 0 | 0 |
| EP17 rehearsal capture — 2026-05-19 | 2 | 0 | 0 | 1 | 1 | 2 |

## Recommendations before production shipping
1. **HIGH:** Run a manual macOS microphone-permission QA pass against a physical input device and confirm file growth while recording for at least 10 minutes.
2. **HIGH:** Wire Stop to `segment_rehearsal` so the Rehearsal Summary is produced from the saved WAV instead of the current setlist-derived placeholder rows.
3. **MEDIUM:** Add an Electron integration test that starts capture with a mocked renderer audio source, writes multiple chunks, stops, and validates the WAV file under isolated userData.
4. **MEDIUM:** Add Settings → Storage cleanup UI for rehearsal WAV files, including per-file delete and age-based sweep.

## Final verdict
EP17.1 is locally ship-ready for the sister walking skeleton’s storage boundary: it now writes chunked WAV rehearsal captures to the correct userData location and survives live dual-window regression. The remaining caveat is production audio verification and post-stop segmentation/review depth, not the WAV persistence path itself.
