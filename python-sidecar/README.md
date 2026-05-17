# LyriCue Python Sidecar

ML pipeline for LyriCue, packaged via PyInstaller per ADR-14.

## Status

EP-05 in progress. The sidecar exposes `ready`, `ping`, `check_models`, `learn_song`, and
`shutdown`. The first `learn_song` slice validates, decodes, and resamples MP3/WAV/FLAC/OGG
audio to 16 kHz mono via `librosa`; Demucs, WhisperX, BPM detection, TimingMap assembly,
progress notifications, and cancellation land in later EP-05 slices.

## Local development

```bash
cd python-sidecar
python -m venv .venv
source .venv/bin/activate  # macOS / Linux
# OR: .venv\Scripts\activate  # Windows
pip install -e ".[dev]"
python -m lyricue_sidecar
# Expected first output:
# {"jsonrpc": "2.0", "method": "ready", "params": {"version": "0.1.0", "phase": "ep05-audio-decode", ...}}
```

## Protocol

JSON-RPC 2.0 over stdin (requests) / stdout (responses + notifications). stderr is reserved for logging.

See [architecture.md §4.2 and §6.5](../_bmad-output/architecture.md) for the full protocol spec.

## Method index

| Method | Direction | Status |
|---|---|---|
| `ready` | sidecar → host | ✅ EP-04 |
| `ping` | host → sidecar | ✅ EP-04 STORY-04.2 |
| `check_models` | host → sidecar | ✅ EP-04 STORY-04.2 |
| `learn_song` | host → sidecar | Partial: ✅ EP-05 STORY-05.1 audio decode |
| `segment_rehearsal` | host → sidecar | ⬜ EP-17 |
| `progress` | sidecar → host (notification) | ⬜ EP-05 |
| `cancel_job` | host → sidecar | ⬜ EP-05 STORY-05.7 |
| `shutdown` | host → sidecar | ✅ EP-04 STORY-04.2 |
