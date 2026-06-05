# Gate B ML Environment QA Report — 2026-06-05
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** Production-learning environment readiness for the Python sidecar: optional ML dependency install, module import health, subprocess JSON-RPC transport, model-cache idempotency, and deterministic learning regression under the ML venv.
**Environment:** Local dev, macOS arm64, `/Users/njabulomnisi/Projects/Dojo/worshipsync`, Python 3.11 ML venv at `python-sidecar/.venv-ml`.
**Status:** Pass-with-caveats

## Executive summary
Gate B environment readiness advanced: the optional Demucs/WhisperX stack installs and imports successfully on Python 3.11, and the full sidecar suite passes in both the regular dev venv and the ML venv. One **LOW** test-harness defect was surfaced and fixed. This does not yet certify production learning accuracy because no real model manifest/artifacts or public-domain vocal fixture were available for an end-to-end Demucs/WhisperX timing-quality run.

## Test environment + persona setup
- Pass: Repo was clean except the known ignored agent-artifact directory before Gate B work began.
- Pass: Python 3.11 was available at `/opt/homebrew/bin/python3.11`.
- Pass: Created a local-only ML venv at `python-sidecar/.venv-ml` and installed `.[dev,ml]`.
- Pass: Imported `demucs 4.0.1`, `whisperx`, `faster_whisper 1.2.1`, `torch 2.8.0`, and `torchaudio 2.8.0`.
- Pass: Regular sidecar venv regression: `77 passed in 11.31s`.
- Pass: ML sidecar venv regression: `77 passed, 1 warning in 14.89s`.
- Not applicable: No auth persona, DB, browser session, SSR/CSR path, or privacy boundary is involved in this offline sidecar environment pass.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| GATE-B-001 | ML dependency install | Local operator | `python-sidecar[dev,ml]` installs on a supported interpreter | Installed successfully in Python 3.11 venv | Pass |
| GATE-B-002 | ML module imports | Local operator | Demucs, WhisperX, Faster Whisper, Torch, and Torchaudio import without runtime errors | All imported successfully | Pass |
| GATE-B-003 | Regular sidecar regression | Local operator | Existing sidecar tests remain green in the regular venv | `77 passed in 11.31s` | Pass |
| GATE-B-004 | ML sidecar regression | Local operator | Existing sidecar tests remain green with ML deps installed | `77 passed, 1 warning in 14.89s` | Pass |
| GATE-B-005 | JSON-RPC subprocess transport | Local operator | Entry subprocess tests work across supported Python runtimes | Initial Python 3.11 run failed on closed-stdin `communicate()` usage; fixed and re-verified | Pass |
| GATE-B-006 | Model cache idempotency | Local operator | Re-running `ensure_models` against a file mirror returns cached statuses | Covered by `test_sidecar_ensure_models_downloads_from_file_mirror` in both venvs | Pass |

## Defects surfaced + fixed
D1 — **LOW** — Subprocess entry tests failed in Python 3.11.
Symptom: `python-sidecar/.venv-ml/bin/pytest -q` initially failed three `tests/test_entry.py` cases with `ValueError: I/O operation on closed file`.
Root cause: `python-sidecar/tests/test_entry.py` manually closed `proc.stdin` before calling `proc.communicate(timeout=...)`; Python 3.11 tries to flush the closed pipe during `communicate`.
Latency: The regular venv uses Python 3.14, where this did not surface during the existing local test sweep. The defect appeared only after exercising the supported Python 3.11 ML environment.
Repro steps: Create Python 3.11 ML venv, install `.[dev,ml]`, run `python-sidecar/.venv-ml/bin/pytest -q`.
Evidence: Initial ML venv run failed with three `ValueError: I/O operation on closed file` failures in `tests/test_entry.py`.
Fix proposal: Send newline-delimited JSON request bodies through `proc.communicate(input=...)` so EOF and pipe flushing are handled by the subprocess API.
Fix status: Fixed locally and verified in both Python venvs.

## Network / data layer observations
- Network: ML dependency installation required outbound package downloads. No app runtime network calls were observed or required for sidecar tests.
- Model cache: The file-mirror model-cache test verifies first-run download and second-run cached behavior through the real JSON-RPC transport.
- Data layer: No database or persistent app data was in scope. The local `.venv-ml` directory is now covered by `.gitignore` via `.venv-*/`.
- Console/logs: One ML-vendored `librosa` deprecation warning appears under Python 3.11; it is non-blocking and outside LyriCue code.

## Cumulative defect tally (if multi-pass)
| Pass | Defects | CRITICAL | HIGH | MEDIUM | LOW | INFO |
|---|---:|---:|---:|---:|---:|---:|
| Gate B ML environment readiness | 1 | 0 | 0 | 0 | 1 | 0 |

## Recommendations before production shipping
1. **HIGH** Add the EP-05.8 public-domain vocal fixture and assert timing-map quality thresholds against a real production-mode `learn_song` run.
2. **HIGH** Provision the real model manifest and SHA256-pinned model artifacts; run `LC_REQUIRE_MODEL_MANIFEST=1` through the operator Learn Song flow.
3. **MEDIUM** Add a documented Python version ceiling or release-matrix note once packaging is finalized, because the ML stack is validated here on Python 3.11 while the regular dev venv currently uses Python 3.14.
4. **MEDIUM** Capture a production-mode Electron QA pass with model download progress, cached-model rerun, cancellation, and fallback error messaging.

## Final verdict
Gate B is not fully closed, but the local runtime blocker has moved: the machine can install and import the production ML stack on Python 3.11, and sidecar behavior remains green with those dependencies installed. The remaining gate is product certification, not dependency installation: LyriCue still needs real model artifacts plus a public-domain vocal fixture before production learning accuracy can be called shippable.
