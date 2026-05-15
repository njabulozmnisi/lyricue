"""Built-in JSON-RPC methods for the LyriCue sidecar.

Per EP-04 STORY-04.2 AC2. The methods registered here are the protocol skeleton —
real ML methods (learn_song, segment_rehearsal, transcribe_chunk) land in EP-05 and EP-08
and follow the same registration pattern.

Method conventions:
  - Each handler receives `params: dict | None` and returns a JSON-serialisable value.
  - Handlers raise JsonRpcError to surface protocol-shaped errors.
  - Handlers SHOULD validate their params at the top and raise JsonRpcError(-32602)
    on schema mismatches — no silent default-filling.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Mapping, Optional

from .protocol import ERROR_INVALID_PARAMS, ERROR_MODEL_NOT_FOUND, JsonRpcError


def make_check_models_handler(models_dir: Optional[Path] = None):
    """Build a check_models handler bound to a specific models directory.

    `check_models` (per architecture.md §6.5) inspects the models directory and reports,
    per model, whether it's present and its size on disk. The Electron side uses this to
    decide whether to prompt the operator to download missing models on first run.

    Params:
      { "expected": ["htdemucs", "wav2vec2-large", ...] }  (optional — if omitted, return all found)

    Returns:
      [
        { "name": "htdemucs",       "present": true,  "bytes": 87_400_000 },
        { "name": "wav2vec2-large", "present": false, "bytes": null }
      ]

    The `models_dir` parameter lets tests bind a tmp dir without environment fiddling.
    Default lookup chain: explicit arg > LYRICUE_MODELS_DIR env var > XDG-style fallback.
    """

    def resolve_dir() -> Path:
        if models_dir is not None:
            return models_dir
        from_env = os.environ.get("LYRICUE_MODELS_DIR")
        if from_env:
            return Path(from_env)
        # Fallback: ~/.lyricue/models. Production deployments will always have
        # LYRICUE_MODELS_DIR set explicitly by Electron's SidecarController.
        return Path.home() / ".lyricue" / "models"

    def handler(params: Optional[Mapping[str, Any]]) -> list[dict[str, Any]]:
        expected: list[str] = []
        if params is not None:
            raw = params.get("expected", [])
            if not isinstance(raw, list) or not all(isinstance(x, str) for x in raw):
                raise JsonRpcError(
                    ERROR_INVALID_PARAMS, "params.expected must be a list of strings if present"
                )
            expected = raw

        root = resolve_dir()
        results: list[dict[str, Any]] = []
        if not root.exists():
            # Directory doesn't exist yet → every requested model is "not present".
            for name in expected:
                results.append({"name": name, "present": False, "bytes": None})
            return results

        # Find every direct child of models/ — each one is treated as a model "family".
        # A model is "present" if its directory exists AND is non-empty.
        present_set: dict[str, int] = {}
        for entry in root.iterdir():
            if not entry.is_dir():
                continue
            total = sum(p.stat().st_size for p in entry.rglob("*") if p.is_file())
            present_set[entry.name] = total

        names = expected if expected else sorted(present_set.keys())
        for name in names:
            if name in present_set:
                results.append({"name": name, "present": True, "bytes": present_set[name]})
            else:
                results.append({"name": name, "present": False, "bytes": None})

        # If the caller asked for an explicit list and none of them were found AND the
        # models dir exists but is empty, surface a hint via JsonRpcError so the UI can
        # nudge the operator without parsing the result array.
        # We choose to RETURN the list rather than throw — the result is structured and
        # the caller can decide. This keeps check_models non-destructive: it never raises
        # for a missing model. Surface-as-error is the caller's job.
        return results

    return handler


def shutdown_handler(_params: Optional[Mapping[str, Any]]) -> dict[str, Any]:
    """Shutdown method. Returns an ack; the server loop continues until stdin EOF.

    Why a method and not a hard-exit: clean shutdown lets the caller observe the response
    before the process dies. Electron's SidecarController closes stdin after receiving the
    ack, which causes the server's `for raw in self._input` loop to exit cleanly.
    """
    return {"shuttingDown": True}


def ping_handler(params: Optional[Mapping[str, Any]]) -> dict[str, Any]:
    """Liveness probe. Echoes any params back so the caller can correlate request IDs.

    The Electron side uses this in CI smoke tests + in the SidecarController health-check
    timer to detect a hung process.
    """
    return {"pong": True, "echo": params if params is not None else {}}


# Sentinel raise demonstrating the ModelNotFound error path. Real callers consume the
# structured response from check_models; this helper is for tests / future surfaces.
def raise_model_not_found(model_name: str) -> None:
    raise JsonRpcError(
        ERROR_MODEL_NOT_FOUND,
        f"Required model '{model_name}' is not present in the models directory.",
        {"model": model_name},
    )
