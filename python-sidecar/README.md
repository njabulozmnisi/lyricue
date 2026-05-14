# LyriCue Python Sidecar

ML pipeline for LyriCue, packaged via PyInstaller per ADR-14.

## Status

EP-01 scaffold — entry point + `ready` notification only. Full pipeline (Demucs + WhisperX + librosa) lands in EP-05.

## Local development

```bash
cd python-sidecar
python -m venv .venv
source .venv/bin/activate  # macOS / Linux
# OR: .venv\Scripts\activate  # Windows
pip install -e ".[dev]"
python -m lyricue_sidecar
# Expected output:
# {"jsonrpc": "2.0", "method": "ready", "params": {"version": "0.1.0", "phase": "scaffold"}}
```

## Protocol

JSON-RPC 2.0 over stdin (requests) / stdout (responses + notifications). stderr is reserved for logging.

See [architecture.md §4.2 and §6.5](../_bmad-output/architecture.md) for the full protocol spec.

## Method index

| Method | Direction | Status |
|---|---|---|
| `ready` | sidecar → host | ✅ EP-01 scaffold |
| `check_models` | host → sidecar | ⬜ EP-04 STORY-04.2 |
| `learn_song` | host → sidecar | ⬜ EP-05 |
| `segment_rehearsal` | host → sidecar | ⬜ EP-17 |
| `progress` | sidecar → host (notification) | ⬜ EP-05 |
| `cancel_job` | host → sidecar | ⬜ EP-05 STORY-05.7 |
| `shutdown` | host → sidecar | ⬜ EP-04 STORY-04.2 |
