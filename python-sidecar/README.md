# LyriCue Python Sidecar

ML pipeline for LyriCue, packaged via PyInstaller per ADR-14.

## Status

EP-05 in progress. The sidecar exposes `ready`, `ping`, `check_models`, `ensure_models`, `learn_song`,
`cancel_job`, and `shutdown`. `learn_song` validates, decodes, and resamples
MP3/WAV/FLAC/OGG audio to 16 kHz mono via `librosa`, estimates BPM, deterministically
aligns structured lyrics, returns a schema-compatible TimingMap, and proposes section
types from repeated lyrics plus `librosa.feature.rms` energy contours when requested.
`options.alignmentMode: "production"` routes through the Demucs and WhisperX stage
contracts. If `options.requiredModels` is supplied, production learning verifies or downloads
those model artifacts into the local cache before Demucs/WhisperX run.

## Local development

```bash
cd python-sidecar
python -m venv .venv
source .venv/bin/activate  # macOS / Linux
# OR: .venv\Scripts\activate  # Windows
pip install -e ".[dev]"
# Optional heavyweight ML stage dependencies:
# pip install -e ".[dev,ml]"
python -m lyricue_sidecar
# Expected first output:
# {"jsonrpc": "2.0", "method": "ready", "params": {"version": "0.1.0", "phase": "ep17-rehearsal-mode", ...}}
```

For production-learning validation on macOS arm64, use Python 3.11 for the ML venv. The regular development venv may run on newer Python versions, but the Demucs/WhisperX dependency stack is validated here against Python 3.11:

```bash
cd python-sidecar
/opt/homebrew/bin/python3.11 -m venv .venv-ml
.venv-ml/bin/pip install -e ".[dev,ml]"
.venv-ml/bin/pytest -q
```

Production learning can be forced to use local model caches instead of package-managed downloads:

- `params.options.demucsRepo` or `LYRICUE_DEMUCS_REPO` — local Demucs repo passed to `demucs.pretrained.get_model(..., repo=...)`.
- `params.options.whisperxDownloadRoot` or `LYRICUE_WHISPERX_DOWNLOAD_ROOT` — Faster Whisper cache/download root.
- `params.options.whisperxAlignModel` or `LYRICUE_WHISPERX_ALIGN_MODEL` — explicit WhisperX alignment model name.
- `params.options.whisperxAlignModelDir` or `LYRICUE_WHISPERX_ALIGN_MODEL_DIR` — WhisperX alignment model cache directory.
- `params.options.modelCacheOnly` or `LYRICUE_MODEL_CACHE_ONLY=1` — require local cached model files and prevent WhisperX downloads.

To stage a release-owned cache layout from the local ML caches:

```bash
cd python-sidecar
.venv-ml/bin/python scripts/stage_release_models.py --output-root ../build/models/release
```

The script creates:

- `build/models/release/demucs-repo` — Demucs local repo with `htdemucs.yaml` plus the referenced `.th` checkpoint.
- `build/models/release/huggingface` — Faster Whisper Hugging Face cache root.
- `build/models/release/torchaudio-checkpoints` — WhisperX English alignment checkpoint directory.
- `build/models/release/manifest.json` — SHA256/size manifest plus the environment variables needed for cache-only validation.

Run the production fixture against the staged cache with:

```bash
cd python-sidecar
export LYRICUE_DEMUCS_REPO="../build/models/release/demucs-repo"
export LYRICUE_WHISPERX_DOWNLOAD_ROOT="../build/models/release/huggingface"
export LYRICUE_WHISPERX_ALIGN_MODEL_DIR="../build/models/release/torchaudio-checkpoints"
export LYRICUE_MODEL_CACHE_ONLY=1
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
LYRICUE_RUN_ML_FIXTURE=1 .venv-ml/bin/pytest tests/test_learning_production_fixture.py -q
```

The staged model directory is intentionally build output and is not committed.

After building the PyInstaller binary, run the packaged release smoke against the same staged cache:

```bash
cd python-sidecar
export LYRICUE_DEMUCS_REPO="../build/models/release/demucs-repo"
export LYRICUE_WHISPERX_DOWNLOAD_ROOT="../build/models/release/huggingface"
export LYRICUE_WHISPERX_ALIGN_MODEL_DIR="../build/models/release/torchaudio-checkpoints"
export LYRICUE_MODEL_CACHE_ONLY=1
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
.venv-ml/bin/python scripts/smoke_packaged_learn_song.py \
  --binary ../build/sidecar/darwin-arm64/lyricue-sidecar \
  --output-json ../docs/qa-reports/evidence/ep05-packaged-ml-sidecar-2026-06-05/release-smoke-summary.json
```

The smoke fails if the packaged executable writes non-JSON text to stdout, misses required progress stages, returns a non-`lyricue-timing-v1` map, or falls below the confidence threshold.

## Protocol

JSON-RPC 2.0 over stdin (requests) / stdout (responses + notifications). stderr is reserved for logging.

See [architecture.md §4.2 and §6.5](../_bmad-output/architecture.md) for the full protocol spec.

## Method index

| Method | Direction | Status |
|---|---|---|
| `ready` | sidecar → host | ✅ EP-04 |
| `ping` | host → sidecar | ✅ EP-04 STORY-04.2 |
| `check_models` | host → sidecar | ✅ EP-04 STORY-04.2 |
| `ensure_models` | host → sidecar | ✅ EP-04 STORY-04.6 model cache/download manager |
| `learn_song` | host → sidecar | Partial: ✅ EP-05 05.1–05.6 stage contracts; production ML path requires `.[ml]` + model cache |
| `segment_rehearsal` | host → sidecar | Partial: ✅ EP-17 silence segmentation + deterministic lyric matching hook |
| `progress` | sidecar → host (notification) | ✅ EP-05 tagged stage progress for `learn_song` |
| `cancel_job` | host → sidecar | Partial: ✅ EP-05 STORY-05.7 checkpoint cancellation |
| `shutdown` | host → sidecar | ✅ EP-04 STORY-04.2 |
