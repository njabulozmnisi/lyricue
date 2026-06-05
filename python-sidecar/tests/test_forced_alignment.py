"""EP-05 STORY-05.3 WhisperX forced-alignment stage tests."""

from __future__ import annotations

import logging
import sys

import pytest

from lyricue_sidecar.forced_alignment import (
    _forced_segments,
    _route_whisperx_logs_to_stderr,
    _safe_error_message,
    align_vocals,
)
from lyricue_sidecar.protocol import ERROR_ALIGNMENT_FAILED, JsonRpcError
from lyricue_sidecar.timing_map import parse_input_sections
from lyricue_sidecar.vocal_isolation import IsolatedVocals


def vocals() -> IsolatedVocals:
    return IsolatedVocals(samples=[0.1] * 16_000, sample_rate=16_000, model_name="htdemucs", rms=0.1)


def sections():
    return parse_input_sections(
        [
            {"id": "v1", "type": "verse", "label": "Verse 1", "text": "Amazing grace", "lines": ["Amazing grace"]},
        ]
    )


def test_align_vocals_uses_runner_result():
    def runner(_vocals, input_sections, language, model_name):
        from lyricue_sidecar.timing_map import AlignedWord

        assert language == "en"
        assert model_name == "small"
        return [
            AlignedWord("Amazing", 0, 500, 0.9, 0, 0),
            AlignedWord("grace", 520, 1100, 0.8, 0, 0),
        ]

    result = align_vocals(vocals(), sections(), language="en", model_name="small", runner=runner)

    assert result.model_name == "small"
    assert [word.text for word in result.words] == ["Amazing", "grace"]


def test_align_vocals_rejects_empty_alignment():
    with pytest.raises(JsonRpcError) as exc:
        align_vocals(vocals(), sections(), runner=lambda *_args: [])

    assert exc.value.code == ERROR_ALIGNMENT_FAILED
    assert exc.value.data["reason"] == "empty_alignment"


def test_align_vocals_wraps_runner_failure():
    with pytest.raises(JsonRpcError) as exc:
        align_vocals(
            vocals(), sections(), runner=lambda *_args: (_ for _ in ()).throw(RuntimeError("aligner exploded"))
        )

    assert exc.value.code == ERROR_ALIGNMENT_FAILED
    assert exc.value.data["reason"] == "alignment_failed"


def test_safe_error_message_preserves_chained_lazy_import_cause():
    try:
        try:
            raise ModuleNotFoundError("missing packaged dependency")
        except ModuleNotFoundError as err:
            raise RuntimeError(
                "Could not import module 'Pipeline'. Are this object's requirements defined correctly?"
            ) from err
    except RuntimeError as err:
        message = _safe_error_message(err)

    assert "Pipeline" in message
    assert "ModuleNotFoundError" in message
    assert "missing packaged dependency" in message


def test_route_whisperx_logs_to_stderr_preserves_json_rpc_stdout():
    logger = logging.getLogger("whisperx")
    original_handlers = logger.handlers[:]
    handler = logging.StreamHandler(sys.stdout)
    logger.handlers = [handler]
    try:
        _route_whisperx_logs_to_stderr()
        assert handler.stream is sys.stderr
    finally:
        logger.handlers = original_handlers


def test_forced_segments_replaces_transcription_text_with_known_lyrics():
    segments = _forced_segments(
        "Known lyric line",
        [{"start": 1.5, "end": 2.0, "text": "wrong"}, {"start": 2.0, "end": 4.25, "text": "also wrong"}],
        vocals(),
    )

    assert segments == [{"start": 1.5, "end": 4.25, "text": "Known lyric line"}]


def test_forced_segments_falls_back_to_vocal_duration_without_transcription():
    segments = _forced_segments("Known lyric line", [], vocals())

    assert segments == [{"start": 0.0, "end": 1.0, "text": "Known lyric line"}]
