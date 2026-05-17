"""EP-05 STORY-05.1 audio decode/resample stage tests."""
from __future__ import annotations

import sys
from types import SimpleNamespace
from pathlib import Path

import pytest

from lyricue_sidecar.audio_decode import TARGET_SAMPLE_RATE, decode_audio_file
from lyricue_sidecar.protocol import ERROR_AUDIO_DECODE_FAILED, JsonRpcError


def write_audio_fixture(path: Path, size: int = 128) -> Path:
    path.write_bytes(b"x" * size)
    return path


def assert_decode_error(exc: pytest.ExceptionInfo[JsonRpcError], reason: str) -> None:
    assert exc.value.code == ERROR_AUDIO_DECODE_FAILED
    assert exc.value.data["reason"] == reason


def test_decodes_supported_file_with_16khz_mono_loader(tmp_path: Path):
    audio = write_audio_fixture(tmp_path / "song.wav")

    def loader(path: str):
        assert path == str(audio)
        return [0.0] * 32_000, TARGET_SAMPLE_RATE

    decoded = decode_audio_file(audio, loader=loader)

    assert decoded.path == audio
    assert decoded.sample_rate == TARGET_SAMPLE_RATE
    assert decoded.sample_count == 32_000
    assert decoded.duration_seconds == 2.0
    assert decoded.byte_size == 128


def test_default_loader_uses_librosa_16khz_mono_contract(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    audio = write_audio_fixture(tmp_path / "song.wav")
    calls: list[tuple[str, int, bool]] = []

    def fake_load(path: str, *, sr: int, mono: bool):
        calls.append((path, sr, mono))
        return [0.0] * TARGET_SAMPLE_RATE, sr

    monkeypatch.setitem(sys.modules, "librosa", SimpleNamespace(load=fake_load))

    decoded = decode_audio_file(audio)

    assert decoded.duration_seconds == 1.0
    assert calls == [(str(audio), TARGET_SAMPLE_RATE, True)]


@pytest.mark.parametrize("suffix", [".mp3", ".wav", ".flac", ".ogg", ".WAV"])
def test_accepts_supported_audio_extensions(tmp_path: Path, suffix: str):
    audio = write_audio_fixture(tmp_path / f"song{suffix}")

    decoded = decode_audio_file(audio, loader=lambda _path: ([0.0] * 16_000, TARGET_SAMPLE_RATE))

    assert decoded.duration_seconds == 1.0


def test_rejects_missing_file(tmp_path: Path):
    with pytest.raises(JsonRpcError) as exc:
        decode_audio_file(tmp_path / "missing.wav", loader=lambda _path: ([0.0], TARGET_SAMPLE_RATE))

    assert_decode_error(exc, "missing_file")


def test_rejects_unsupported_extension(tmp_path: Path):
    audio = write_audio_fixture(tmp_path / "song.aac")

    with pytest.raises(JsonRpcError) as exc:
        decode_audio_file(audio, loader=lambda _path: ([0.0], TARGET_SAMPLE_RATE))

    assert_decode_error(exc, "unsupported_extension")
    assert ".wav" in exc.value.data["supported"]


def test_rejects_file_over_size_limit_before_decode(tmp_path: Path):
    audio = write_audio_fixture(tmp_path / "too-big.mp3", size=11)

    with pytest.raises(JsonRpcError) as exc:
        decode_audio_file(audio, loader=lambda _path: ([0.0], TARGET_SAMPLE_RATE), max_bytes=10)

    assert_decode_error(exc, "file_too_large")
    assert exc.value.data["bytes"] == 11
    assert exc.value.data["maxBytes"] == 10


def test_rejects_unparseable_audio_from_loader(tmp_path: Path):
    audio = write_audio_fixture(tmp_path / "broken.flac")

    def loader(_path: str):
        raise RuntimeError("not an audio file")

    with pytest.raises(JsonRpcError) as exc:
        decode_audio_file(audio, loader=loader)

    assert_decode_error(exc, "decode_failed")
    assert "not an audio file" in exc.value.data["exception"]


def test_rejects_loader_that_does_not_resample_to_16khz(tmp_path: Path):
    audio = write_audio_fixture(tmp_path / "song.ogg")

    with pytest.raises(JsonRpcError) as exc:
        decode_audio_file(audio, loader=lambda _path: ([0.0] * 48_000, 48_000))

    assert_decode_error(exc, "unexpected_sample_rate")


def test_rejects_empty_decoded_audio(tmp_path: Path):
    audio = write_audio_fixture(tmp_path / "empty.wav")

    with pytest.raises(JsonRpcError) as exc:
        decode_audio_file(audio, loader=lambda _path: ([], TARGET_SAMPLE_RATE))

    assert_decode_error(exc, "empty_audio")
