"""Song-learning RPC handlers."""
from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping, Optional

from .audio_decode import decode_audio_file
from .protocol import ERROR_INVALID_PARAMS, JsonRpcError


def learn_song_handler(params: Optional[Mapping[str, Any]]) -> dict[str, Any]:
    """Run the currently implemented EP-05 learning stages.

    EP-05 lands in slices. This first handler executes STORY-05.1 only: validate,
    decode, and resample the supplied audio file. Later slices extend this method
    through Demucs, WhisperX, BPM detection, and TimingMap assembly.
    """

    if params is None:
        raise JsonRpcError(ERROR_INVALID_PARAMS, "learn_song params are required")

    audio_path = params.get("audioPath")
    if not isinstance(audio_path, str) or audio_path.strip() == "":
        raise JsonRpcError(ERROR_INVALID_PARAMS, "params.audioPath must be a non-empty string")

    job_id = params.get("jobId")
    if job_id is not None and not isinstance(job_id, str):
        raise JsonRpcError(ERROR_INVALID_PARAMS, "params.jobId must be a string if present")

    decoded = decode_audio_file(audio_path)
    return {
        "jobId": job_id,
        "stage": "audio_decoded",
        "audio": {
            "filename": Path(audio_path).name,
            "durationSeconds": decoded.duration_seconds,
            "sampleRate": decoded.sample_rate,
            "sampleCount": decoded.sample_count,
            "bytes": decoded.byte_size,
        },
    }
