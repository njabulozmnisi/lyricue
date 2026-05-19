"""TimingMap assembly for EP-05 STORY-05.5."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import re
from typing import Any, Mapping

SCHEMA_LYRICUE_TIMING_V1 = "lyricue-timing-v1"
SUPPORTED_SECTION_TYPES = {"verse", "chorus", "bridge", "pre-chorus", "tag", "intro", "outro", "other"}
WORD_RE = re.compile(r"[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)?")


@dataclass(frozen=True)
class InputSection:
    id: str
    type: str
    label: str
    text: str
    lines: list[str]


@dataclass(frozen=True)
class AlignedWord:
    text: str
    start_ms: int
    end_ms: int
    confidence: float | None
    section_index: int
    line_index: int


def parse_input_sections(raw: Any) -> list[InputSection]:
    if not isinstance(raw, list) or len(raw) == 0:
        raise ValueError("params.lyrics must be a non-empty list of sections")

    sections: list[InputSection] = []
    for idx, item in enumerate(raw):
        if not isinstance(item, Mapping):
            raise ValueError(f"params.lyrics[{idx}] must be an object")
        label = _non_empty_string(item.get("label"), f"params.lyrics[{idx}].label")
        text = _non_empty_string(item.get("text"), f"params.lyrics[{idx}].text")
        section_id = item.get("id")
        if not isinstance(section_id, str) or section_id.strip() == "":
            section_id = _slug(label) or f"section-{idx + 1}"
        section_type = item.get("type")
        if not isinstance(section_type, str) or section_type not in SUPPORTED_SECTION_TYPES:
            section_type = _type_from_label(label)
        raw_lines = item.get("lines")
        lines = [str(line).strip() for line in raw_lines] if isinstance(raw_lines, list) else []
        lines = [line for line in lines if line]
        if not lines:
            lines = [line.strip() for line in text.split("\n") if line.strip()]
        sections.append(InputSection(section_id, section_type, label, text, lines))
    return sections


def deterministic_align(sections: list[InputSection], duration_seconds: float) -> list[AlignedWord]:
    tokens: list[tuple[str, int, int]] = []
    for section_index, section in enumerate(sections):
        for line_index, line in enumerate(section.lines):
            for match in WORD_RE.finditer(line):
                tokens.append((match.group(0), section_index, line_index))

    if not tokens:
        raise ValueError("lyrics contain no alignable words")

    total_ms = max(int(duration_seconds * 1000), len(tokens) * 250)
    slot_ms = max(120, total_ms // len(tokens))
    word_ms = max(100, min(slot_ms - 20, 900))
    aligned: list[AlignedWord] = []
    for idx, (text, section_index, line_index) in enumerate(tokens):
        start = idx * slot_ms
        end = min(start + word_ms, total_ms)
        aligned.append(AlignedWord(text, start, end, 0.6, section_index, line_index))
    return aligned


def assemble_timing_map(
    *,
    show_id: str,
    sections: list[InputSection],
    aligned_words: list[AlignedWord],
    audio_path: str,
    duration_seconds: float,
    bpm: int | None,
    language: str,
    demucs_model: str,
    whisperx_model: str,
) -> dict[str, Any]:
    timing_sections: list[dict[str, Any]] = []

    for section_index, section in enumerate(sections):
        section_words = [word for word in aligned_words if word.section_index == section_index]
        words_payload = [
            {
                "text": word.text,
                "startMs": word.start_ms,
                "endMs": word.end_ms,
                "confidence": word.confidence,
                "lineIndex": word.line_index,
                **({"held": True} if word.end_ms - word.start_ms > 800 else {}),
            }
            for word in section_words
        ]

        lines_payload: list[dict[str, int]] = []
        for line_index in sorted({word.line_index for word in section_words}):
            line_words = [word for word in section_words if word.line_index == line_index]
            if not line_words:
                continue
            word_start = section_words.index(line_words[0])
            word_end = section_words.index(line_words[-1]) + 1
            lines_payload.append(
                {
                    "startMs": line_words[0].start_ms,
                    "endMs": line_words[-1].end_ms,
                    "wordStartIndex": word_start,
                    "wordEndIndex": word_end,
                }
            )

        start_ms = section_words[0].start_ms if section_words else 0
        end_ms = section_words[-1].end_ms if section_words else start_ms
        timing_sections.append(
            {
                "id": section.id,
                "type": section.type,
                "label": section.label,
                "slideIndex": section_index,
                "startMs": start_ms,
                "endMs": end_ms,
                "words": words_payload,
                "lines": lines_payload,
            }
        )

    return {
        "$schema": SCHEMA_LYRICUE_TIMING_V1,
        "showId": show_id,
        "learnedFrom": {
            "method": "studio",
            "filename": Path(audio_path).name,
            "duration": duration_seconds,
            "learnedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        },
        "bpm": bpm or 120,
        "timeSignature": "4/4",
        "language": language,
        "sections": timing_sections,
        "metadata": {
            "demucsModel": demucs_model,
            "whisperxModel": whisperx_model,
            "schemaVersion": "1",
            "version": "1.0.0",
        },
    }


def propose_sections(
    sections: list[InputSection],
    *,
    aligned_words: list[AlignedWord] | None = None,
    samples: Any = None,
    sample_rate: int | None = None,
) -> list[dict[str, Any]]:
    """Return best-effort section-type proposals from lyric repetition and audio energy."""

    counts: dict[str, int] = {}
    for section in sections:
        normalized = "\n".join(line.lower().strip() for line in section.lines)
        counts[normalized] = counts.get(normalized, 0) + 1

    energy_scores = _section_energy_scores(aligned_words, samples, sample_rate)
    proposals: list[dict[str, Any]] = []
    for section_index, section in enumerate(sections):
        normalized = "\n".join(line.lower().strip() for line in section.lines)
        reasons: list[str] = []
        if counts.get(normalized, 0) >= 2 and section.type != "chorus":
            reasons.append("repeated_lyrics")
        if energy_scores.get(section_index, 0.0) >= 1.35 and section.type in {"other", "verse", "tag"}:
            reasons.append("energy_spike")
        if reasons:
            proposals.append(
                {
                    "sectionId": section.id,
                    "suggestedType": "chorus",
                    "reason": "+".join(reasons),
                    **({"energyScore": round(energy_scores[section_index], 3)} if section_index in energy_scores else {}),
                }
            )
    return proposals


def _section_energy_scores(
    aligned_words: list[AlignedWord] | None,
    samples: Any,
    sample_rate: int | None,
) -> dict[int, float]:
    if not aligned_words or samples is None or not isinstance(sample_rate, int) or sample_rate <= 0:
        return {}

    try:
        import librosa  # type: ignore[import-not-found]
        import numpy as np  # type: ignore[import-not-found]
    except Exception:
        return {}

    try:
        arr = np.asarray(samples, dtype=float)
        if arr.size == 0:
            return {}
        hop_length = 512
        rms = librosa.feature.rms(y=arr, frame_length=2048, hop_length=hop_length)[0]
        if len(rms) == 0:
            return {}
        times_ms = librosa.frames_to_time(range(len(rms)), sr=sample_rate, hop_length=hop_length) * 1000
    except Exception:
        return {}

    section_ranges: dict[int, tuple[int, int]] = {}
    for word in aligned_words:
        existing = section_ranges.get(word.section_index)
        if existing is None:
            section_ranges[word.section_index] = (word.start_ms, word.end_ms)
        else:
            section_ranges[word.section_index] = (min(existing[0], word.start_ms), max(existing[1], word.end_ms))

    raw_scores: dict[int, float] = {}
    for section_index, (start_ms, end_ms) in section_ranges.items():
        if end_ms <= start_ms:
            continue
        mask = (times_ms >= start_ms) & (times_ms <= end_ms)
        if not mask.any():
            continue
        raw_scores[section_index] = float(np.mean(rms[mask]))

    if not raw_scores:
        return {}
    baseline = float(np.median(list(raw_scores.values())))
    if baseline <= 0:
        return {}
    return {section_index: score / baseline for section_index, score in raw_scores.items()}


def _non_empty_string(value: Any, field: str) -> str:
    if not isinstance(value, str) or value.strip() == "":
        raise ValueError(f"{field} must be a non-empty string")
    return value.strip()


def _type_from_label(label: str) -> str:
    lower = label.lower()
    for section_type in SUPPORTED_SECTION_TYPES:
        if lower.startswith(section_type):
            return section_type
    if lower.startswith("pre chorus"):
        return "pre-chorus"
    return "other"


def _slug(input_value: str) -> str:
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", input_value.lower()))
