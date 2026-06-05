"""WhisperX forced-alignment stage for EP-05 STORY-05.3."""

from __future__ import annotations

import logging
import sys
from contextlib import redirect_stdout
from dataclasses import dataclass
from typing import Any, Callable

from .protocol import ERROR_ALIGNMENT_FAILED, JsonRpcError
from .timing_map import AlignedWord, InputSection, WORD_RE
from .vocal_isolation import IsolatedVocals

DEFAULT_WHISPERX_MODEL = "small"

WhisperXRunner = Callable[[IsolatedVocals, list[InputSection], str, str], list[AlignedWord]]


@dataclass(frozen=True)
class ForcedAlignmentResult:
    words: list[AlignedWord]
    model_name: str
    language: str


def align_vocals(
    vocals: IsolatedVocals,
    sections: list[InputSection],
    *,
    language: str = "en",
    model_name: str = DEFAULT_WHISPERX_MODEL,
    runner: WhisperXRunner | None = None,
    download_root: str | None = None,
    align_model_name: str | None = None,
    align_model_dir: str | None = None,
    model_cache_only: bool = False,
) -> ForcedAlignmentResult:
    """Align isolated vocals against known lyrics using WhisperX."""

    active_runner = runner or _run_whisperx
    try:
        words = (
            active_runner(vocals, sections, language, model_name)
            if runner
            else _run_whisperx(
                vocals,
                sections,
                language,
                model_name,
                download_root=download_root,
                align_model_name=align_model_name,
                align_model_dir=align_model_dir,
                model_cache_only=model_cache_only,
            )
        )
    except JsonRpcError:
        raise
    except Exception as err:  # noqa: BLE001 - model/native failures must stay protocol-shaped.
        raise _alignment_error(
            "WhisperX forced alignment failed.",
            reason="alignment_failed",
            details={"model": model_name, "language": language, "exception": _safe_error_message(err)},
        ) from err

    if not words:
        raise _alignment_error(
            "WhisperX returned no aligned words.",
            reason="empty_alignment",
            details={"model": model_name, "language": language},
        )
    return ForcedAlignmentResult(words=words, model_name=model_name, language=language)


def _run_whisperx(
    vocals: IsolatedVocals,
    sections: list[InputSection],
    language: str,
    model_name: str,
    *,
    download_root: str | None = None,
    align_model_name: str | None = None,
    align_model_dir: str | None = None,
    model_cache_only: bool = False,
) -> list[AlignedWord]:
    try:
        import whisperx  # type: ignore[import-not-found]
    except Exception as err:  # noqa: BLE001 - optional dependency may be absent.
        raise _alignment_error(
            "WhisperX dependencies are not installed.",
            reason="missing_dependency",
            details={"dependency": "whisperx", "exception": _safe_error_message(err)},
        ) from err

    try:
        _route_whisperx_logs_to_stderr()
        with redirect_stdout(sys.stderr):
            known_text = "\n".join(section.text for section in sections)
            model = whisperx.load_model(
                model_name,
                device="cpu",
                language=language,
                download_root=download_root,
                local_files_only=model_cache_only,
            )
            transcription = model.transcribe(vocals.samples, batch_size=8, language=language)
            segments = transcription.get("segments", [])
            if known_text.strip():
                segments = _forced_segments(known_text, segments, vocals)
            align_model, metadata = whisperx.load_align_model(
                language_code=language,
                device="cpu",
                model_name=align_model_name,
                model_dir=align_model_dir,
                model_cache_only=model_cache_only,
            )
            aligned = whisperx.align(
                segments,
                align_model,
                metadata,
                vocals.samples,
                "cpu",
                return_char_alignments=False,
            )
    except JsonRpcError:
        raise
    except Exception as err:  # noqa: BLE001 - convert to structured protocol error.
        raise _alignment_error(
            "WhisperX forced alignment failed.",
            reason="alignment_failed",
            details={"model": model_name, "language": language, "exception": _safe_error_message(err)},
        ) from err

    raw_words = aligned.get("word_segments") if isinstance(aligned, dict) else None
    if not isinstance(raw_words, list):
        raise _alignment_error(
            "WhisperX did not return word_segments.",
            reason="missing_word_segments",
            details={"model": model_name, "language": language},
        )
    return _map_whisperx_words(raw_words, sections)


def _forced_segments(known_text: str, transcription_segments: Any, vocals: IsolatedVocals) -> list[dict[str, Any]]:
    if isinstance(transcription_segments, list) and transcription_segments:
        first = transcription_segments[0] if isinstance(transcription_segments[0], dict) else {}
        last = transcription_segments[-1] if isinstance(transcription_segments[-1], dict) else {}
        start = first.get("start") if isinstance(first.get("start"), (int, float)) else 0.0
        end = last.get("end") if isinstance(last.get("end"), (int, float)) else _duration_seconds(vocals)
    else:
        start = 0.0
        end = _duration_seconds(vocals)
    return [{"start": float(start), "end": max(float(end), float(start)), "text": known_text}]


def _duration_seconds(vocals: IsolatedVocals) -> float:
    try:
        return max(0.0, len(vocals.samples) / vocals.sample_rate)
    except Exception:
        return 0.0


def _map_whisperx_words(raw_words: list[Any], sections: list[InputSection]) -> list[AlignedWord]:
    lyric_slots: list[tuple[str, int, int]] = []
    for section_index, section in enumerate(sections):
        for line_index, line in enumerate(section.lines):
            for match in WORD_RE.finditer(line):
                lyric_slots.append((match.group(0), section_index, line_index))

    mapped: list[AlignedWord] = []
    for index, slot in enumerate(lyric_slots):
        raw = raw_words[index] if index < len(raw_words) and isinstance(raw_words[index], dict) else {}
        start = _seconds_to_ms(raw.get("start"))
        end = _seconds_to_ms(raw.get("end"))
        confidence = _confidence(raw.get("score"))
        if start is None or end is None or end < start:
            start = end = 0
            confidence = None
        text, section_index, line_index = slot
        mapped.append(
            AlignedWord(
                text=text,
                start_ms=start,
                end_ms=end,
                confidence=confidence,
                section_index=section_index,
                line_index=line_index,
            )
        )
    return mapped


def _seconds_to_ms(value: Any) -> int | None:
    if not isinstance(value, (int, float)):
        return None
    return max(0, int(round(float(value) * 1000)))


def _confidence(value: Any) -> float | None:
    if not isinstance(value, (int, float)):
        return None
    return max(0.0, min(1.0, float(value)))


def _alignment_error(message: str, *, reason: str, details: dict[str, Any] | None = None) -> JsonRpcError:
    data: dict[str, Any] = {"reason": reason}
    if details:
        data.update(details)
    return JsonRpcError(ERROR_ALIGNMENT_FAILED, message, data)


def _route_whisperx_logs_to_stderr() -> None:
    for handler in logging.getLogger("whisperx").handlers:
        if isinstance(handler, logging.StreamHandler):
            handler.setStream(sys.stderr)


def _safe_error_message(err: BaseException) -> str:
    msg = str(err) or err.__class__.__name__
    chained = err.__cause__ or err.__context__
    if chained is not None:
        chained_msg = str(chained) or chained.__class__.__name__
        msg = f"{msg} | caused by {chained.__class__.__name__}: {chained_msg}"
    msg = msg.replace("\n", " ").replace("\r", " ")
    return msg[:240]
