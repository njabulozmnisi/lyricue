"""EP-05.8 opt-in production song-learning fixture.

This test is intentionally skipped by default because it runs the heavyweight Demucs/WhisperX
path and may download model assets into the operator's local ML cache.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from lyricue_sidecar.learning import learn_song_handler


FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "ep05-public-domain"
AUDIO_FIXTURE = FIXTURE_DIR / "amazing-grace-48s.wav"


@pytest.mark.skipif(
    os.environ.get("LYRICUE_RUN_ML_FIXTURE") != "1",
    reason="set LYRICUE_RUN_ML_FIXTURE=1 to run the heavyweight production ML fixture",
)
def test_production_learning_on_public_domain_amazing_grace_fixture():
    result = learn_song_handler(
        {
            "jobId": "ep05-production-fixture",
            "showId": "amazing-grace-public-domain",
            "audioPath": str(AUDIO_FIXTURE),
            "lyrics": [
                {
                    "id": "verse-1",
                    "type": "verse",
                    "label": "Verse 1",
                    "text": "Amazing grace how sweet the sound that saved a wretch like me I once was lost but now am found was blind but now I see",
                    "lines": [
                        "Amazing grace how sweet the sound",
                        "That saved a wretch like me",
                        "I once was lost but now am found",
                        "Was blind but now I see",
                    ],
                }
            ],
            "options": {
                "alignmentMode": "production",
                "language": "en",
                "demucsModel": "htdemucs",
                "whisperxModel": "small",
            },
        }
    )

    assert result["diagnostics"]["alignmentMode"] == "production"
    assert result["diagnostics"]["vocals"]["model"] == "htdemucs"
    timing_map = result["timingMap"]
    assert timing_map["$schema"] == "lyricue-timing-v1"
    assert timing_map["showId"] == "amazing-grace-public-domain"
    assert timing_map["metadata"]["demucsModel"] == "htdemucs"
    assert timing_map["metadata"]["whisperxModel"] == "small"

    words = timing_map["sections"][0]["words"]
    assert len(words) >= 20
    assert [word["text"].lower() for word in words[:2]] == ["amazing", "grace"]
    assert all(0 <= word["startMs"] < word["endMs"] <= 48_500 for word in words)
    assert all(left["endMs"] <= right["startMs"] for left, right in zip(words, words[1:]))

    confident_words = [
        word for word in words if isinstance(word.get("confidence"), (int, float)) and word["confidence"] >= 0.5
    ]
    assert len(confident_words) / len(words) >= 0.85
