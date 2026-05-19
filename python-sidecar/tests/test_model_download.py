"""Model download manager tests."""
from __future__ import annotations

import hashlib
from io import BytesIO
from pathlib import Path
from urllib.request import Request

import pytest

from lyricue_sidecar import model_download
from lyricue_sidecar.model_download import ModelSpec, ensure_models, make_ensure_models_handler, parse_ensure_models_params
from lyricue_sidecar.protocol import ERROR_INVALID_PARAMS, ERROR_MODEL_NOT_FOUND, JsonRpcError, RequestContext


class FakeResponse:
    def __init__(self, body: bytes, *, status: int = 200, headers: dict[str, str] | None = None):
        self._body = BytesIO(body)
        self.status = status
        self.headers = headers or {"Content-Length": str(len(body))}

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def read(self, size: int = -1) -> bytes:
        return self._body.read(size)


def progress_context():
    notifications: list[dict] = []

    def notify(method, params=None):
        if method == "progress":
            notifications.append(dict(params or {}))

    return RequestContext(request_id="model-req", notify=notify), notifications


def test_parse_rejects_missing_models():
    with pytest.raises(JsonRpcError) as exc:
        parse_ensure_models_params({})
    assert exc.value.code == ERROR_INVALID_PARAMS


def test_parse_builds_mirror_backed_spec():
    digest = hashlib.sha256(b"weights").hexdigest()
    specs, mirror_url = parse_ensure_models_params(
        {
            "mirrorUrl": "https://mirror.example/models",
            "models": [{"name": "htdemucs", "version": "v1", "sha256": digest, "bytes": 7}],
        }
    )
    assert mirror_url == "https://mirror.example/models"
    assert specs == [ModelSpec(name="htdemucs", version="v1", sha256=digest, bytes=7)]


def test_ensure_models_downloads_verifies_and_installs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    payload = b"model-weights"
    digest = hashlib.sha256(payload).hexdigest()
    seen_urls: list[str] = []

    def fake_urlopen(request: Request, timeout: int):
        seen_urls.append(request.full_url)
        assert timeout == 30
        return FakeResponse(payload)

    monkeypatch.setattr(model_download, "urlopen", fake_urlopen)
    context, notifications = progress_context()

    result = ensure_models(
        [ModelSpec(name="htdemucs", version="v1", sha256=digest, bytes=len(payload))],
        models_dir=tmp_path,
        mirror_url="https://mirror.example/models/",
        context=context,
    )

    target = tmp_path / "htdemucs-v1" / "htdemucs-v1.bin"
    assert target.read_bytes() == payload
    assert result == [
        {
            "name": "htdemucs",
            "version": "v1",
            "cacheKey": "htdemucs-v1",
            "present": True,
            "status": "downloaded",
            "path": str(tmp_path / "htdemucs-v1"),
            "artifact": "htdemucs-v1.bin",
            "bytes": len(payload),
            "sha256": digest,
        }
    ]
    assert seen_urls == ["https://mirror.example/models/htdemucs-v1/htdemucs-v1.bin"]
    assert [n["stage"] for n in notifications] == [
        "model_download_start",
        "model_download_progress",
        "model_installed",
    ]
    assert notifications[-1]["cacheKey"] == "htdemucs-v1"


def test_ensure_models_uses_cached_artifact_when_checksum_matches(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    payload = b"existing"
    digest = hashlib.sha256(payload).hexdigest()
    target_dir = tmp_path / "whisperx-small-v2"
    target_dir.mkdir()
    (target_dir / "weights.bin").write_bytes(payload)

    def fail_urlopen(_request: Request, _timeout: int):
        raise AssertionError("download should not run for a valid cache hit")

    monkeypatch.setattr(model_download, "urlopen", fail_urlopen)
    context, notifications = progress_context()

    result = ensure_models(
        [ModelSpec(name="whisperx-small", version="v2", sha256=digest, artifact_name="weights.bin")],
        models_dir=tmp_path,
        context=context,
    )

    assert result[0]["status"] == "cached"
    assert result[0]["bytes"] == len(payload)
    assert [n["stage"] for n in notifications] == ["model_cached"]


def test_ensure_models_resumes_partial_download(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    payload = b"0123456789"
    digest = hashlib.sha256(payload).hexdigest()
    partial = tmp_path / ".downloads" / "htdemucs-v1-htdemucs-v1.bin.part"
    partial.parent.mkdir()
    partial.write_bytes(payload[:4])
    ranges: list[str | None] = []

    def fake_urlopen(request: Request, timeout: int):
        requested_range = request.headers.get("Range")
        ranges.append(requested_range)
        assert requested_range == "bytes=4-"
        assert timeout == 30
        return FakeResponse(payload[4:], status=206, headers={"Content-Range": f"bytes 4-9/{len(payload)}"})

    monkeypatch.setattr(model_download, "urlopen", fake_urlopen)

    result = ensure_models(
        [ModelSpec(name="htdemucs", version="v1", sha256=digest, bytes=len(payload))],
        models_dir=tmp_path,
        mirror_url="https://mirror.example/models",
    )

    assert ranges == ["bytes=4-"]
    assert (tmp_path / "htdemucs-v1" / "htdemucs-v1.bin").read_bytes() == payload
    assert result[0]["status"] == "downloaded"


def test_ensure_models_rejects_checksum_mismatch(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(model_download, "urlopen", lambda _request, timeout: FakeResponse(b"wrong"))

    with pytest.raises(JsonRpcError) as exc:
        ensure_models(
            [ModelSpec(name="htdemucs", version="v1", sha256=hashlib.sha256(b"right").hexdigest())],
            models_dir=tmp_path,
            mirror_url="https://mirror.example/models",
        )

    assert exc.value.code == ERROR_MODEL_NOT_FOUND
    assert exc.value.data["model"] == "htdemucs-v1"


def test_ensure_models_handler_returns_protocol_shape(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    payload = b"handler-weights"
    digest = hashlib.sha256(payload).hexdigest()
    monkeypatch.setattr(model_download, "urlopen", lambda _request, timeout: FakeResponse(payload))

    handler = make_ensure_models_handler(models_dir=tmp_path)
    result = handler(
        {
            "models": [
                {
                    "name": "demucs",
                    "version": "v1",
                    "sha256": digest,
                    "url": "https://mirror.example/demucs-v1.bin",
                }
            ]
        }
    )

    assert result["models"][0]["cacheKey"] == "demucs-v1"
    assert result["models"][0]["present"] is True
