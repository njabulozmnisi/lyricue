"""Rehearsal-mode segmentation RPC handler."""
from __future__ import annotations

from typing import Any, Mapping, Optional

from .audio_decode import decode_audio_file
from .jobs import jobs
from .protocol import ERROR_INVALID_PARAMS, JsonRpcError


def segment_rehearsal_handler(params: Optional[Mapping[str, Any]]) -> dict[str, Any]:
    if params is None:
        raise JsonRpcError(ERROR_INVALID_PARAMS, "segment_rehearsal params are required")

    audio_path = params.get("audioPath")
    if not isinstance(audio_path, str) or audio_path.strip() == "":
        raise JsonRpcError(ERROR_INVALID_PARAMS, "params.audioPath must be a non-empty string")

    job_id = params.get("jobId")
    if job_id is not None and not isinstance(job_id, str):
        raise JsonRpcError(ERROR_INVALID_PARAMS, "params.jobId must be a string if present")

    setlist = params.get("setlist")
    if not isinstance(setlist, list) or not setlist:
        raise JsonRpcError(ERROR_INVALID_PARAMS, "params.setlist must be a non-empty list")

    options = params.get("options")
    if options is not None and not isinstance(options, Mapping):
        raise JsonRpcError(ERROR_INVALID_PARAMS, "params.options must be an object if present")
    opts = options if isinstance(options, Mapping) else {}
    threshold = float(opts.get("silenceThreshold", 0.02))
    min_segment_seconds = float(opts.get("minSegmentSeconds", 1.0))
    max_silence_seconds = float(opts.get("maxSilenceSeconds", 0.25))

    songs = [_read_song(item, index) for index, item in enumerate(setlist)]
    recognized = params.get("recognizedTextBySegment", [])
    if recognized is not None and (
        not isinstance(recognized, list) or not all(isinstance(item, str) for item in recognized)
    ):
        raise JsonRpcError(ERROR_INVALID_PARAMS, "params.recognizedTextBySegment must be a list of strings if present")
    decoded = decode_audio_file(audio_path)
    jobs.checkpoint(job_id)

    ranges = _active_ranges(decoded.samples, decoded.sample_rate, threshold, min_segment_seconds, max_silence_seconds)
    segments = []
    for index, (start, end) in enumerate(ranges):
        hint = recognized[index] if isinstance(recognized, list) and index < len(recognized) else ""
        match = _best_match(songs, hint, index)
        status = "matched" if match["confidence"] >= 0.3 else "review"
        segments.append(
            {
                "index": index,
                "startSec": round(start, 3),
                "endSec": round(end, 3),
                "status": status,
                "showId": match["showId"] if status == "matched" else None,
                "title": match["title"] if status == "matched" else None,
                "confidence": match["confidence"],
            }
        )

    return {
        "jobId": job_id,
        "stage": "segments_ready",
        "audio": {"durationSeconds": decoded.duration_seconds, "sampleRate": decoded.sample_rate},
        "segments": segments,
    }


def _read_song(item: Any, index: int) -> dict[str, Any]:
    if not isinstance(item, Mapping):
        raise JsonRpcError(ERROR_INVALID_PARAMS, f"params.setlist[{index}] must be an object")
    show_id = item.get("showId")
    title = item.get("title")
    lyrics = item.get("lyrics")
    if not isinstance(show_id, str) or not show_id.strip():
        raise JsonRpcError(ERROR_INVALID_PARAMS, f"params.setlist[{index}].showId must be a string")
    if not isinstance(title, str) or not title.strip():
        raise JsonRpcError(ERROR_INVALID_PARAMS, f"params.setlist[{index}].title must be a string")
    if not isinstance(lyrics, str):
        raise JsonRpcError(ERROR_INVALID_PARAMS, f"params.setlist[{index}].lyrics must be a string")
    return {"showId": show_id, "title": title, "tokens": set(_tokens(f"{title} {lyrics}"))}


def _active_ranges(
    samples: list[float],
    sample_rate: int,
    threshold: float,
    min_segment_seconds: float,
    max_silence_seconds: float,
):
    ranges = []
    start: int | None = None
    last_active: int | None = None
    min_samples = max(1, int(min_segment_seconds * sample_rate))
    max_silence_samples = max(1, int(max_silence_seconds * sample_rate))
    for index, sample in enumerate(samples):
        if abs(sample) >= threshold:
            if start is None:
                start = index
            last_active = index
            continue
        if start is not None and last_active is not None and index - last_active > max_silence_samples:
            end = last_active + 1
            if end - start >= min_samples:
                ranges.append((start / sample_rate, end / sample_rate))
            start = None
            last_active = None
    if start is not None and last_active is not None:
        end = last_active + 1
        if end - start >= min_samples:
            ranges.append((start / sample_rate, end / sample_rate))
    return ranges


def _best_match(songs: list[dict[str, Any]], recognized_text: str, segment_index: int) -> dict[str, Any]:
    recognized_tokens = set(_tokens(recognized_text))
    if recognized_tokens:
        scored = []
        for song in songs:
            expected = song["tokens"]
            confidence = len(recognized_tokens & expected) / max(1, len(recognized_tokens | expected))
            scored.append({**song, "confidence": round(confidence, 3)})
        return sorted(scored, key=lambda item: item["confidence"], reverse=True)[0]
    if segment_index < len(songs):
        song = songs[segment_index]
        return {**song, "confidence": 0.5}
    return {"showId": None, "title": None, "confidence": 0.0}


def _tokens(value: str) -> list[str]:
    return ["".join(ch for ch in word.lower() if ch.isalnum()) for word in value.split()]
