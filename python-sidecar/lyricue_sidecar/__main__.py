"""LyriCue sidecar entry point.

Per architecture.md §4.2, the sidecar communicates with the Electron main process
via newline-delimited JSON-RPC 2.0 over stdin (requests) / stdout (responses + notifications).
stderr is reserved for logging — never used for protocol traffic.

At STORY-01.2 scaffold time, this is a minimal stub that:
  1. Emits the {"jsonrpc":"2.0","method":"ready"} notification on startup.
  2. Exits cleanly.

Full protocol handling, method registry, and learn_song / segment_rehearsal methods
land in EP-04 STORY-04.2 and EP-05.
"""

from __future__ import annotations

import json
import sys


def emit_notification(method: str, params: dict | None = None) -> None:
    """Write a JSON-RPC 2.0 notification (a message with no `id`) to stdout, one line."""
    msg: dict[str, object] = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        msg["params"] = params
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def main() -> int:
    """Sidecar entry. Returns process exit code."""
    # The Electron-side SidecarController.ensureRunning() waits for this notification
    # before considering the sidecar booted.
    emit_notification("ready", {"version": "0.1.0", "phase": "scaffold"})

    # Real request/response loop lands in STORY-04.2. For now we exit cleanly.
    return 0


if __name__ == "__main__":
    sys.exit(main())
