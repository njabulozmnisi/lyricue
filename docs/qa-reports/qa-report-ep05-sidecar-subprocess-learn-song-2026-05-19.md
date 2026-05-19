# EP05 Sidecar Subprocess Learn-Song QA Report — 2026-05-19
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP05 sidecar entry-point subprocess smoke for `learn_song`: real `python -m lyricue_sidecar`, real JSON-RPC stdin/stdout transport, generated WAV fixture, progress notifications, final TimingMap response, and clean shutdown.
**Environment:** Local macOS dev, Python sidecar `.venv`, Node 25 `env -i` wrapper for TypeScript/build checks.
**Status:** Pass

## Executive summary
The Python sidecar now has a subprocess-level `learn_song` smoke test in addition to unit-level handler tests and the TypeScript controller integration test. No defects remain open from this pass.

The first full-suite run exposed a test robustness issue: 15 seconds was too tight when the full Python suite had already loaded audio dependencies. The test now uses a 45-second timeout and kills the child process on timeout.

## Test environment + persona setup
- Pass: Repository was on `main` after `2a28750 feat:(#EP-05): wire operator song learning progress`.
- Pass: Python subprocess test used the same `.venv` interpreter as the suite.
- Pass: Generated WAV fixture was created under pytest `tmp_path`; no committed binary fixture was required.
- Pass: No DB, browser persona, external service, or network-backed account was required.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP05-SUB-TC-01 | Sidecar entry smoke | Local developer | `python -m lyricue_sidecar` emits `ready`, handles `ping`, handles `shutdown`, exits 0. | Existing entry test still passed. | Pass |
| EP05-SUB-TC-02 | Subprocess learn-song request | Local developer | Real sidecar process handles `learn_song` over stdin/stdout with generated WAV + lyrics. | Response returned `stage="timing_map_ready"` and a TimingMap for `showId="entry-show"`. | Pass |
| EP05-SUB-TC-03 | Progress notification sequence | Local developer | Sidecar emits tagged progress notifications before final response. | Captured `decode`, `bpm`, `alignment`, `timing_map`, `section_detection`, `complete`, each tagged with `request_id="learn-1"` and `jobId="entry-learn"`. | Pass |
| EP05-SUB-TC-04 | Timeout hygiene | Local developer | Timeout does not leave a child sidecar process running. | Test kills the process and drains communication before re-raising timeout. | Pass |
| EP05-SUB-TC-05 | Regression sweep | Local developer | Existing local floor stays clean. | `tsc -b` passed, 678/678 TS tests passed, 68/68 Python tests passed, both sister bundles built. | Pass |

## Defects surfaced + fixed
**D1 — LOW — Subprocess smoke timeout too tight during full-suite execution**

Symptom: Focused `tests/test_entry.py` passed, but the full Python suite timed out after receiving only `ready`, `decode`, and `bpm` notifications.

Root cause: The test used a 15-second subprocess timeout while running after the rest of the audio-heavy Python suite. That was brittle for dependency import/runtime overhead, even though the sidecar behavior was correct.

Latency: Introduced with the new subprocess smoke test in this pass; not present in committed history.

Repro steps: Run `cd python-sidecar && .venv/bin/pytest -q` with the original 15-second timeout.

Evidence: Full-suite failure timed out in `test_sidecar_learn_song_emits_progress_then_timing_map` while the child process was still alive.

Fix proposal/status: Fixed in working tree by increasing the subprocess smoke timeout to 45 seconds and killing/draining the child on timeout in `python-sidecar/tests/test_entry.py:107`.

Verification: `cd python-sidecar && .venv/bin/pytest -q` passed: 68/68 tests.

## Network / data layer observations
- No network calls or persistent app-data writes were required.
- The test writes a temporary 44.1 kHz mono WAV and exercises the normal decode/resample path.
- Code-level evidence: subprocess `learn_song` smoke writes JSON-RPC request and shutdown frames in `python-sidecar/tests/test_entry.py:79`.
- Code-level evidence: progress sequence and request/job tagging are asserted in `python-sidecar/tests/test_entry.py:115`.
- Code-level evidence: final TimingMap shape is asserted from the real response in `python-sidecar/tests/test_entry.py:128`.
- Code-level evidence: timeout cleanup kills and drains the child process in `python-sidecar/tests/test_entry.py:107`.

## Cumulative defect tally (if multi-pass)
| Pass | New defects | Critical | High | Medium | Low | Current status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| EP05 section auto-detection | 0 | 0 | 0 | 0 | 0 | Pass |
| EP05 production stage contracts | 0 | 0 | 0 | 0 | 0 | Pass-with-caveats |
| EP05 progress notifications | 0 | 0 | 0 | 0 | 0 | Pass |
| EP05 operator progress wiring | 0 | 0 | 0 | 0 | 0 | Pass |
| EP05 sidecar subprocess learn-song | 1 | 0 | 0 | 0 | 1 | Fixed |

## Recommendations before production shipping
1. **HIGH** Add the full model-backed EP05.8 fixture once `python-sidecar[ml]` and the model cache are installed.
2. **MEDIUM** Keep the generated-WAV subprocess smoke in the fast suite; it catches JSON-RPC transport drift without heavyweight ML downloads.
3. **MEDIUM** Add an operator capture-mode learn-song scenario after the UI can inject a deterministic audio fixture path.

## Final verdict
EP05 now has a real sidecar subprocess smoke for the deterministic `learn_song` path. This proves the entry point, JSON-RPC transport, progress notifications, TimingMap response, and shutdown behavior together, while leaving the heavyweight Demucs/WhisperX fixture as the remaining production-model gate.
