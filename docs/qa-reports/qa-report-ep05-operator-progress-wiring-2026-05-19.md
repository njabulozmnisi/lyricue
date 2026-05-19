# EP05 Operator Progress Wiring QA Report — 2026-05-19
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP05 operator learn-song progress wiring from Python sidecar progress notifications through SidecarController, Electron main, preload bridge, renderer bootstrap, and LearnSongWizard progress UI.
**Environment:** Local macOS dev, sister-mode Electron code path, Python sidecar `.venv`, Node 25 `env-i` wrapper.
**Status:** Pass

## Executive summary
Operator learn-song progress is now connected end to end at the IPC contract level. No defects were surfaced in this pass.

The UI can update its progress label while `learn_song` is still running, and the bridge unsubscribes after completion/failure to avoid stale listener leaks.

## Test environment + persona setup
- Pass: Repository was on `main` after `3f9470e feat:(#EP-05): emit song learning progress notifications`.
- Pass: Python sidecar tests ran in `.venv`.
- Pass: Node commands used the required clean `env -i` wrapper.
- Pass: No DB, external service, or network-backed account was required.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP05-OPROG-TC-01 | Main-process forwarding | Local operator | `learn_song` progress notifications forward to the operator window on a dedicated channel. | `handleOperatorLearnSong` sends progress params over `lyricue:operator:learn-song-progress`. | Pass |
| EP05-OPROG-TC-02 | Preload subscription | Local operator | Renderer can subscribe/unsubscribe without exposing raw IPC. | Preload exposes `subscribeLearnSongProgress` and returns an unsubscribe function. | Pass |
| EP05-OPROG-TC-03 | Renderer filtering | Local operator | Progress labels update only for the current learn-song job. | Renderer uses generated `jobId` and ignores mismatched progress payloads. | Pass |
| EP05-OPROG-TC-04 | Wizard progress UI | Local operator | Component callback updates progress label before final result. | `LearnSongWizard.test.ts` verified intermediate labels and final preview state. | Pass |
| EP05-OPROG-TC-05 | Sidecar payload identity | Local developer | Python progress payloads include both JSON-RPC `request_id` and learning `jobId`. | `test_learning.py` verified every progress notification includes `jobId="job-progress"`. | Pass |
| EP05-OPROG-TC-06 | Regression sweep | Local developer | Existing local floor stays clean. | `tsc -b` passed, 678/678 TS tests passed, 67/67 Python tests passed, both sister bundles built. | Pass |

## Defects surfaced + fixed
No new defects were surfaced in this pass.

## Network / data layer observations
- No network calls or persistent data writes were required.
- Code-level evidence: main process defines the progress channel in `apps/sister/src/main.ts:139`.
- Code-level evidence: main process forwards SidecarController `onProgress` notifications to the operator window in `apps/sister/src/main.ts:995`.
- Code-level evidence: preload exposes `subscribeLearnSongProgress` with handler isolation and unsubscribe in `apps/sister/src/preload/operator-window-preload.cts:81`.
- Code-level evidence: renderer subscribes during `learnSongFromSidecar`, maps stages to labels, and unsubscribes in `apps/sister/src/renderer/operator-window-bootstrap.ts:631`.
- Code-level evidence: `LearnSongWizard` accepts an injected progress callback and updates `draft.progressLabel` in `packages/ui/src/LearnSongWizard.svelte:42`.
- Code-level evidence: Python `learn_song` progress now includes `jobId`, preserving host filtering across concurrent or stale notifications in `python-sidecar/lyricue_sidecar/learning.py:140`.

## Cumulative defect tally (if multi-pass)
| Pass | New defects | Critical | High | Medium | Low | Current status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| EP05 section auto-detection | 0 | 0 | 0 | 0 | 0 | Pass |
| EP05 production stage contracts | 0 | 0 | 0 | 0 | 0 | Pass-with-caveats |
| EP05 progress notifications | 0 | 0 | 0 | 0 | 0 | Pass |
| EP05 operator progress wiring | 0 | 0 | 0 | 0 | 0 | Pass |

## Recommendations before production shipping
1. **HIGH** Run a live Electron learn-song pass with a real audio file after `python-sidecar[ml]` and model cache are installed.
2. **MEDIUM** Add percent-complete estimates once Demucs/WhisperX native progress hooks are connected.
3. **MEDIUM** Add a capture-mode QA scenario that opens the Learn Song wizard and records progress labels during an injected sidecar run.

## Final verdict
EP05 operator progress wiring is locally ready. The Python sidecar, TypeScript controller contract, Electron IPC boundary, renderer bootstrap, and Svelte wizard now agree on a request/job-tagged progress path, and the full regression sweep remains clean.
