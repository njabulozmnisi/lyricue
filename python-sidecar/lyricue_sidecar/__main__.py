"""LyriCue sidecar entry point.

Per architecture.md §4.2, the sidecar communicates with the Electron main process
via newline-delimited JSON-RPC 2.0 over stdin (requests) / stdout (responses + notifications).
stderr is reserved for logging — never used for protocol traffic.

Startup sequence:
  1. Construct the JsonRpcServer.
  2. Register built-in methods (ping, check_models, shutdown).
  3. Emit the `ready` notification with version + capability info.
  4. Enter the dispatch loop until stdin closes.

Real ML methods (learn_song, segment_rehearsal, transcribe_chunk) register here when
EP-05 / EP-08 land. The protocol layer is mature now — adding a method is one
register() call.
"""
from __future__ import annotations

import sys

from . import __version__
from .methods import make_check_models_handler, ping_handler, shutdown_handler
from .protocol import JsonRpcServer


def main() -> int:
    server = JsonRpcServer()

    server.register("ping", ping_handler)
    server.register("check_models", make_check_models_handler())
    server.register("shutdown", shutdown_handler)

    # The Electron-side SidecarController.ensureRunning() waits for this notification
    # before considering the sidecar booted.
    server.emit_notification(
        "ready",
        {
            "version": __version__,
            "phase": "ep04",
            "methods": ["ping", "check_models", "shutdown"],
        },
    )

    return server.serve()


if __name__ == "__main__":
    sys.exit(main())
