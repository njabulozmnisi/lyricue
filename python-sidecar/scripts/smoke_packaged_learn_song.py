#!/usr/bin/env python3
"""Release smoke for packaged sidecar production song learning."""

from __future__ import annotations

import argparse
import json
import platform
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any


DEFAULT_LYRICS = [
    {
        "id": "verse-1",
        "type": "verse",
        "label": "Verse 1",
        "text": "Amazing grace how sweet the sound that saved a wretch like me I once was lost but now am found was blind but now I see",
        "lines": [
            "Amazing grace how sweet the sound",
            "That saved a wretch like me",
            "I once was lost but now am found",
            "Was blind but now I see",
        ],
    }
]


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    summary = run_smoke(args)
    if args.output_json:
        args.output_json.parent.mkdir(parents=True, exist_ok=True)
        args.output_json.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0 if summary["status"] == "pass" else 1


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--binary",
        type=Path,
        default=repo_root / "build" / "sidecar" / platform_dir() / executable_name(),
        help="Packaged lyricue-sidecar executable to smoke.",
    )
    parser.add_argument(
        "--fixture",
        type=Path,
        default=repo_root / "python-sidecar" / "tests" / "fixtures" / "ep05-public-domain" / "amazing-grace-48s.wav",
        help="Public-domain WAV fixture.",
    )
    parser.add_argument("--ready-timeout-ms", type=int, default=180_000)
    parser.add_argument("--request-timeout-ms", type=int, default=420_000)
    parser.add_argument("--min-confidence-ratio", type=float, default=0.85)
    parser.add_argument("--output-json", type=Path)
    return parser.parse_args(argv)


def platform_dir() -> str:
    system = platform.system().lower()
    if system == "darwin":
        platform_key = "darwin"
    elif system == "windows":
        platform_key = "win32"
    elif system == "linux":
        platform_key = "linux"
    else:
        platform_key = sys.platform

    machine = platform.machine().lower()
    if machine in {"aarch64", "arm64"}:
        arch = "arm64"
    elif machine in {"amd64", "x86_64"}:
        arch = "x64"
    else:
        arch = machine
    return f"{platform_key}-{arch}"


def executable_name() -> str:
    return "lyricue-sidecar.exe" if platform.system().lower() == "windows" else "lyricue-sidecar"


def run_smoke(args: argparse.Namespace) -> dict[str, Any]:
    binary = args.binary.resolve()
    fixture = args.fixture.resolve()
    if not binary.exists():
        return failure("binary-missing", f"Packaged sidecar binary missing at {binary}")
    if not fixture.exists():
        return failure("fixture-missing", f"Audio fixture missing at {fixture}")

    started = time.monotonic()
    proc = subprocess.Popen(
        [str(binary)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    assert proc.stdin is not None
    assert proc.stdout is not None
    assert proc.stderr is not None

    stdout: queue.Queue[str] = queue.Queue()
    stderr_lines: list[str] = []
    stdout_thread = threading.Thread(target=read_lines, args=(proc.stdout, stdout), daemon=True)
    stderr_thread = threading.Thread(target=read_stderr, args=(proc.stderr, stderr_lines), daemon=True)
    stdout_thread.start()
    stderr_thread.start()

    invalid_stdout: list[str] = []
    progress_stages: list[str] = []
    ready_ms: int | None = None
    response: dict[str, Any] | None = None
    error: str | None = None

    try:
        ready = wait_for_message(stdout, invalid_stdout, args.ready_timeout_ms, started, lambda msg: msg.get("method") == "ready")
        ready_ms = elapsed_ms(started)
        if ready is None:
            return finish(proc, started, ready_ms, invalid_stdout, progress_stages, stderr_lines, None, "ready-timeout", "Timed out waiting for ready notification.")

        request_id = 1
        write_request(
            proc,
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "learn_song",
                "params": learn_song_params(fixture),
            },
        )

        deadline = time.monotonic() + args.request_timeout_ms / 1000
        while time.monotonic() < deadline:
            line_timeout = max(0.1, min(1.0, deadline - time.monotonic()))
            try:
                line = stdout.get(timeout=line_timeout)
            except queue.Empty:
                continue
            msg = parse_protocol_line(line, invalid_stdout)
            if msg is None:
                continue
            if msg.get("method") == "progress":
                params = msg.get("params")
                if isinstance(params, dict) and isinstance(params.get("stage"), str):
                    progress_stages.append(params["stage"])
                continue
            if msg.get("id") == request_id:
                response = msg
                break
        if response is None:
            error = "Timed out waiting for learn_song response."

        return finish(proc, started, ready_ms, invalid_stdout, progress_stages, stderr_lines, response, "request-timeout" if error else None, error, args.min_confidence_ratio)
    finally:
        if proc.poll() is None:
            terminate_process(proc)


def read_lines(stream: Any, out: queue.Queue[str]) -> None:
    for line in stream:
        out.put(line.rstrip("\n"))


def read_stderr(stream: Any, out: list[str]) -> None:
    for line in stream:
        out.append(line.rstrip("\n"))


def wait_for_message(
    stdout: queue.Queue[str],
    invalid_stdout: list[str],
    timeout_ms: int,
    started: float,
    predicate: Any,
) -> dict[str, Any] | None:
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        try:
            line = stdout.get(timeout=max(0.1, min(1.0, deadline - time.monotonic())))
        except queue.Empty:
            continue
        msg = parse_protocol_line(line, invalid_stdout)
        if msg is not None and predicate(msg):
            return msg
    return None


def parse_protocol_line(line: str, invalid_stdout: list[str]) -> dict[str, Any] | None:
    try:
        msg = json.loads(line)
    except json.JSONDecodeError:
        invalid_stdout.append(line)
        return None
    return msg if isinstance(msg, dict) else None


def write_request(proc: subprocess.Popen[str], payload: dict[str, Any]) -> None:
    assert proc.stdin is not None
    proc.stdin.write(json.dumps(payload) + "\n")
    proc.stdin.flush()


def learn_song_params(fixture: Path) -> dict[str, Any]:
    return {
        "jobId": "packaged-release-smoke",
        "showId": "amazing-grace-packaged-release-smoke",
        "audioPath": str(fixture),
        "lyrics": DEFAULT_LYRICS,
        "options": {
            "alignmentMode": "production",
            "language": "en",
            "detectSections": True,
            "demucsModel": "htdemucs",
            "whisperxModel": "small",
        },
    }


def finish(
    proc: subprocess.Popen[str],
    started: float,
    ready_ms: int | None,
    invalid_stdout: list[str],
    progress_stages: list[str],
    stderr_lines: list[str],
    response: dict[str, Any] | None,
    failure_code: str | None,
    error: str | None,
    min_confidence_ratio: float = 0.85,
) -> dict[str, Any]:
    timing_map = None
    response_error = None
    if response and isinstance(response.get("result"), dict):
        timing_map = response["result"].get("timingMap")
    elif response and isinstance(response.get("error"), dict):
        response_error = response["error"]

    words = timing_words(timing_map)
    confident_words = [word for word in words if isinstance(word.get("confidence"), (int, float)) and word["confidence"] >= 0.5]
    confidence_ratio = len(confident_words) / len(words) if words else 0.0
    required_stages = ["decode", "bpm", "demucs", "whisperx", "timing_map", "complete"]
    missing_stages = [stage for stage in required_stages if stage not in progress_stages]
    status = (
        "pass"
        if not failure_code
        and not error
        and response_error is None
        and not invalid_stdout
        and confidence_ratio >= min_confidence_ratio
        and not missing_stages
        and timing_map_schema(timing_map) == "lyricue-timing-v1"
        else "fail"
    )
    return {
        "status": status,
        "failureCode": failure_code,
        "error": error,
        "responseError": response_error,
        "readyMs": ready_ms,
        "totalMs": elapsed_ms(started),
        "invalidStdout": invalid_stdout,
        "progressStages": progress_stages,
        "missingStages": missing_stages,
        "wordCount": len(words),
        "confidentWordCount": len(confident_words),
        "confidenceRatio": confidence_ratio,
        "schema": timing_map_schema(timing_map),
        "stderrLineCount": len(stderr_lines),
        "nativeWarnings": native_warnings(stderr_lines),
        "exitCode": proc.poll(),
    }


def timing_words(timing_map: Any) -> list[dict[str, Any]]:
    if not isinstance(timing_map, dict):
        return []
    sections = timing_map.get("sections")
    if not isinstance(sections, list):
        return []
    words: list[dict[str, Any]] = []
    for section in sections:
        if not isinstance(section, dict) or not isinstance(section.get("words"), list):
            continue
        words.extend(word for word in section["words"] if isinstance(word, dict))
    return words


def timing_map_schema(timing_map: Any) -> str | None:
    return timing_map.get("$schema") if isinstance(timing_map, dict) and isinstance(timing_map.get("$schema"), str) else None


def native_warnings(stderr_lines: list[str]) -> list[str]:
    needles = ("torchcodec", "libtorchcodec", "libavutil", "libtorchaudio_sox", "_torchaudio_sox", "libsox")
    return [line for line in stderr_lines if any(needle in line for needle in needles)]


def failure(code: str, message: str) -> dict[str, Any]:
    return {
        "status": "fail",
        "failureCode": code,
        "error": message,
        "responseError": None,
        "readyMs": None,
        "totalMs": 0,
        "invalidStdout": [],
        "progressStages": [],
        "missingStages": [],
        "wordCount": 0,
        "confidentWordCount": 0,
        "confidenceRatio": 0.0,
        "schema": None,
        "stderrLineCount": 0,
        "nativeWarnings": [],
        "exitCode": None,
    }


def terminate_process(proc: subprocess.Popen[str]) -> None:
    try:
        write_request(proc, {"jsonrpc": "2.0", "id": "shutdown", "method": "shutdown"})
        proc.wait(timeout=5)
    except Exception:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)


def elapsed_ms(started: float) -> int:
    return round((time.monotonic() - started) * 1000)


if __name__ == "__main__":
    raise SystemExit(main())
