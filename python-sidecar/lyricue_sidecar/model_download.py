"""Model cache and download manager for first-use ML weights."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin
from urllib.request import Request, urlopen

from .protocol import (
    ERROR_INVALID_PARAMS,
    ERROR_MODEL_NOT_FOUND,
    ERROR_PYTHON_RUNTIME,
    JsonRpcError,
    RequestContext,
)


@dataclass(frozen=True)
class ModelSpec:
    name: str
    version: str
    sha256: str
    url: str | None = None
    bytes: int | None = None
    artifact_name: str | None = None

    @property
    def cache_key(self) -> str:
        return f"{self.name}-{self.version}"

    @property
    def filename(self) -> str:
        return self.artifact_name or f"{self.cache_key}.bin"


def resolve_models_dir(models_dir: Optional[Path] = None) -> Path:
    if models_dir is not None:
        return models_dir
    from_env = os.environ.get("LYRICUE_MODELS_DIR")
    if from_env:
        return Path(from_env)
    return Path.home() / ".lyricue" / "models"


def make_ensure_models_handler(models_dir: Optional[Path] = None):
    """Build an `ensure_models` JSON-RPC handler.

    Params:
      {
        "models": [
          {
            "name": "htdemucs",
            "version": "v1",
            "sha256": "...",
            "url": "https://mirror/models/htdemucs-v1/htdemucs-v1.bin",
            "bytes": 123456
          }
        ],
        "mirrorUrl": "https://mirror.example/models/"
      }
    """

    def handler(params: Optional[Mapping[str, Any]], context: RequestContext | None = None) -> dict[str, Any]:
        specs, mirror_url = parse_ensure_models_params(params)
        results = ensure_models(specs, models_dir=resolve_models_dir(models_dir), mirror_url=mirror_url, context=context)
        return {"models": results}

    return handler


def parse_ensure_models_params(params: Optional[Mapping[str, Any]]) -> tuple[list[ModelSpec], str | None]:
    if params is None:
        raise JsonRpcError(ERROR_INVALID_PARAMS, "ensure_models params are required")
    raw_models = params.get("models")
    if not isinstance(raw_models, list) or not raw_models:
        raise JsonRpcError(ERROR_INVALID_PARAMS, "params.models must be a non-empty list")

    mirror_url = params.get("mirrorUrl")
    if mirror_url is not None and (not isinstance(mirror_url, str) or mirror_url.strip() == ""):
        raise JsonRpcError(ERROR_INVALID_PARAMS, "params.mirrorUrl must be a non-empty string if present")

    specs: list[ModelSpec] = []
    for index, raw in enumerate(raw_models):
        if not isinstance(raw, Mapping):
            raise JsonRpcError(ERROR_INVALID_PARAMS, f"params.models[{index}] must be an object")
        specs.append(_parse_model_spec(raw, index))
    return specs, mirror_url.strip() if isinstance(mirror_url, str) else None


def ensure_models(
    specs: Iterable[ModelSpec],
    *,
    models_dir: Path,
    mirror_url: str | None = None,
    context: RequestContext | None = None,
) -> list[dict[str, Any]]:
    models_dir.mkdir(parents=True, exist_ok=True)
    download_dir = models_dir / ".downloads"
    download_dir.mkdir(parents=True, exist_ok=True)

    results: list[dict[str, Any]] = []
    for spec in specs:
        target_dir = models_dir / spec.cache_key
        target_file = target_dir / spec.filename
        if target_file.exists() and _sha256_file(target_file) == spec.sha256.lower():
            _progress(context, "model_cached", spec, downloadedBytes=target_file.stat().st_size, totalBytes=target_file.stat().st_size)
            results.append(_result(spec, target_dir, target_file, "cached"))
            continue

        source_url = _resolve_url(spec, mirror_url)
        _progress(context, "model_download_start", spec, downloadedBytes=0, totalBytes=spec.bytes, sourceUrl=source_url)
        partial_file = download_dir / f"{spec.cache_key}-{spec.filename}.part"
        downloaded_file = _download_with_resume(source_url, partial_file, spec, context)
        digest = _sha256_file(downloaded_file)
        if digest != spec.sha256.lower():
            downloaded_file.unlink(missing_ok=True)
            raise JsonRpcError(
                ERROR_MODEL_NOT_FOUND,
                f"Checksum mismatch for model '{spec.cache_key}'.",
                {"model": spec.cache_key, "expectedSha256": spec.sha256.lower(), "actualSha256": digest},
            )

        target_dir.mkdir(parents=True, exist_ok=True)
        shutil.move(str(downloaded_file), target_file)
        metadata = {
            "name": spec.name,
            "version": spec.version,
            "cacheKey": spec.cache_key,
            "artifact": spec.filename,
            "sha256": digest,
            "sourceUrl": source_url,
            "bytes": target_file.stat().st_size,
        }
        (target_dir / "metadata.json").write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        _progress(context, "model_installed", spec, downloadedBytes=target_file.stat().st_size, totalBytes=target_file.stat().st_size)
        results.append(_result(spec, target_dir, target_file, "downloaded"))
    return results


def _parse_model_spec(raw: Mapping[str, Any], index: int) -> ModelSpec:
    name = _required_string(raw, "name", index)
    version = _required_string(raw, "version", index)
    sha256 = _required_string(raw, "sha256", index).lower()
    if len(sha256) != 64 or any(ch not in "0123456789abcdef" for ch in sha256):
        raise JsonRpcError(ERROR_INVALID_PARAMS, f"params.models[{index}].sha256 must be a lowercase SHA256 hex string")

    url = raw.get("url")
    if url is not None and (not isinstance(url, str) or url.strip() == ""):
        raise JsonRpcError(ERROR_INVALID_PARAMS, f"params.models[{index}].url must be a non-empty string if present")

    artifact_name = raw.get("artifactName")
    if artifact_name is not None and (not isinstance(artifact_name, str) or artifact_name.strip() == "" or "/" in artifact_name or "\\" in artifact_name):
        raise JsonRpcError(ERROR_INVALID_PARAMS, f"params.models[{index}].artifactName must be a simple filename if present")

    byte_count = raw.get("bytes")
    if byte_count is not None and (not isinstance(byte_count, int) or byte_count < 0):
        raise JsonRpcError(ERROR_INVALID_PARAMS, f"params.models[{index}].bytes must be a non-negative integer if present")

    return ModelSpec(
        name=name,
        version=version,
        sha256=sha256,
        url=url.strip() if isinstance(url, str) else None,
        bytes=byte_count,
        artifact_name=artifact_name.strip() if isinstance(artifact_name, str) else None,
    )


def _required_string(raw: Mapping[str, Any], key: str, index: int) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or value.strip() == "":
        raise JsonRpcError(ERROR_INVALID_PARAMS, f"params.models[{index}].{key} must be a non-empty string")
    return value.strip()


def _resolve_url(spec: ModelSpec, mirror_url: str | None) -> str:
    if spec.url:
        return spec.url
    configured = mirror_url or os.environ.get("LYRICUE_MODEL_MIRROR_URL")
    if not configured:
        raise JsonRpcError(ERROR_INVALID_PARAMS, f"Model '{spec.cache_key}' requires url or mirrorUrl")
    base = configured.rstrip("/") + "/"
    return urljoin(base, f"{quote(spec.cache_key)}/{quote(spec.filename)}")


def _download_with_resume(source_url: str, partial_file: Path, spec: ModelSpec, context: RequestContext | None) -> Path:
    partial_file.parent.mkdir(parents=True, exist_ok=True)
    existing_bytes = partial_file.stat().st_size if partial_file.exists() else 0
    if existing_bytes > 0 and _sha256_file(partial_file) == spec.sha256.lower():
        return partial_file
    headers = {"Range": f"bytes={existing_bytes}-"} if existing_bytes > 0 else {}
    request = Request(source_url, headers=headers)
    mode = "ab" if existing_bytes > 0 else "wb"

    try:
        with urlopen(request, timeout=30) as response:  # noqa: S310 — URL is operator/model-manifest configured.
            status = getattr(response, "status", 200)
            if existing_bytes > 0 and status == 200:
                existing_bytes = 0
                mode = "wb"
            total = _response_total_bytes(response.headers, existing_bytes, spec.bytes)
            written = existing_bytes
            with partial_file.open(mode) as out:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
                    written += len(chunk)
                    _progress(context, "model_download_progress", spec, downloadedBytes=written, totalBytes=total, sourceUrl=source_url)
    except HTTPError as err:
        raise JsonRpcError(ERROR_PYTHON_RUNTIME, f"Model download failed with HTTP {err.code}", {"model": spec.cache_key, "url": source_url}) from err
    except URLError as err:
        raise JsonRpcError(ERROR_PYTHON_RUNTIME, f"Model download failed: {err.reason}", {"model": spec.cache_key, "url": source_url}) from err

    return partial_file


def _response_total_bytes(headers: Mapping[str, str], existing_bytes: int, declared_bytes: int | None) -> int | None:
    content_range = headers.get("Content-Range")
    if content_range and "/" in content_range:
        try:
            return int(content_range.rsplit("/", 1)[1])
        except ValueError:
            return declared_bytes
    content_length = headers.get("Content-Length")
    if content_length is not None:
        try:
            return existing_bytes + int(content_length)
        except ValueError:
            return declared_bytes
    return declared_bytes


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _result(spec: ModelSpec, target_dir: Path, target_file: Path, status: str) -> dict[str, Any]:
    return {
        "name": spec.name,
        "version": spec.version,
        "cacheKey": spec.cache_key,
        "present": True,
        "status": status,
        "path": str(target_dir),
        "artifact": spec.filename,
        "bytes": target_file.stat().st_size,
        "sha256": spec.sha256.lower(),
    }


def _progress(context: RequestContext | None, stage: str, spec: ModelSpec, **params: Any) -> None:
    if context is not None:
        context.progress(stage, model=spec.name, version=spec.version, cacheKey=spec.cache_key, **params)
