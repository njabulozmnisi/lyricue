# EP-05 Cache-Only Model QA Report — 2026-06-05

**QA persona:** Senior QA analyst — offline model cache + production ML fixture + defect triage
**Scope:** EP-05 production learning with release-owned local model directories for Demucs, Faster Whisper, and WhisperX alignment.
**Environment:** Local macOS arm64 host; Python 3.11 ML venv; staged model cache under `build/models/release`; offline flags `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1`.
**Status:** Pass-with-caveats

## Executive summary

The release-owned cache-only model path now passes locally. A staging utility builds a loader-compatible model layout and emits a SHA256 manifest plus the env vars required by `learn_song`.

One **HIGH** release defect surfaced: Demucs local-repo loading failed under PyTorch 2.8 safe-load defaults even though the default remote-cache path worked. LyriCue now scopes trusted local artifact loading for Demucs release repos, and the production fixture passes with `LYRICUE_MODEL_CACHE_ONLY=1`.

## Test environment + persona setup

- Model staging command: `.venv-ml/bin/python scripts/stage_release_models.py --output-root ../build/models/release`.
- Evidence manifest: `docs/qa-reports/evidence/ep05-cache-only-models-2026-06-05/manifest.json`.
- Staged artifacts: Demucs `htdemucs`, Faster Whisper `small`, WhisperX English torchaudio alignment checkpoint.
- Offline enforcement: `LYRICUE_MODEL_CACHE_ONLY=1`, `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`.
- Persona setup: not applicable; this pass verifies model/runtime data paths.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| EP05-CO-01 | Model staging utility | Release engineer | Stage Demucs, Faster Whisper, and alignment caches into one release directory | `build/models/release` created, 904 MB, manifest emitted | Pass |
| EP05-CO-02 | Staging utility unit test | Developer | Fake cache layout stages into loader-compatible output | `tests/test_stage_release_models.py` passed | Pass |
| EP05-CO-03 | Demucs local repo load | Runtime host | Local `LYRICUE_DEMUCS_REPO` loads without network | Initially failed on PyTorch safe-load default; fixed and unit-pinned | Pass after fix |
| EP05-CO-04 | Cache-only production fixture | Runtime host | EP-05.8 production fixture passes with offline/cache-only env | `1 passed, 7 warnings in 30.91s` | Pass |

## Defects surfaced + fixed

### D-EP05-CO-01 — **HIGH**

Symptom: The EP-05.8 production fixture failed immediately when `LYRICUE_DEMUCS_REPO` pointed at a staged local Demucs repo.

Root cause: Demucs `LocalRepo` loads `.th` package checkpoints through `torch.load` without specifying `weights_only`. PyTorch 2.6+ defaults to safe `weights_only=True`, which rejects Demucs package classes. The default Demucs remote-cache path did not expose this because it uses a different loader path.

Latency: Introduced when local Demucs repo support was added. Unit tests checked option forwarding but not the real local repo loader against PyTorch 2.8.

Repro steps:

1. Stage a local Demucs repo containing `htdemucs.yaml` and `955717e8-8726e21a.th`.
2. Run the production fixture with `LYRICUE_DEMUCS_REPO=<staged repo>` and `LYRICUE_MODEL_CACHE_ONLY=1`.
3. Observe `Demucs vocal isolation failed` wrapping a PyTorch `Weights only load failed` error.

Evidence: Failed command output from this pass; passing rerun with `LYRICUE_MODEL_CACHE_ONLY=1`, `HF_HUB_OFFLINE=1`, and `TRANSFORMERS_OFFLINE=1` completed in 30.91s.

Fix proposal: For Demucs local repos only, temporarily set `TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1` while loading the trusted release-owned checkpoint, then restore the previous environment.

Fix status: Fixed locally and covered by `tests/test_vocal_isolation.py`.

## Network / data layer observations

- No database was involved.
- The passing fixture used staged local files only. The command also set Hugging Face and Transformers offline flags to catch silent network fallback.
- The model manifest records artifact byte sizes and SHA256 hashes for the staged release cache.
- The torchcodec warning still appears. It does not block this run because LyriCue passes an in-memory waveform into WhisperX, but packaged ML runtime QA must either resolve or explicitly certify it.

## Cumulative defect tally

| Pass | Critical | High | Medium | Low | Info | Status |
|---|---:|---:|---:|---:|---:|---|
| EP-05 cache-only model pass | 0 | 1 | 0 | 0 | 0 | Fixed locally |

## Recommendations before production shipping

1. **HIGH** Build the PyInstaller sidecar from the Python 3.11 ML venv and rerun this exact cache-only fixture through the packaged executable.
2. **HIGH** Store the staged model artifacts in the release distribution channel with the committed manifest shape and verify checksums before launch.
3. **MEDIUM** Keep `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1` in release QA for cache-only model tests.
4. **MEDIUM** Resolve or certify the torchcodec warning before installer sign-off.

## Final verdict

The EP-05 cache-only model path is locally proven for source-mode sidecar execution. Gate B now moves to packaged-ML-sidecar proof and operator-UI production learning evidence; it is no longer blocked by fixture quality or default package-managed model caches.
