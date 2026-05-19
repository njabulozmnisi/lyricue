# LyriCue Python Sidecar

ML pipeline for LyriCue, packaged via PyInstaller per ADR-14.

## Status

EP-05 in progress. The sidecar exposes `ready`, `ping`, `check_models`, `learn_song`,
`cancel_job`, and `shutdown`. `learn_song` validates, decodes, and resamples
MP3/WAV/FLAC/OGG audio to 16 kHz mono via `librosa`, estimates BPM, deterministically
aligns structured lyrics, returns a schema-compatible TimingMap, and proposes section
types from repeated lyrics plus `librosa.feature.rms` energy contours when requested.
Production Demucs/WhisperX alignment replaces the deterministic aligner once model distribution is ready.

## Local development

```bash
cd python-sidecar
python -m venv .venv
source .venv/bin/activate  # macOS / Linux
# OR: .venv\Scripts\activate  # Windows
pip install -e ".[dev]"
python -m lyricue_sidecar
# Expected first output:
# {"jsonrpc": "2.0", "method": "ready", "params": {"version": "0.1.0", "phase": "ep17-rehearsal-mode", ...}}
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
| `learn_song` | host → sidecar | Partial: ✅ EP-05 05.1, 05.4, 05.5 deterministic TimingMap, 05.6 section proposals |
| `segment_rehearsal` | host → sidecar | Partial: ✅ EP-17 silence segmentation + deterministic lyric matching hook |
| `progress` | sidecar → host (notification) | ⬜ EP-05 |
| `cancel_job` | host → sidecar | Partial: ✅ EP-05 STORY-05.7 checkpoint cancellation |
| `shutdown` | host → sidecar | ✅ EP-04 STORY-04.2 |
