from __future__ import annotations

import importlib.util
from pathlib import Path
from types import SimpleNamespace


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "smoke_packaged_learn_song.py"
spec = importlib.util.spec_from_file_location("smoke_packaged_learn_song", SCRIPT_PATH)
assert spec and spec.loader
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


def test_finish_passes_clean_timing_map():
    response = {
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "timingMap": {
                "$schema": "lyricue-timing-v1",
                "sections": [
                    {
                        "words": [
                            {"text": "Amazing", "confidence": 0.91},
                            {"text": "grace", "confidence": 0.82},
                            {"text": "review", "confidence": 0.2},
                        ]
                    }
                ],
            }
        },
    }

    summary = smoke.finish(
        SimpleNamespace(poll=lambda: 0),
        started=0,
        ready_ms=100,
        invalid_stdout=[],
        progress_stages=["decode", "bpm", "demucs", "whisperx", "timing_map", "complete"],
        response=response,
        failure_code=None,
        error=None,
        min_confidence_ratio=0.66,
    )

    assert summary["status"] == "pass"
    assert summary["wordCount"] == 3
    assert summary["confidentWordCount"] == 2
    assert summary["schema"] == "lyricue-timing-v1"


def test_finish_fails_dirty_stdout():
    response = {
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "timingMap": {
                "$schema": "lyricue-timing-v1",
                "sections": [{"words": [{"text": "Amazing", "confidence": 0.95}]}],
            }
        },
    }

    summary = smoke.finish(
        SimpleNamespace(poll=lambda: None),
        started=0,
        ready_ms=100,
        invalid_stdout=["INFO not json"],
        progress_stages=["decode", "bpm", "demucs", "whisperx", "timing_map", "complete"],
        response=response,
        failure_code=None,
        error=None,
    )

    assert summary["status"] == "fail"
    assert summary["invalidStdout"] == ["INFO not json"]


def test_finish_fails_missing_progress_stage():
    response = {
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "timingMap": {
                "$schema": "lyricue-timing-v1",
                "sections": [{"words": [{"text": "Amazing", "confidence": 0.95}]}],
            }
        },
    }

    summary = smoke.finish(
        SimpleNamespace(poll=lambda: None),
        started=0,
        ready_ms=100,
        invalid_stdout=[],
        progress_stages=["decode", "bpm", "demucs", "whisperx", "timing_map"],
        response=response,
        failure_code=None,
        error=None,
    )

    assert summary["status"] == "fail"
    assert summary["missingStages"] == ["complete"]
