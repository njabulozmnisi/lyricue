"""Stage release-owned ML model caches for offline EP-05 validation."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import shutil
from dataclasses import dataclass
from pathlib import Path


SIDECAR_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SIDECAR_ROOT.parent


@dataclass(frozen=True)
class StagedArtifact:
    name: str
    path: Path
    bytes: int
    sha256: str


@dataclass(frozen=True)
class StageResult:
    output_root: Path
    demucs_repo: Path
    whisperx_download_root: Path
    align_model_dir: Path
    manifest_path: Path
    artifacts: list[StagedArtifact]


def stage_release_models(
    *,
    output_root: Path = REPO_ROOT / "build" / "models" / "release",
    cache_home: Path = Path.home() / ".cache",
    demucs_remote_root: Path | None = None,
    demucs_model: str = "htdemucs",
    whisperx_model_cache: str = "models--Systran--faster-whisper-small",
    align_checkpoint_name: str = "wav2vec2_fairseq_base_ls960_asr_ls960.pth",
) -> StageResult:
    output_root = output_root.resolve()
    cache_home = cache_home.resolve()
    demucs_root = demucs_remote_root or _demucs_remote_root()
    demucs_yaml = demucs_root / f"{demucs_model}.yaml"
    if not demucs_yaml.exists():
        raise FileNotFoundError(f"Demucs model YAML not found: {demucs_yaml}")

    output_root.mkdir(parents=True, exist_ok=True)
    demucs_repo = output_root / "demucs-repo"
    whisperx_download_root = output_root / "huggingface"
    align_model_dir = output_root / "torchaudio-checkpoints"
    demucs_repo.mkdir(parents=True, exist_ok=True)
    whisperx_download_root.mkdir(parents=True, exist_ok=True)
    align_model_dir.mkdir(parents=True, exist_ok=True)

    artifacts: list[StagedArtifact] = []

    staged_yaml = demucs_repo / demucs_yaml.name
    shutil.copy2(demucs_yaml, staged_yaml)
    artifacts.append(_artifact("demucs-yaml", staged_yaml))

    for signature in _demucs_signatures(demucs_yaml):
        checkpoint = _find_demucs_checkpoint(cache_home, signature)
        staged_checkpoint = demucs_repo / checkpoint.name
        shutil.copy2(checkpoint, staged_checkpoint)
        artifacts.append(_artifact(f"demucs-{signature}", staged_checkpoint))

    hf_source = cache_home / "huggingface" / "hub" / whisperx_model_cache
    if not hf_source.exists():
        raise FileNotFoundError(f"Faster-Whisper model cache not found: {hf_source}")
    hf_target = whisperx_download_root / whisperx_model_cache
    if hf_target.exists():
        shutil.rmtree(hf_target)
    shutil.copytree(hf_source, hf_target, symlinks=True)
    artifacts.extend(_artifacts_under("whisperx", hf_target / "blobs"))

    align_source = cache_home / "torch" / "hub" / "checkpoints" / align_checkpoint_name
    if not align_source.exists():
        raise FileNotFoundError(f"Alignment checkpoint not found: {align_source}")
    align_target = align_model_dir / align_checkpoint_name
    shutil.copy2(align_source, align_target)
    artifacts.append(_artifact("whisperx-align", align_target))

    manifest_path = output_root / "manifest.json"
    manifest = {
        "environment": {
            "LYRICUE_DEMUCS_REPO": str(demucs_repo),
            "LYRICUE_WHISPERX_DOWNLOAD_ROOT": str(whisperx_download_root),
            "LYRICUE_WHISPERX_ALIGN_MODEL_DIR": str(align_model_dir),
            "LYRICUE_MODEL_CACHE_ONLY": "1",
        },
        "artifacts": [
            {"name": item.name, "path": str(item.path), "bytes": item.bytes, "sha256": item.sha256}
            for item in artifacts
        ],
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    return StageResult(
        output_root=output_root,
        demucs_repo=demucs_repo,
        whisperx_download_root=whisperx_download_root,
        align_model_dir=align_model_dir,
        manifest_path=manifest_path,
        artifacts=artifacts,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", type=Path, default=REPO_ROOT / "build" / "models" / "release")
    parser.add_argument("--cache-home", type=Path, default=Path.home() / ".cache")
    args = parser.parse_args(argv)

    result = stage_release_models(output_root=args.output_root, cache_home=args.cache_home)
    print(f"[model-stage] output={result.output_root}")
    print(f"[model-stage] manifest={result.manifest_path}")
    for key, value in json.loads(result.manifest_path.read_text(encoding="utf-8"))["environment"].items():
        print(f"export {key}={json.dumps(value)}")
    return 0


def _demucs_remote_root() -> Path:
    from demucs import pretrained  # type: ignore[import-not-found]

    return Path(pretrained.REMOTE_ROOT)


def _demucs_signatures(yaml_path: Path) -> list[str]:
    models: list[str] | None = None
    for line in yaml_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped.startswith("models:"):
            continue
        raw_models = stripped.split(":", 1)[1].strip()
        parsed = ast.literal_eval(raw_models)
        models = parsed if isinstance(parsed, list) else None
        break
    if not isinstance(models, list) or not all(isinstance(item, str) and item for item in models):
        raise ValueError(f"Demucs model YAML has no model signatures: {yaml_path}")
    return models


def _find_demucs_checkpoint(cache_home: Path, signature: str) -> Path:
    checkpoint_dir = cache_home / "torch" / "hub" / "checkpoints"
    matches = sorted(checkpoint_dir.glob(f"{signature}-*.th"))
    if len(matches) != 1:
        raise FileNotFoundError(f"Expected one Demucs checkpoint for {signature} under {checkpoint_dir}")
    return matches[0]


def _artifacts_under(prefix: str, root: Path) -> list[StagedArtifact]:
    if not root.exists():
        raise FileNotFoundError(f"Expected staged artifact directory: {root}")
    return [
        _artifact(f"{prefix}-{path.name[:12]}", path)
        for path in sorted(path for path in root.iterdir() if path.is_file())
    ]


def _artifact(name: str, path: Path) -> StagedArtifact:
    return StagedArtifact(name=name, path=path, bytes=path.stat().st_size, sha256=_sha256_file(path))


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
