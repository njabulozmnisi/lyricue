"""Unit tests for the built-in JSON-RPC methods (ping, check_models, shutdown)."""
from __future__ import annotations

from pathlib import Path

import pytest

from lyricue_sidecar.methods import (
    make_check_models_handler,
    ping_handler,
    shutdown_handler,
)
from lyricue_sidecar.protocol import ERROR_INVALID_PARAMS, JsonRpcError


class TestPing:
    def test_returns_pong_with_empty_echo_when_no_params(self):
        result = ping_handler(None)
        assert result == {"pong": True, "echo": {}}

    def test_echoes_params_back(self):
        result = ping_handler({"trace": "abc"})
        assert result == {"pong": True, "echo": {"trace": "abc"}}


class TestShutdown:
    def test_returns_ack(self):
        assert shutdown_handler(None) == {"shuttingDown": True}


class TestCheckModels:
    def test_returns_empty_when_models_dir_does_not_exist(self, tmp_path: Path):
        handler = make_check_models_handler(models_dir=tmp_path / "missing")
        assert handler(None) == []

    def test_returns_empty_when_no_models_requested_and_dir_empty(self, tmp_path: Path):
        handler = make_check_models_handler(models_dir=tmp_path)
        assert handler(None) == []

    def test_reports_present_models_with_sizes(self, tmp_path: Path):
        htdemucs = tmp_path / "htdemucs"
        htdemucs.mkdir()
        (htdemucs / "model.bin").write_bytes(b"x" * 1024)
        (htdemucs / "config.json").write_bytes(b"y" * 64)

        whisperx = tmp_path / "wav2vec2-large"
        whisperx.mkdir()
        (whisperx / "weights.bin").write_bytes(b"z" * 2048)

        handler = make_check_models_handler(models_dir=tmp_path)
        result = handler(None)
        # Sorted by name.
        names = [r["name"] for r in result]
        assert names == ["htdemucs", "wav2vec2-large"]
        sizes = {r["name"]: r["bytes"] for r in result}
        assert sizes["htdemucs"] == 1024 + 64
        assert sizes["wav2vec2-large"] == 2048

    def test_reports_explicit_expected_list_with_missing_flagged(self, tmp_path: Path):
        htdemucs = tmp_path / "htdemucs"
        htdemucs.mkdir()
        (htdemucs / "model.bin").write_bytes(b"x" * 1024)

        handler = make_check_models_handler(models_dir=tmp_path)
        result = handler({"expected": ["htdemucs", "wav2vec2-large", "demucs-mdx"]})
        assert result == [
            {"name": "htdemucs", "present": True, "bytes": 1024},
            {"name": "wav2vec2-large", "present": False, "bytes": None},
            {"name": "demucs-mdx", "present": False, "bytes": None},
        ]

    def test_rejects_non_list_expected_param(self, tmp_path: Path):
        handler = make_check_models_handler(models_dir=tmp_path)
        with pytest.raises(JsonRpcError) as exc:
            handler({"expected": "htdemucs"})
        assert exc.value.code == ERROR_INVALID_PARAMS

    def test_rejects_list_with_non_string_entries(self, tmp_path: Path):
        handler = make_check_models_handler(models_dir=tmp_path)
        with pytest.raises(JsonRpcError) as exc:
            handler({"expected": [1, 2, 3]})
        assert exc.value.code == ERROR_INVALID_PARAMS

    def test_env_var_fallback_when_no_explicit_dir(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        models = tmp_path / "from-env"
        models.mkdir()
        m = models / "modelA"
        m.mkdir()
        (m / "x").write_bytes(b"a" * 16)
        monkeypatch.setenv("LYRICUE_MODELS_DIR", str(models))

        handler = make_check_models_handler()  # no explicit dir
        result = handler(None)
        assert result == [{"name": "modelA", "present": True, "bytes": 16}]
