"""Release model staging tests."""

from __future__ import annotations

from pathlib import Path

from scripts.stage_release_models import stage_release_models


def test_stage_release_models_builds_loader_compatible_layout(tmp_path: Path):
    cache_home = tmp_path / "cache"
    demucs_remote = tmp_path / "demucs-remote"
    output = tmp_path / "out"

    demucs_remote.mkdir()
    (demucs_remote / "htdemucs.yaml").write_text("models: ['abc12345']\n", encoding="utf-8")
    _write(cache_home / "torch/hub/checkpoints/abc12345-deadbeef.th", b"demucs")
    _write(cache_home / "torch/hub/checkpoints/wav2vec2_fairseq_base_ls960_asr_ls960.pth", b"align")
    _write(cache_home / "huggingface/hub/models--Systran--faster-whisper-small/blobs/blob-a", b"asr-a")
    _write(cache_home / "huggingface/hub/models--Systran--faster-whisper-small/refs/main", b"snapshot")

    result = stage_release_models(output_root=output, cache_home=cache_home, demucs_remote_root=demucs_remote)

    assert (result.demucs_repo / "htdemucs.yaml").exists()
    assert (result.demucs_repo / "abc12345-deadbeef.th").exists()
    assert (result.align_model_dir / "wav2vec2_fairseq_base_ls960_asr_ls960.pth").exists()
    assert (result.whisperx_download_root / "models--Systran--faster-whisper-small/blobs/blob-a").exists()
    manifest = result.manifest_path.read_text(encoding="utf-8")
    assert "LYRICUE_MODEL_CACHE_ONLY" in manifest
    assert "demucs-abc12345" in manifest


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
