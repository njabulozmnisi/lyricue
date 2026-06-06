# EP-05 Packaged ML Sidecar QA Report — 2026-06-05

**QA persona:** Senior QA analyst — packaged executable + cache-only production learning + defect triage
**Scope:** Python 3.11 PyInstaller sidecar built from the ML venv, launched as a packaged executable, and exercised through JSON-RPC `learn_song` against the EP-05.8 production fixture.
**Environment:** Local macOS arm64 host; PyInstaller onefile binary at `build/sidecar/darwin-arm64/lyricue-sidecar`; staged model cache under `build/models/release`; offline flags enabled.
**Status:** Pass-with-caveats

## Executive summary

The packaged ML sidecar now builds, starts, keeps JSON-RPC stdout clean, and returns a TimingMap from the offline/cache-only production fixture. The earlier packaged import blockers are fixed with targeted PyInstaller collection rules, and the packaged `learn_song` proof is now repeatable through `scripts/smoke_packaged_learn_song.py`.

No **CRITICAL** or open **HIGH** packaged execution defects remain from this pass. The release smoke returned 24/26 confident words with `invalidStdout=[]`; Gate B still carries caveats for slow onefile startup and native audio dependency warnings.

## Test environment + persona setup

- Build interpreter: `python-sidecar/.venv-ml/bin/python`, Python 3.11.11.
- Build command: `.venv-ml/bin/python build.py`.
- Binary size: 313,306,786 bytes final candidate.
- Model cache: staged through `scripts/stage_release_models.py`.
- Offline enforcement: `LYRICUE_MODEL_CACHE_ONLY=1`, `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`.
- Persona setup: not applicable; this pass verifies packaged runtime behavior.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| EP05-PKG-01 | ML PyInstaller build | Release engineer | Python 3.11 ML venv produces darwin-arm64 binary | Build completed; binary size 313,306,786 bytes | Pass |
| EP05-PKG-02 | Packaged JSON-RPC liveness | Runtime host | Binary emits `ready`, answers request, shuts down | `ready` emitted; latest measured `readyMs=117230` | Pass-with-caveat |
| EP05-PKG-03 | Host ready timeout | Runtime host | Sister app waits long enough for ML onefile startup | Bundled timeout raised from 30s to 180s; latest measured startup fits | Pass |
| EP05-PKG-04 | Packaged `learn_song` import graph | Runtime host | Cache-only fixture reaches WhisperX/Pyannote without import/data errors | Fixed successive `whisperx.asr`, `torchcodec` metadata, Pyannote data, WhisperX assets, and Pyannote segmentation import gaps | Pass |
| EP05-PKG-05 | JSON-RPC stdout contract | Runtime host | Sidecar stdout contains only JSON-RPC frames | Latest run had `invalidStdout=[]`; WhisperX logs moved to stderr | Pass |
| EP05-PKG-06 | Packaged `learn_song` quality | Runtime host | Fixture returns TimingMap with confidence ratio `>=0.85` | Final packaged variance sample returned 25/26 confident words twice, ratio `0.9615384615384616` | Pass |
| EP05-PKG-07 | Repeatable release smoke | Release engineer | Scripted smoke asserts stdout hygiene, required progress stages, schema, and confidence | `release-smoke-summary.json`: `readyMs=115935`, `totalMs=229603`, `invalidStdout=[]`, 24/26 confident words, ratio `0.9230769230769231` | Pass |

## Defects surfaced + fixed

### D-EP05-PKG-01 — **HIGH**

Symptom: The first packaged `learn_song` attempt failed with `No module named 'whisperx.asr'`.

Root cause: PyInstaller did not collect WhisperX's dynamically imported ASR submodule from the normal import graph.

Latency: Introduced when packaging moved from protocol-only sidecar to ML-vendored sidecar. Source-mode tests and source-mode cache-only fixture runs did not exercise PyInstaller's module graph.

Fix status: Fixed by collecting WhisperX submodules in `python-sidecar/build.py` and pinned by `python-sidecar/tests/test_build.py`.

### D-EP05-PKG-02 — **HIGH**

Symptom: Packaged `learn_song` failed with `Could not import module 'Pipeline'. Are this object's requirements defined correctly?`.

Root cause: Transformer lazy import resolution needed torchcodec package metadata inside the PyInstaller bundle; the original one-line error hid the chained `PackageNotFoundError`.

Latency: Source-mode import worked because package metadata exists in the venv. The defect only appeared in the frozen executable.

Fix status: Fixed by preserving chained error causes in alignment errors and adding `--copy-metadata torchcodec`.

### D-EP05-PKG-03 — **HIGH**

Symptom: Packaged `learn_song` failed on missing Pyannote and WhisperX package assets: Pyannote telemetry config and WhisperX `pytorch_model.bin`.

Root cause: PyInstaller collected code but not package data required by WhisperX's Pyannote VAD path.

Latency: Surfaced only after earlier import defects were cleared.

Fix status: Fixed by collecting `pyannote.audio` and `whisperx` package data.

### D-EP05-PKG-04 — **HIGH**

Symptom: Packaged `learn_song` failed with `No module named 'pyannote.audio.models.segmentation'`.

Root cause: Pyannote loads segmentation modules dynamically, outside PyInstaller's static graph.

Latency: Surfaced only after package data defects were cleared.

Fix status: Fixed by collecting `pyannote.audio` submodules.

### D-EP05-PKG-05 — **HIGH**

Symptom: WhisperX wrote INFO log lines to stdout, which corrupted the newline-delimited JSON-RPC transport.

Root cause: WhisperX configures its logger with `StreamHandler(sys.stdout)`, while LyriCue reserves stdout for protocol frames.

Latency: Source handler tests use deterministic alignment and did not exercise third-party logging in production alignment.

Fix status: Fixed by routing WhisperX stream handlers and incidental stdout to stderr during the alignment stage; pinned by `python-sidecar/tests/test_forced_alignment.py`.

### D-EP05-PKG-06 — **INFO**

Symptom: One packaged run returned a TimingMap below the existing quality gate: 22/26 confident words, confidence ratio `0.8461538461538461`; expected `>=0.85`.

Root cause: Run-to-run model variance on a sensitive public-domain fixture. A source-mode variance sample returned 25/26, 23/26, and 25/26 confident words. A packaged variance sample then returned 25/26 and 25/26 confident words from separate executable launches.

Latency: Surfaced only after packaged execution became capable of returning a TimingMap.

Fix status: Not a persistent defect after variance sampling; keep the fixture as a heavyweight gate and watch for repeated sub-threshold packaged results.

## Network / data layer observations

- No network access was required for the packaged proof; the run used staged local model directories and offline/cache-only env flags.
- Latest packaged `readyMs` samples were `117981` cold, `35681` warm, and `115935` in the scripted release smoke; this fits the 180s bundled sidecar timeout but leaves limited cold-start margin on slower hosts.
- JSON-RPC stdout was clean in the latest run: `invalidStdout=[]`.
- PyInstaller still warns that torchaudio's `libtorchaudio_sox` and `_torchaudio_sox` cannot resolve `@rpath/libsox.dylib`.
- Runtime stderr still reports torchcodec/FFmpeg native decoder warnings. Current LyriCue code supplies in-memory decoded audio to the Pyannote path, but this warning needs release certification or dependency repair.

## Cumulative defect tally

| Pass | Critical | High | Medium | Low | Info | Status |
|---|---:|---:|---:|---:|---:|---|
| Packaged ML sidecar pass | 0 | 5 | 0 | 0 | 1 | 5 fixed, release smoke added, 1 variance note |

## Recommendations before production shipping

1. **HIGH** Run `scripts/smoke_packaged_learn_song.py` on every platform artifact produced by release packaging.
2. **MEDIUM** Increase or make configurable the bundled sidecar ready timeout if slower signed/notarized builds exceed the current 180s envelope.
3. **MEDIUM** Resolve or certify the torchcodec/FFmpeg and torchaudio `libsox.dylib` warnings before final production packaging.
4. **MEDIUM** Keep a small variance log for the EP-05 public-domain fixture; if packaged runs repeatedly fall below threshold, replace the fixture with a cleaner public-domain vocal recording rather than lowering the gate.

## Final verdict

The packaged ML executable now completes the production `learn_song` path, returns a valid TimingMap, and preserves the JSON-RPC stdout contract. Gate B is locally pass-with-caveats: native audio dependency warnings and slow onefile startup remain release hardening items, but packaged production learning is no longer blocked on import/runtime execution.
