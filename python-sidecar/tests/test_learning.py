"""EP-05 song-learning RPC handler tests."""
from __future__ import annotations

from pathlib import Path

import pytest

from lyricue_sidecar import learning
from lyricue_sidecar.audio_decode import DecodedAudio, TARGET_SAMPLE_RATE
from lyricue_sidecar.learning import learn_song_handler
from lyricue_sidecar.protocol import ERROR_INVALID_PARAMS, JsonRpcError


def test_learn_song_requires_params():
    with pytest.raises(JsonRpcError) as exc:
        learn_song_handler(None)

    assert exc.value.code == ERROR_INVALID_PARAMS


def test_learn_song_requires_audio_path():
    with pytest.raises(JsonRpcError) as exc:
        learn_song_handler({"jobId": "j1"})

    assert exc.value.code == ERROR_INVALID_PARAMS


def test_learn_song_rejects_non_string_job_id():
    with pytest.raises(JsonRpcError) as exc:
        learn_song_handler({"jobId": 123, "audioPath": "/tmp/song.wav"})

    assert exc.value.code == ERROR_INVALID_PARAMS


def test_learn_song_returns_audio_decode_stage(monkeypatch: pytest.MonkeyPatch):
    def fake_decode(audio_path: str):
        assert audio_path == "/tmp/song.wav"
        return DecodedAudio(
            path=Path(audio_path),
            sample_rate=TARGET_SAMPLE_RATE,
            duration_seconds=12.5,
            sample_count=200_000,
            byte_size=4096,
        )

    monkeypatch.setattr(learning, "decode_audio_file", fake_decode)

    result = learn_song_handler({"jobId": "job-1", "audioPath": "/tmp/song.wav"})

    assert result == {
        "jobId": "job-1",
        "stage": "audio_decoded",
        "audio": {
            "filename": "song.wav",
            "durationSeconds": 12.5,
            "sampleRate": TARGET_SAMPLE_RATE,
            "sampleCount": 200_000,
            "bytes": 4096,
        },
    }
