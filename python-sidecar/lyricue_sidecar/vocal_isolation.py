"""Demucs vocal-isolation stage for EP-05 STORY-05.2."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .audio_decode import DecodedAudio
from .protocol import ERROR_NO_VOCALS_DETECTED, ERROR_VOCAL_ISOLATION_FAILED, JsonRpcError

DEFAULT_DEMUCS_MODEL = "htdemucs"

DemucsRunner = Callable[[DecodedAudio, str], Any]


@dataclass(frozen=True)
class IsolatedVocals:
    samples: Any
    sample_rate: int
    model_name: str
    rms: float
    debug_path: str | None = None


def isolate_vocals(
    decoded: DecodedAudio,
    *,
    model_name: str = DEFAULT_DEMUCS_MODEL,
    runner: DemucsRunner | None = None,
    debug_path: str | Path | None = None,
    model_repo: str | Path | None = None,
    min_rms: float = 0.001,
) -> IsolatedVocals:
    """Run Demucs and return isolated vocal samples.

    The optional runner keeps the stage unit-testable without downloading a multi-hundred-MB
    model. Production uses the Demucs Python API and prefers MPS/CUDA when available.
    """

    active_runner = runner or _run_demucs
    try:
        vocals = (
            active_runner(decoded, model_name) if runner else _run_demucs(decoded, model_name, model_repo=model_repo)
        )
        arr, rms = _coerce_vocals(vocals)
    except JsonRpcError:
        raise
    except Exception as err:  # noqa: BLE001 - model/native failures must stay protocol-shaped.
        raise _vocal_error(
            "Demucs vocal isolation failed.",
            reason="isolation_failed",
            details={"model": model_name, "exception": _safe_error_message(err)},
        ) from err

    if rms < min_rms:
        raise JsonRpcError(
            ERROR_NO_VOCALS_DETECTED,
            "Demucs produced a vocal stem below the minimum RMS threshold.",
            {"reason": "no_vocals_detected", "model": model_name, "rms": rms, "minRms": min_rms},
        )

    written_debug_path: str | None = None
    if debug_path is not None:
        written_debug_path = _write_debug_wav(debug_path, arr, decoded.sample_rate)

    return IsolatedVocals(
        samples=arr,
        sample_rate=decoded.sample_rate,
        model_name=model_name,
        rms=rms,
        debug_path=written_debug_path,
    )


def _run_demucs(decoded: DecodedAudio, model_name: str, *, model_repo: str | Path | None = None) -> Any:
    try:
        import numpy as np  # type: ignore[import-not-found]
        import torch  # type: ignore[import-not-found]
        from demucs.apply import apply_model  # type: ignore[import-not-found]
        from demucs.pretrained import get_model  # type: ignore[import-not-found]
    except Exception as err:  # noqa: BLE001 - optional dependency may be absent.
        raise _vocal_error(
            "Demucs dependencies are not installed.",
            reason="missing_dependency",
            details={"dependency": "demucs", "exception": _safe_error_message(err)},
        ) from err

    device = _select_device(torch)
    try:
        repo_path = Path(model_repo) if model_repo is not None else None
        model = get_model(model_name, repo=repo_path)
        model.to(device)
        model.eval()
        mono = np.asarray(decoded.samples, dtype="float32")
        stereo = np.stack([mono, mono], axis=0)
        wav = torch.from_numpy(stereo).to(device)
        with torch.no_grad():
            sources = apply_model(model, wav[None], device=device, split=True, progress=False)[0]
        source_names = list(getattr(model, "sources", []))
        vocals_index = source_names.index("vocals") if "vocals" in source_names else len(source_names) - 1
        vocals = sources[vocals_index].mean(dim=0).detach().cpu().numpy()
        return vocals.astype("float32")
    except JsonRpcError:
        raise
    except RuntimeError as err:
        if device != "cpu" and _looks_like_oom(err):
            return _run_demucs_cpu(decoded, model_name, get_model, apply_model, np, torch, model_repo=model_repo)
        raise


def _run_demucs_cpu(
    decoded: DecodedAudio,
    model_name: str,
    get_model: Any,
    apply_model: Any,
    np: Any,
    torch: Any,
    *,
    model_repo: str | Path | None = None,
) -> Any:
    repo_path = Path(model_repo) if model_repo is not None else None
    model = get_model(model_name, repo=repo_path)
    model.to("cpu")
    model.eval()
    mono = np.asarray(decoded.samples, dtype="float32")
    stereo = np.stack([mono, mono], axis=0)
    wav = torch.from_numpy(stereo)
    with torch.no_grad():
        sources = apply_model(model, wav[None], device="cpu", split=True, progress=False)[0]
    source_names = list(getattr(model, "sources", []))
    vocals_index = source_names.index("vocals") if "vocals" in source_names else len(source_names) - 1
    return sources[vocals_index].mean(dim=0).detach().cpu().numpy().astype("float32")


def _select_device(torch: Any) -> str:
    if getattr(getattr(torch.backends, "mps", None), "is_available", lambda: False)():
        return "mps"
    if getattr(torch.cuda, "is_available", lambda: False)():
        return "cuda"
    return "cpu"


def _looks_like_oom(err: RuntimeError) -> bool:
    msg = str(err).lower()
    return "out of memory" in msg or "oom" in msg


def _coerce_vocals(vocals: Any) -> tuple[Any, float]:
    try:
        import numpy as np  # type: ignore[import-not-found]
    except Exception as err:  # noqa: BLE001 - numpy is required by the audio pipeline.
        raise _vocal_error(
            "NumPy is required for vocal isolation output validation.",
            reason="missing_dependency",
            details={"dependency": "numpy", "exception": _safe_error_message(err)},
        ) from err

    arr = np.asarray(vocals, dtype="float32")
    if arr.size == 0:
        raise _vocal_error("Demucs produced no samples.", reason="empty_output")
    if arr.ndim > 1:
        arr = np.mean(arr, axis=0).astype("float32")
    rms = float(np.sqrt(np.mean(np.square(arr))))
    return arr, rms


def _write_debug_wav(path: str | Path, samples: Any, sample_rate: int) -> str:
    try:
        import soundfile as sf  # type: ignore[import-not-found]
    except Exception as err:  # noqa: BLE001 - debug path is explicitly requested.
        raise _vocal_error(
            "soundfile is required to write a debug vocal WAV.",
            reason="missing_dependency",
            details={"dependency": "soundfile", "exception": _safe_error_message(err)},
        ) from err
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(target), samples, sample_rate)
    return str(target)


def _vocal_error(message: str, *, reason: str, details: dict[str, Any] | None = None) -> JsonRpcError:
    data: dict[str, Any] = {"reason": reason}
    if details:
        data.update(details)
    return JsonRpcError(ERROR_VOCAL_ISOLATION_FAILED, message, data)


def _safe_error_message(err: BaseException) -> str:
    msg = str(err) or err.__class__.__name__
    msg = msg.replace("\n", " ").replace("\r", " ")
    return msg[:240]
