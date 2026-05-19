"""Subprocess-level smoke test for the sidecar entry (STORY-04.1 + 04.2)."""
from __future__ import annotations

import json
import math
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

    # Write a ping request, then close stdin to signal EOF and let the loop exit cleanly.
    proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping", "params": {"trace": "ok"}}) + "\n")
    proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 2, "method": "shutdown"}) + "\n")
    proc.stdin.close()

    stdout_data, _stderr_data = proc.communicate(timeout=10)
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

    proc.stdin.write(
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
        )
        + "\n"
    )
    proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": "shutdown-1", "method": "shutdown"}) + "\n")
    proc.stdin.close()

    try:
        stdout_data, _stderr_data = proc.communicate(timeout=45)
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
