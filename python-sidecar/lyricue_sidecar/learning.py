"""Song-learning RPC handlers."""
from __future__ import annotations

from typing import Any, Mapping, Optional

from .audio_decode import decode_audio_file
from .bpm import detect_bpm
from .forced_alignment import DEFAULT_WHISPERX_MODEL, align_vocals
from .jobs import jobs
from .protocol import ERROR_INVALID_PARAMS, JsonRpcError
from .timing_map import assemble_timing_map, deterministic_align, parse_input_sections, propose_sections
from .vocal_isolation import DEFAULT_DEMUCS_MODEL, isolate_vocals


def learn_song_handler(params: Optional[Mapping[str, Any]]) -> dict[str, Any]:
    """Run the currently implemented EP-05 learning stages.

    The local pipeline is deterministic and fully offline: decode/resample audio,
    estimate BPM, align the provided structured lyrics across the source duration,
    and assemble a schema-compatible TimingMap. Heavy Demucs/WhisperX integrations
    slot into the same stage boundaries once model distribution is available.
    """

    if params is None:
        raise JsonRpcError(ERROR_INVALID_PARAMS, "learn_song params are required")

    audio_path = params.get("audioPath")
    if not isinstance(audio_path, str) or audio_path.strip() == "":
        raise JsonRpcError(ERROR_INVALID_PARAMS, "params.audioPath must be a non-empty string")

    job_id = params.get("jobId")
    if job_id is not None and not isinstance(job_id, str):
        raise JsonRpcError(ERROR_INVALID_PARAMS, "params.jobId must be a string if present")

    show_id = params.get("showId")
    if not isinstance(show_id, str) or show_id.strip() == "":
        raise JsonRpcError(ERROR_INVALID_PARAMS, "params.showId must be a non-empty string")

    options = params.get("options")
    if options is not None and not isinstance(options, Mapping):
        raise JsonRpcError(ERROR_INVALID_PARAMS, "params.options must be an object if present")
    opts = options if isinstance(options, Mapping) else {}
    language = opts.get("language", "en")
    if not isinstance(language, str) or language.strip() == "":
        raise JsonRpcError(ERROR_INVALID_PARAMS, "params.options.language must be a string if present")

    alignment_mode = _string_option(opts, "alignmentMode", "deterministic")
    if alignment_mode not in {"deterministic", "production"}:
        raise JsonRpcError(ERROR_INVALID_PARAMS, "params.options.alignmentMode must be 'deterministic' or 'production'")

    try:
        sections = parse_input_sections(params.get("lyrics"))
    except ValueError as err:
        raise JsonRpcError(ERROR_INVALID_PARAMS, str(err)) from err

    jobs.checkpoint(job_id)
    decoded = decode_audio_file(audio_path)
    jobs.checkpoint(job_id)

    bpm = detect_bpm(decoded.samples, decoded.sample_rate)
    jobs.checkpoint(job_id)

    demucs_model = _string_option(opts, "demucsModel", DEFAULT_DEMUCS_MODEL if alignment_mode == "production" else "deterministic-no-demucs")
    whisperx_model = _string_option(opts, "whisperxModel", DEFAULT_WHISPERX_MODEL if alignment_mode == "production" else "deterministic-aligner")

    vocals_diagnostics: dict[str, Any] | None = None
    if alignment_mode == "production":
        debug_path = opts.get("debugVocalsPath")
        if debug_path is not None and not isinstance(debug_path, str):
            raise JsonRpcError(ERROR_INVALID_PARAMS, "params.options.debugVocalsPath must be a string if present")
        vocals = isolate_vocals(decoded, model_name=demucs_model, debug_path=debug_path)
        jobs.checkpoint(job_id)
        aligned = align_vocals(vocals, sections, language=language.strip(), model_name=whisperx_model)
        aligned_words = aligned.words
        vocals_diagnostics = {
            "model": vocals.model_name,
            "rms": vocals.rms,
            **({"debugPath": vocals.debug_path} if vocals.debug_path else {}),
        }
    else:
        try:
            aligned_words = deterministic_align(sections, decoded.duration_seconds)
        except ValueError as err:
            raise JsonRpcError(ERROR_INVALID_PARAMS, str(err)) from err
    jobs.checkpoint(job_id)

    timing_map = assemble_timing_map(
        show_id=show_id.strip(),
        sections=sections,
        aligned_words=aligned_words,
        audio_path=audio_path,
        duration_seconds=decoded.duration_seconds,
        bpm=bpm,
        language=language.strip(),
        demucs_model=demucs_model,
        whisperx_model=whisperx_model,
    )

    result: dict[str, Any] = {
        "jobId": job_id,
        "stage": "timing_map_ready",
        "timingMap": timing_map,
        "diagnostics": {
            "alignmentMode": alignment_mode,
            "audio": {
                "filename": timing_map["learnedFrom"]["filename"],
                "durationSeconds": decoded.duration_seconds,
                "sampleRate": decoded.sample_rate,
                "sampleCount": decoded.sample_count,
                "bytes": decoded.byte_size,
            },
            **({"vocals": vocals_diagnostics} if vocals_diagnostics else {}),
        },
    }
    if opts.get("detectSections") is True:
        result["proposedSections"] = propose_sections(
            sections,
            aligned_words=aligned_words,
            samples=decoded.samples,
            sample_rate=decoded.sample_rate,
        )
    return {
        **result,
    }


def _string_option(options: Mapping[str, Any], key: str, fallback: str) -> str:
    value = options.get(key)
    return value.strip() if isinstance(value, str) and value.strip() else fallback
