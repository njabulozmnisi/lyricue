"""EP-05 song-learning RPC handler tests."""
from __future__ import annotations

from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

from lyricue_sidecar import learning
from lyricue_sidecar.audio_decode import DecodedAudio, TARGET_SAMPLE_RATE
from lyricue_sidecar.jobs import cancel_job_handler
from lyricue_sidecar.learning import learn_song_handler
from lyricue_sidecar.protocol import ERROR_INVALID_PARAMS, ERROR_JOB_CANCELLED, JsonRpcError
from lyricue_sidecar.timing_map import deterministic_align, parse_input_sections, propose_sections


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


def test_learn_song_requires_show_id():
    with pytest.raises(JsonRpcError) as exc:
        learn_song_handler({"jobId": "j1", "audioPath": "/tmp/song.wav", "lyrics": []})

    assert exc.value.code == ERROR_INVALID_PARAMS


def test_learn_song_returns_timing_map(monkeypatch: pytest.MonkeyPatch):
    def fake_decode(audio_path: str):
        assert audio_path == "/tmp/song.wav"
        return DecodedAudio(
            path=Path(audio_path),
            samples=[0.1] * 200_000,
            sample_rate=TARGET_SAMPLE_RATE,
            duration_seconds=12.5,
            sample_count=200_000,
            byte_size=4096,
        )

    monkeypatch.setattr(learning, "decode_audio_file", fake_decode)
    monkeypatch.setattr(learning, "detect_bpm", lambda _samples, _sample_rate: 96)

    result = learn_song_handler(
        {
            "jobId": "job-1",
            "showId": "show-1",
            "audioPath": "/tmp/song.wav",
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
        }
    )

    assert result["jobId"] == "job-1"
    assert result["stage"] == "timing_map_ready"
    assert result["diagnostics"]["alignmentMode"] == "deterministic"
    assert result["diagnostics"]["audio"]["sampleRate"] == TARGET_SAMPLE_RATE
    assert result["proposedSections"] == []

    timing_map = result["timingMap"]
    assert timing_map["$schema"] == "lyricue-timing-v1"
    assert timing_map["showId"] == "show-1"
    assert timing_map["bpm"] == 96
    assert timing_map["language"] == "en"
    assert timing_map["learnedFrom"]["filename"] == "song.wav"
    assert timing_map["sections"][0]["id"] == "verse-1"
    assert [word["text"] for word in timing_map["sections"][0]["words"]] == [
        "Amazing",
        "grace",
        "How",
        "sweet",
        "the",
        "sound",
    ]
    assert timing_map["sections"][0]["lines"] == [
        {"startMs": 0, "endMs": 2983, "wordStartIndex": 0, "wordEndIndex": 2},
        {"startMs": 4166, "endMs": 11315, "wordStartIndex": 2, "wordEndIndex": 6},
    ]


def test_cancelled_job_stops_at_checkpoint(monkeypatch: pytest.MonkeyPatch):
    cancel_job_handler({"jobId": "job-cancel"})

    with pytest.raises(JsonRpcError) as exc:
        learn_song_handler(
            {
                "jobId": "job-cancel",
                "showId": "show-1",
                "audioPath": "/tmp/song.wav",
                "lyrics": [{"label": "Verse 1", "text": "Line one", "lines": ["Line one"]}],
            }
        )

    assert exc.value.code == ERROR_JOB_CANCELLED


def test_detect_sections_uses_audio_energy_contours(monkeypatch: pytest.MonkeyPatch):
    np = pytest.importorskip("numpy")

    samples = np.concatenate(
        [
            np.full(16_000, 0.05, dtype=float),
            np.full(16_000, 0.8, dtype=float),
            np.full(16_000, 0.05, dtype=float),
        ]
    )

    def fake_decode(audio_path: str):
        return DecodedAudio(
            path=Path(audio_path),
            samples=samples,
            sample_rate=TARGET_SAMPLE_RATE,
            duration_seconds=3.0,
            sample_count=len(samples),
            byte_size=4096,
        )

    monkeypatch.setattr(learning, "decode_audio_file", fake_decode)
    monkeypatch.setattr(learning, "detect_bpm", lambda _samples, _sample_rate: 120)

    result = learn_song_handler(
        {
            "jobId": "job-energy",
            "showId": "show-energy",
            "audioPath": "/tmp/song.wav",
            "lyrics": [
                {"id": "v1", "type": "verse", "label": "Verse 1", "text": "quiet start", "lines": ["quiet start"]},
                {"id": "lift", "type": "other", "label": "Lift", "text": "loud refrain", "lines": ["loud refrain"]},
                {"id": "v2", "type": "verse", "label": "Verse 2", "text": "quiet end", "lines": ["quiet end"]},
            ],
            "options": {"detectSections": True},
        }
    )

    energy_proposals = [p for p in result["proposedSections"] if p["sectionId"] == "lift"]
    assert energy_proposals
    assert "energy_spike" in energy_proposals[0]["reason"]
    assert energy_proposals[0]["energyScore"] > 1.35


def test_detect_sections_is_best_effort_when_energy_analysis_fails(monkeypatch: pytest.MonkeyPatch):
    def raising_rms(**_kwargs):
        raise RuntimeError("rms unavailable")

    monkeypatch.setitem(
        sys.modules,
        "librosa",
        SimpleNamespace(
            feature=SimpleNamespace(rms=raising_rms),
            frames_to_time=lambda *_args, **_kwargs: [],
        ),
    )

    sections = parse_input_sections(
        [
            {"id": "a", "type": "verse", "label": "Verse A", "text": "same line", "lines": ["same line"]},
            {"id": "b", "type": "verse", "label": "Verse B", "text": "same line", "lines": ["same line"]},
        ]
    )
    aligned = deterministic_align(sections, 2.0)

    proposals = propose_sections(sections, aligned_words=aligned, samples=[0.1] * 32_000, sample_rate=TARGET_SAMPLE_RATE)

    assert proposals == [
        {"sectionId": "a", "suggestedType": "chorus", "reason": "repeated_lyrics"},
        {"sectionId": "b", "suggestedType": "chorus", "reason": "repeated_lyrics"},
    ]
