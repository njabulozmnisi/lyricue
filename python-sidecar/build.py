"""Build the LyriCue sidecar executable with PyInstaller."""

from __future__ import annotations

import argparse
import platform
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


SIDECAR_ROOT = Path(__file__).resolve().parent
REPO_ROOT = SIDECAR_ROOT.parent


BuildMode = str  # "onefile" (default) or "onedir" (faster cold start)


@dataclass(frozen=True)
class BuildPlan:
    platform_key: str
    arch: str
    output_dir: Path
    executable: Path
    command: list[str]
    mode: BuildMode


def build_plan(
    *,
    output_root: Path = REPO_ROOT / "build" / "sidecar",
    platform_name: str | None = None,
    machine: str | None = None,
    python_executable: str = sys.executable,
    mode: BuildMode = "onefile",
) -> BuildPlan:
    if mode not in ("onefile", "onedir"):
        raise ValueError(f"Unsupported build mode: {mode!r}; expected 'onefile' or 'onedir'")
    platform_key = _platform_key(platform_name or sys.platform)
    arch = _arch_key(machine or platform.machine())
    output_dir = output_root / f"{platform_key}-{arch}"
    executable_name = "lyricue-sidecar.exe" if platform_key == "win32" else "lyricue-sidecar"
    # In onedir mode PyInstaller writes the executable into a subdirectory named after
    # the binary (lyricue-sidecar/). The host's sidecar-path-resolver checks both layouts.
    executable = (
        output_dir / executable_name
        if mode == "onefile"
        else output_dir / executable_name.removesuffix(".exe") / executable_name
    )
    work_dir = SIDECAR_ROOT / "build" / "pyinstaller" / f"{platform_key}-{arch}"
    spec_dir = work_dir / "spec"
    mode_flag = "--onefile" if mode == "onefile" else "--onedir"
    command = [
        python_executable,
        "-m",
        "PyInstaller",
        "--clean",
        "--noconfirm",
        mode_flag,
        "--collect-submodules",
        "whisperx",
        "--collect-submodules",
        "pyannote.audio",
        "--copy-metadata",
        "torchcodec",
        "--collect-data",
        "pyannote.audio",
        "--collect-data",
        "whisperx",
        "--name",
        executable_name.removesuffix(".exe"),
        "--distpath",
        str(output_dir),
        "--workpath",
        str(work_dir),
        "--specpath",
        str(spec_dir),
        str(SIDECAR_ROOT / "pyinstaller_entry.py"),
    ]
    return BuildPlan(
        platform_key=platform_key,
        arch=arch,
        output_dir=output_dir,
        executable=executable,
        command=command,
        mode=mode,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", type=Path, default=REPO_ROOT / "build" / "sidecar")
    parser.add_argument(
        "--mode",
        choices=["onefile", "onedir"],
        default="onefile",
        help=(
            "PyInstaller packaging mode. 'onefile' (default) produces a single executable that"
            " self-extracts to a temp dir at every launch (slower cold start, simpler distribution)."
            " 'onedir' produces a directory containing the executable plus its dependencies"
            " (faster cold start, more files to ship)."
        ),
    )
    parser.add_argument("--dry-run", action="store_true", help="Print the PyInstaller command without executing it.")
    args = parser.parse_args(argv)

    plan = build_plan(output_root=args.output_root, mode=args.mode)
    print(f"[sidecar-build] target={plan.platform_key}-{plan.arch}")
    print(f"[sidecar-build] executable={plan.executable}")
    print("[sidecar-build] command=" + " ".join(plan.command))
    if args.dry_run:
        return 0

    probe = subprocess.run(
        [sys.executable, "-m", "PyInstaller", "--version"],
        cwd=SIDECAR_ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if probe.returncode != 0:
        print(
            "[sidecar-build] PyInstaller is not installed for this Python; install python-sidecar[dev] first.",
            file=sys.stderr,
        )
        return 2

    plan.output_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(plan.command, cwd=SIDECAR_ROOT, check=True)
    if not plan.executable.exists():
        print(f"[sidecar-build] expected executable was not created: {plan.executable}", file=sys.stderr)
        return 1
    return 0


def _platform_key(value: str) -> str:
    if value.startswith("darwin"):
        return "darwin"
    if value.startswith("linux"):
        return "linux"
    if value in {"win32", "cygwin", "msys"}:
        return "win32"
    return value


def _arch_key(value: str) -> str:
    normalized = value.lower()
    if normalized in {"aarch64", "arm64"}:
        return "arm64"
    if normalized in {"x86_64", "amd64"}:
        return "x64"
    return normalized


if __name__ == "__main__":
    raise SystemExit(main())
