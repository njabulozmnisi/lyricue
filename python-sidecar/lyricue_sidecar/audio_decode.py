"""Audio decode/resample stage for EP-05 STORY-05.1.

This module is deliberately independent from the JSON-RPC transport so later stages
can reuse the decoded audio directly in-process. The default loader is `librosa.load`
with the contract required by the epic: 16 kHz, mono samples.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Sequence

from .protocol import ERROR_AUDIO_DECODE_FAILED, JsonRpcError

TARGET_SAMPLE_RATE = 16_000
MAX_AUDIO_BYTES = 50 * 1024 * 1024
SUPPORTED_AUDIO_EXTENSIONS = frozenset({".mp3", ".wav", ".flac", ".ogg"})

AudioLoader = Callable[[str], tuple[Any, int]]


@dataclass(frozen=True)
class DecodedAudio:
    path: Path
    sample_rate: int
    duration_seconds: float
    sample_count: int
    byte_size: int


def decode_audio_file(
    audio_path: str | Path,
    *,
    loader: AudioLoader | None = None,
    max_bytes: int = MAX_AUDIO_BYTES,
) -> DecodedAudio:
    """Validate, decode, and resample an audio file to 16 kHz mono."""

    path = Path(audio_path).expanduser()
    if not path.exists() or not path.is_file():
        raise _decode_error("Audio file does not exist.", reason="missing_file", path=path)

    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_AUDIO_EXTENSIONS:
        raise _decode_error(
            "Unsupported audio file type.",
            reason="unsupported_extension",
            path=path,
            details={"extension": suffix or None, "supported": sorted(SUPPORTED_AUDIO_EXTENSIONS)},
        )

    byte_size = path.stat().st_size
    if byte_size > max_bytes:
        raise _decode_error(
            "Audio file is larger than the 50 MB song-learning limit.",
            reason="file_too_large",
            path=path,
            details={"bytes": byte_size, "maxBytes": max_bytes},
        )

    active_loader = loader or _librosa_loader
    try:
        samples, sample_rate = active_loader(str(path))
    except JsonRpcError:
        raise
    except Exception as err:  # noqa: BLE001 - decode failures must stay protocol-shaped.
        raise _decode_error(
            "Audio file could not be decoded.",
            reason="decode_failed",
            path=path,
            details={"exception": _safe_error_message(err)},
        ) from err

    if sample_rate != TARGET_SAMPLE_RATE:
        raise _decode_error(
            "Decoded audio did not use the required sample rate.",
            reason="unexpected_sample_rate",
            path=path,
            details={"sampleRate": sample_rate, "expectedSampleRate": TARGET_SAMPLE_RATE},
        )

    sample_count = _sample_count(samples)
    if sample_count <= 0:
        raise _decode_error("Audio file decoded to no samples.", reason="empty_audio", path=path)

    return DecodedAudio(
        path=path,
        sample_rate=sample_rate,
        duration_seconds=sample_count / sample_rate,
        sample_count=sample_count,
        byte_size=byte_size,
    )


def _librosa_loader(path: str) -> tuple[Any, int]:
    try:
        import librosa  # type: ignore[import-not-found]
    except Exception as err:  # noqa: BLE001 - import can fail due transitive native deps.
        raise _decode_error(
            "librosa is required for song-learning audio decode.",
            reason="missing_dependency",
            path=Path(path),
            details={"dependency": "librosa", "exception": _safe_error_message(err)},
        ) from err

    samples, sample_rate = librosa.load(path, sr=TARGET_SAMPLE_RATE, mono=True)
    return samples, int(sample_rate)


def _sample_count(samples: Any) -> int:
    shape = getattr(samples, "shape", None)
    if isinstance(shape, tuple) and len(shape) > 0:
        return int(shape[0])
    try:
        return len(samples)  # type: ignore[arg-type]
    except TypeError:
        if isinstance(samples, Sequence):
            return len(samples)
    return 0


def _decode_error(
    message: str,
    *,
    reason: str,
    path: Path,
    details: dict[str, Any] | None = None,
) -> JsonRpcError:
    data: dict[str, Any] = {"reason": reason, "path": str(path)}
    if details:
        data.update(details)
    return JsonRpcError(ERROR_AUDIO_DECODE_FAILED, message, data)


def _safe_error_message(err: BaseException) -> str:
    msg = str(err) or err.__class__.__name__
    msg = msg.replace("\n", " ").replace("\r", " ")
    return msg[:240]
