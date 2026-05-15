"""Subprocess-level smoke test for the sidecar entry (STORY-04.1 + 04.2)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent  # python-sidecar/


def test_sidecar_emits_ready_then_handles_ping():
    """Spawn the sidecar; send ping; verify ready notification + ping response, then EOF."""
    proc = subprocess.Popen(
        [sys.executable, "-m", "lyricue_sidecar"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=REPO_ROOT,
        text=True,
    )
    assert proc.stdin is not None
    assert proc.stdout is not None

    # Write a ping request, then close stdin to signal EOF and let the loop exit cleanly.
    proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping", "params": {"trace": "ok"}}) + "\n")
    proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 2, "method": "shutdown"}) + "\n")
    proc.stdin.close()

    stdout_data, _stderr_data = proc.communicate(timeout=10)
    exit_code = proc.returncode

    lines = [json.loads(l) for l in stdout_data.splitlines() if l.strip()]

    # Expected sequence:
    #   1. ready notification (no id)
    #   2. ping response (id=1)
    #   3. shutdown response (id=2)
    assert len(lines) == 3, f"unexpected line count: {lines}"

    ready = lines[0]
    assert "id" not in ready
    assert ready["method"] == "ready"
    assert "version" in ready["params"]
    assert "ping" in ready["params"]["methods"]

    ping_resp = lines[1]
    assert ping_resp["id"] == 1
    assert ping_resp["result"]["pong"] is True
    assert ping_resp["result"]["echo"] == {"trace": "ok"}

    shutdown_resp = lines[2]
    assert shutdown_resp["id"] == 2
    assert shutdown_resp["result"]["shuttingDown"] is True

    assert exit_code == 0
