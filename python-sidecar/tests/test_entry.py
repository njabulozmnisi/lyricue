"""Subprocess-level smoke test for the sidecar entry (STORY-04.1 + 04.2)."""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import wave
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent  # python-sidecar/


def test_sidecar_emits_ready_then_handles_ping():
    """Spawn the sidecar; send ping; verify ready notification + ping response, then EOF."""
    proc = subprocess.Popen(
        [sys.executable, "-m", "lyricue_sidecar"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=REPO_ROOT,
        text=True,
    )
    assert proc.stdin is not None
    assert proc.stdout is not None

    request_body = "\n".join(
        [
            json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping", "params": {"trace": "ok"}}),
            json.dumps({"jsonrpc": "2.0", "id": 2, "method": "shutdown"}),
            "",
        ]
    )

    stdout_data, _stderr_data = proc.communicate(input=request_body, timeout=10)
    exit_code = proc.returncode

    lines = [json.loads(line) for line in stdout_data.splitlines() if line.strip()]

    # Expected sequence:
    #   1. ready notification (no id)
    #   2. ping response (id=1)
    #   3. shutdown response (id=2)
    assert len(lines) == 3, f"unexpected line count: {lines}"

    ready = lines[0]
    assert "id" not in ready
    assert ready["method"] == "ready"
    assert "version" in ready["params"]
    assert "ping" in ready["params"]["methods"]

    ping_resp = lines[1]
    assert ping_resp["id"] == 1
    assert ping_resp["result"]["pong"] is True
    assert ping_resp["result"]["echo"] == {"trace": "ok"}

    shutdown_resp = lines[2]
    assert shutdown_resp["id"] == 2
    assert shutdown_resp["result"]["shuttingDown"] is True

    assert exit_code == 0


def test_sidecar_learn_song_emits_progress_then_timing_map(tmp_path: Path):
    """Spawn the sidecar; send learn_song; verify progress notifications + final TimingMap."""

    audio_path = tmp_path / "tone.wav"
    write_wav_fixture(audio_path)

    proc = subprocess.Popen(
        [sys.executable, "-m", "lyricue_sidecar"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=REPO_ROOT,
        text=True,
    )
    assert proc.stdin is not None
    assert proc.stdout is not None

    request_body = "\n".join(
        [
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": "learn-1",
                    "method": "learn_song",
                    "params": {
                        "jobId": "entry-learn",
                        "showId": "entry-show",
                        "audioPath": str(audio_path),
                        "lyrics": [
                            {
                                "id": "verse-1",
                                "type": "verse",
                                "label": "Verse 1",
                                "text": "Amazing grace\nHow sweet the sound",
                                "lines": ["Amazing grace", "How sweet the sound"],
                            }
                        ],
                        "options": {"language": "en", "detectSections": True},
                    },
                }
            ),
            json.dumps({"jsonrpc": "2.0", "id": "shutdown-1", "method": "shutdown"}),
            "",
        ]
    )

    try:
        stdout_data, _stderr_data = proc.communicate(input=request_body, timeout=45)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.communicate(timeout=5)
        raise
    lines = [json.loads(line) for line in stdout_data.splitlines() if line.strip()]

    assert lines[0]["method"] == "ready"
    progress = [line for line in lines if line.get("method") == "progress"]
    assert [line["params"]["stage"] for line in progress] == [
        "decode",
        "bpm",
        "alignment",
        "timing_map",
        "section_detection",
        "complete",
    ]
    assert all(line["params"]["request_id"] == "learn-1" for line in progress)
    assert all(line["params"]["jobId"] == "entry-learn" for line in progress)

    learn_response = next(line for line in lines if line.get("id") == "learn-1")
    assert learn_response["result"]["stage"] == "timing_map_ready"
    timing_map = learn_response["result"]["timingMap"]
    assert timing_map["showId"] == "entry-show"
    assert timing_map["learnedFrom"]["filename"] == "tone.wav"
    assert timing_map["sections"][0]["words"][0]["text"] == "Amazing"
    assert timing_map["sections"][0]["words"][-1]["text"] == "sound"

    shutdown_resp = next(line for line in lines if line.get("id") == "shutdown-1")
    assert shutdown_resp["result"]["shuttingDown"] is True
    assert proc.returncode == 0


def test_sidecar_ensure_models_downloads_from_file_mirror(tmp_path: Path):
    """Spawn the sidecar; install fixture models through the real JSON-RPC transport."""

    mirror = tmp_path / "mirror"
    demucs_dir = mirror / "fixture-demucs-v1"
    whisperx_dir = mirror / "fixture-whisperx-v1"
    demucs_dir.mkdir(parents=True)
    whisperx_dir.mkdir(parents=True)
    (demucs_dir / "fixture-demucs-v1.bin").write_bytes(b"fixture-demucs-model")
    (whisperx_dir / "weights.bin").write_bytes(b"fixture-whisperx-model")
    models_dir = tmp_path / "models"

    proc = subprocess.Popen(
        [sys.executable, "-m", "lyricue_sidecar"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=REPO_ROOT,
        env={**os.environ, "LYRICUE_MODELS_DIR": str(models_dir)},
        text=True,
    )
    assert proc.stdin is not None
    assert proc.stdout is not None

    request = {
        "jsonrpc": "2.0",
        "id": "models-1",
        "method": "ensure_models",
        "params": {
            "mirrorUrl": mirror.as_uri(),
            "models": [
                {
                    "name": "fixture-demucs",
                    "version": "v1",
                    "sha256": "7d12dac6600a2aacee79c3d089d39582f8b27b1e367fa2342cdd74023773f26a",
                    "bytes": len(b"fixture-demucs-model"),
                },
                {
                    "name": "fixture-whisperx",
                    "version": "v1",
                    "sha256": "661ac7dd2def9073f07ab09c9d4c34bfb8b51bff9f169eb16557bc49ce3d21ed",
                    "artifactName": "weights.bin",
                    "bytes": len(b"fixture-whisperx-model"),
                },
            ],
        },
    }
    request_body = "\n".join(
        [
            json.dumps(request),
            json.dumps({"jsonrpc": "2.0", "id": "models-2", "method": "ensure_models", "params": request["params"]}),
            json.dumps({"jsonrpc": "2.0", "id": "shutdown-1", "method": "shutdown"}),
            "",
        ]
    )

    try:
        stdout_data, _stderr_data = proc.communicate(input=request_body, timeout=20)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.communicate(timeout=5)
        raise
    lines = [json.loads(line) for line in stdout_data.splitlines() if line.strip()]

    ready = lines[0]
    assert ready["method"] == "ready"
    assert "ensure_models" in ready["params"]["methods"]

    first_response = next(line for line in lines if line.get("id") == "models-1")
    assert [model["status"] for model in first_response["result"]["models"]] == ["downloaded", "downloaded"]
    second_response = next(line for line in lines if line.get("id") == "models-2")
    assert [model["status"] for model in second_response["result"]["models"]] == ["cached", "cached"]

    progress_stages = [line["params"]["stage"] for line in lines if line.get("method") == "progress"]
    assert progress_stages.count("model_download_start") == 2
    assert progress_stages.count("model_download_progress") == 2
    assert progress_stages.count("model_installed") == 2
    assert progress_stages.count("model_cached") == 2
    assert (models_dir / "fixture-demucs-v1" / "fixture-demucs-v1.bin").read_bytes() == b"fixture-demucs-model"
    assert (models_dir / "fixture-whisperx-v1" / "weights.bin").read_bytes() == b"fixture-whisperx-model"
    assert proc.returncode == 0


def write_wav_fixture(path: Path) -> None:
    sample_rate = 44_100
    duration_seconds = 1
    sample_count = sample_rate * duration_seconds
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        frames = bytearray()
        for i in range(sample_count):
            value = int(12_000 * math.sin(2 * math.pi * 440 * (i / sample_rate)))
            frames.extend(value.to_bytes(2, "little", signed=True))
        wav.writeframes(bytes(frames))
