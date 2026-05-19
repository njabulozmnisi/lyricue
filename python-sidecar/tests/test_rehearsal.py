"""EP-17 rehearsal segmentation tests."""
from __future__ import annotations

from pathlib import Path

import pytest

from lyricue_sidecar import rehearsal
from lyricue_sidecar.audio_decode import DecodedAudio
from lyricue_sidecar.protocol import ERROR_INVALID_PARAMS, JsonRpcError
from lyricue_sidecar.rehearsal import segment_rehearsal_handler


def test_segment_rehearsal_requires_params():
    with pytest.raises(JsonRpcError) as exc:
        segment_rehearsal_handler(None)
    assert exc.value.code == ERROR_INVALID_PARAMS


def test_segment_rehearsal_splits_audio_and_matches_lyrics(monkeypatch: pytest.MonkeyPatch):
    samples = [0.0] * 10 + [0.5] * 40 + [0.0] * 20 + [0.4] * 30 + [0.0] * 10

    def fake_decode(audio_path: str):
        assert audio_path == "/tmp/rehearsal.wav"
        return DecodedAudio(
            path=Path(audio_path),
            samples=samples,
            sample_rate=10,
            duration_seconds=11.0,
            sample_count=len(samples),
            byte_size=2048,
        )

    monkeypatch.setattr(rehearsal, "decode_audio_file", fake_decode)

    result = segment_rehearsal_handler(
        {
            "jobId": "rehearsal-1",
            "audioPath": "/tmp/rehearsal.wav",
            "setlist": [
                {"showId": "s1", "title": "Way Maker", "lyrics": "way maker miracle worker"},
                {"showId": "s2", "title": "Good Grace", "lyrics": "people come together"},
            ],
            "recognizedTextBySegment": ["miracle worker promise keeper", "people come together"],
            "options": {"silenceThreshold": 0.1, "minSegmentSeconds": 2},
        }
    )

    assert result["stage"] == "segments_ready"
    assert result["audio"]["sampleRate"] == 10
    assert result["segments"] == [
        {
            "index": 0,
            "startSec": 1.0,
            "endSec": 5.0,
            "status": "matched",
            "showId": "s1",
            "title": "Way Maker",
            "confidence": 0.333,
        },
        {
            "index": 1,
            "startSec": 7.0,
            "endSec": 10.0,
            "status": "matched",
            "showId": "s2",
            "title": "Good Grace",
            "confidence": 0.6,
        },
    ]


def test_segment_rehearsal_flags_unmatched_extra_segments(monkeypatch: pytest.MonkeyPatch):
    def fake_decode(_audio_path: str):
        return DecodedAudio(
            path=Path("/tmp/rehearsal.wav"),
            samples=[0.4] * 30,
            sample_rate=10,
            duration_seconds=3,
            sample_count=30,
            byte_size=128,
        )

    monkeypatch.setattr(rehearsal, "decode_audio_file", fake_decode)

    result = segment_rehearsal_handler(
        {
            "audioPath": "/tmp/rehearsal.wav",
            "setlist": [{"showId": "s1", "title": "Known", "lyrics": "known words"}],
            "recognizedTextBySegment": ["alpha beta"],
            "options": {"minSegmentSeconds": 1},
        }
    )

    assert result["segments"][0]["status"] == "review"
    assert result["segments"][0]["showId"] is None


def test_segment_rehearsal_tolerates_zero_crossings(monkeypatch: pytest.MonkeyPatch):
    samples = []
    for index in range(40):
        samples.append(0.0 if index % 5 == 0 else 0.4)

    def fake_decode(_audio_path: str):
        return DecodedAudio(
            path=Path("/tmp/rehearsal.wav"),
            samples=samples,
            sample_rate=10,
            duration_seconds=4,
            sample_count=len(samples),
            byte_size=128,
        )

    monkeypatch.setattr(rehearsal, "decode_audio_file", fake_decode)

    result = segment_rehearsal_handler(
        {
            "audioPath": "/tmp/rehearsal.wav",
            "setlist": [{"showId": "s1", "title": "Known", "lyrics": "known words"}],
            "options": {"minSegmentSeconds": 1, "maxSilenceSeconds": 0.25},
        }
    )

    assert len(result["segments"]) == 1
    assert result["segments"][0]["startSec"] == 0.1
    assert result["segments"][0]["endSec"] == 4.0
