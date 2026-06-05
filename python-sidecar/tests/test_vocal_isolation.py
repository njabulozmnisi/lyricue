"""EP-05 STORY-05.2 Demucs vocal-isolation stage tests."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from lyricue_sidecar.audio_decode import DecodedAudio, TARGET_SAMPLE_RATE
from lyricue_sidecar.protocol import ERROR_NO_VOCALS_DETECTED, ERROR_VOCAL_ISOLATION_FAILED, JsonRpcError
from lyricue_sidecar.vocal_isolation import _load_demucs_model, isolate_vocals


def decoded(samples) -> DecodedAudio:
    return DecodedAudio(
        path=Path("/tmp/song.wav"),
        samples=samples,
        sample_rate=TARGET_SAMPLE_RATE,
        duration_seconds=len(samples) / TARGET_SAMPLE_RATE,
        sample_count=len(samples),
        byte_size=128,
    )


def test_isolate_vocals_uses_runner_and_reports_rms():
    np = pytest.importorskip("numpy")
    source = decoded([0.1] * 16_000)

    result = isolate_vocals(
        source,
        model_name="htdemucs",
        runner=lambda _decoded, model: np.full(16_000, 0.25 if model == "htdemucs" else 0.0),
    )

    assert result.model_name == "htdemucs"
    assert result.sample_rate == TARGET_SAMPLE_RATE
    assert result.rms == pytest.approx(0.25, abs=0.001)


def test_isolate_vocals_rejects_low_rms_output():
    np = pytest.importorskip("numpy")

    with pytest.raises(JsonRpcError) as exc:
        isolate_vocals(decoded([0.1] * 16_000), runner=lambda _decoded, _model: np.zeros(16_000))

    assert exc.value.code == ERROR_NO_VOCALS_DETECTED
    assert exc.value.data["reason"] == "no_vocals_detected"


def test_isolate_vocals_wraps_runner_failure():
    with pytest.raises(JsonRpcError) as exc:
        isolate_vocals(
            decoded([0.1] * 16_000),
            runner=lambda _decoded, _model: (_ for _ in ()).throw(RuntimeError("native failure")),
        )

    assert exc.value.code == ERROR_VOCAL_ISOLATION_FAILED
    assert exc.value.data["reason"] == "isolation_failed"


def test_load_demucs_model_enables_trusted_local_repo_load(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    seen: dict[str, str | None] = {}

    def fake_get_model(model_name: str, *, repo: Path | None):
        seen["model"] = model_name
        seen["repo"] = str(repo) if repo else None
        seen["flag"] = os.environ.get("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD")
        return object()

    monkeypatch.delenv("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", raising=False)

    _load_demucs_model(fake_get_model, "htdemucs", tmp_path)

    assert seen == {"model": "htdemucs", "repo": str(tmp_path), "flag": "1"}
    assert "TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD" not in os.environ


def test_load_demucs_model_preserves_existing_torch_load_flag(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    seen: dict[str, str | None] = {}

    def fake_get_model(_model_name: str, *, repo: Path | None):
        seen["flag"] = os.environ.get("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD")
        return object()

    monkeypatch.setenv("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", "custom")

    _load_demucs_model(fake_get_model, "htdemucs", tmp_path)

    assert seen["flag"] == "1"
    assert os.environ["TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD"] == "custom"
