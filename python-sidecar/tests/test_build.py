"""Sidecar PyInstaller build-plan tests."""

from __future__ import annotations

from pathlib import Path

from build import build_plan


def test_build_plan_targets_standard_sidecar_layout(tmp_path: Path):
    plan = build_plan(
        output_root=tmp_path / "sidecar",
        platform_name="darwin",
        machine="arm64",
        python_executable="/venv/bin/python",
    )

    assert plan.platform_key == "darwin"
    assert plan.arch == "arm64"
    assert plan.output_dir == tmp_path / "sidecar" / "darwin-arm64"
    assert plan.executable == tmp_path / "sidecar" / "darwin-arm64" / "lyricue-sidecar"
    assert plan.command[:3] == ["/venv/bin/python", "-m", "PyInstaller"]
    assert "--onefile" in plan.command
    collected_submodules = [
        plan.command[index + 1] for index, item in enumerate(plan.command) if item == "--collect-submodules"
    ]
    assert collected_submodules == ["whisperx", "pyannote.audio"]
    assert plan.command[plan.command.index("--copy-metadata") + 1] == "torchcodec"
    collected_data = [plan.command[index + 1] for index, item in enumerate(plan.command) if item == "--collect-data"]
    assert collected_data == ["pyannote.audio", "whisperx"]
    assert str(plan.output_dir) in plan.command
    assert plan.command[-1].endswith("pyinstaller_entry.py")


def test_build_plan_uses_windows_executable_suffix(tmp_path: Path):
    plan = build_plan(
        output_root=tmp_path / "sidecar",
        platform_name="win32",
        machine="AMD64",
    )

    assert plan.output_dir == tmp_path / "sidecar" / "win32-x64"
    assert plan.executable == tmp_path / "sidecar" / "win32-x64" / "lyricue-sidecar.exe"
