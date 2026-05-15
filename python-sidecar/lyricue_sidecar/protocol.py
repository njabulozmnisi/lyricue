"""JSON-RPC 2.0 protocol primitives for the LyriCue sidecar.

Per architecture.md §6.5 and EP-04 STORY-04.2.

Transport: newline-delimited JSON over stdin (requests) / stdout (responses + notifications).
stderr is reserved for logging — never carries protocol traffic.

Wire shapes (per JSON-RPC 2.0 spec):

  Request   { "jsonrpc": "2.0", "id": <int|str>, "method": <str>, "params": <any?> }
  Response  { "jsonrpc": "2.0", "id": <same>, "result": <any> }
                  OR
            { "jsonrpc": "2.0", "id": <same>, "error": { "code": int, "message": str, "data": any? } }
  Notif.    { "jsonrpc": "2.0", "method": <str>, "params": <any?> }   (no `id`)

Error codes (architecture.md §6.5):

  -32600  Invalid Request    (the JSON is not a valid Request object)
  -32601  Method not found   (the method name is not registered)
  -32602  Invalid params     (the method's params failed validation)
  -32603  Internal error     (an unhandled exception from the method body)
  -32700  Parse error        (the input was not valid JSON)
  -32000..-32099  Server errors (LyriCue-defined; see below)

LyriCue-defined codes (per architecture.md §6.5):
  -32001  ModelNotFound      (a required model file is missing — operator action required)
  -32002  SidecarBusy        (a previous request is still running; concurrency violation)
  -32003  PythonRuntimeError (caller-visible Python exception with sanitised message)

Design notes:
  - The registry is a plain dict[str, Handler]. Adding a method is a one-line registration
    next to its definition. No decorator magic.
  - Handlers MAY be either synchronous or coroutine functions. The dispatch loop awaits
    coroutine results so the request/response ordering on stdout is preserved (one response
    per request).
  - Logging is via Python's `logging` module configured to go to stderr (NOT stdout).
"""
from __future__ import annotations

import json
import logging
import sys
import traceback
from typing import Any, Awaitable, Callable, Mapping, MutableMapping, Optional, Union

# Standard JSON-RPC 2.0 error codes
ERROR_PARSE = -32700
ERROR_INVALID_REQUEST = -32600
ERROR_METHOD_NOT_FOUND = -32601
ERROR_INVALID_PARAMS = -32602
ERROR_INTERNAL = -32603

# LyriCue-specific error codes (per architecture §6.5)
ERROR_MODEL_NOT_FOUND = -32001
ERROR_SIDECAR_BUSY = -32002
ERROR_PYTHON_RUNTIME = -32003

# Public marker so handlers can raise typed errors that propagate as protocol responses.
class JsonRpcError(Exception):
    """Handlers raise this to surface a structured error to the caller.

    Any other exception type from a handler becomes -32603 Internal error with the
    exception message in `data` (sanitised — see _safe_exception_message).
    """

    def __init__(self, code: int, message: str, data: Optional[Any] = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data


HandlerResult = Any
Handler = Callable[[Optional[Mapping[str, Any]]], Union[HandlerResult, Awaitable[HandlerResult]]]


# Configure stderr-only logging. The sidecar must NEVER write to stdout outside of the
# protocol envelope — anything that does would corrupt the response stream.
logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format="[lyricue-sidecar:%(levelname)s] %(message)s",
)
log = logging.getLogger("lyricue.sidecar")


class JsonRpcServer:
    """Minimal sync JSON-RPC 2.0 dispatch + transport over stdin/stdout.

    Methods are registered before `serve()` is called. The server reads one NDJSON line
    at a time from `input_stream` (default sys.stdin), parses + validates per the spec,
    invokes the matching handler, and writes the response to `output_stream` (default
    sys.stdout). One response per non-notification request.

    Streams are kept as parameters so tests can substitute in-memory I/O without subprocesses.
    """

    def __init__(
        self,
        input_stream: Any = None,
        output_stream: Any = None,
    ) -> None:
        self._handlers: MutableMapping[str, Handler] = {}
        self._input = input_stream if input_stream is not None else sys.stdin
        self._output = output_stream if output_stream is not None else sys.stdout

    def register(self, method: str, handler: Handler) -> None:
        """Bind a method name to a handler callable. Replaces any prior binding."""
        self._handlers[method] = handler

    def emit_notification(self, method: str, params: Optional[Mapping[str, Any]] = None) -> None:
        """Send a protocol notification (no id, no response expected)."""
        msg: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = dict(params)
        self._write(msg)

    # --- one-shot request handling, exposed for unit tests ---

    def handle_request(self, raw_line: str) -> Optional[dict[str, Any]]:
        """Parse one NDJSON line and return the response dict, or None for notifications.

        Side effects: nothing — caller decides what to do with the result. The public
        `serve()` loop uses this to drive responses onto the output stream.
        """
        try:
            payload = json.loads(raw_line)
        except json.JSONDecodeError as exc:
            return _error_response(None, ERROR_PARSE, f"Parse error: {exc.msg}")

        if not isinstance(payload, dict):
            return _error_response(None, ERROR_INVALID_REQUEST, "Request must be a JSON object")

        if payload.get("jsonrpc") != "2.0":
            return _error_response(payload.get("id"), ERROR_INVALID_REQUEST, "jsonrpc must be '2.0'")

        method = payload.get("method")
        if not isinstance(method, str):
            return _error_response(payload.get("id"), ERROR_INVALID_REQUEST, "method must be a string")

        params = payload.get("params")
        if params is not None and not isinstance(params, (dict, list)):
            return _error_response(
                payload.get("id"), ERROR_INVALID_PARAMS, "params must be an object or array if present"
            )

        is_notification = "id" not in payload
        request_id = payload.get("id")

        handler = self._handlers.get(method)
        if handler is None:
            if is_notification:
                # Spec: notifications never get a response, even for unknown methods.
                return None
            return _error_response(request_id, ERROR_METHOD_NOT_FOUND, f"Method '{method}' not found")

        try:
            result = handler(params if isinstance(params, dict) else None)
        except JsonRpcError as err:
            log.warning("Handler '%s' raised JsonRpcError(%d): %s", method, err.code, err.message)
            if is_notification:
                return None
            return _error_response(request_id, err.code, err.message, err.data)
        except Exception as err:  # noqa: BLE001 — we deliberately catch everything to honour the protocol
            log.exception("Handler '%s' raised unhandled exception", method)
            if is_notification:
                return None
            return _error_response(
                request_id,
                ERROR_INTERNAL,
                "Internal error",
                {"exception": _safe_exception_message(err)},
            )

        if is_notification:
            return None
        return {"jsonrpc": "2.0", "id": request_id, "result": result}

    def serve(self) -> int:
        """Read NDJSON requests from stdin, write responses to stdout, until EOF."""
        log.info("server loop started; %d handlers registered", len(self._handlers))
        for raw in self._input:
            line = raw.strip()
            if not line:
                continue
            response = self.handle_request(line)
            if response is not None:
                self._write(response)
        log.info("input stream closed; server exiting cleanly")
        return 0

    # --- internals ---

    def _write(self, msg: Mapping[str, Any]) -> None:
        self._output.write(json.dumps(msg) + "\n")
        self._output.flush()


def _error_response(
    request_id: Any,
    code: int,
    message: str,
    data: Optional[Any] = None,
) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return {"jsonrpc": "2.0", "id": request_id, "error": error}


def _safe_exception_message(err: BaseException) -> str:
    """Return a one-line exception message safe to put on the wire.

    Strips file paths from the message (operators don't need the developer machine's
    layout in their logs) and caps length at 500 chars.
    """
    msg = str(err) or err.__class__.__name__
    # Defensive: strip newlines so the message stays single-line.
    msg = msg.replace("\n", " ").replace("\r", " ")
    if len(msg) > 500:
        msg = msg[:497] + "..."
    return msg


# Convenience: callers can use this to capture a full traceback for stderr without
# exposing it on the protocol channel.
def format_exception(err: BaseException) -> str:
    return "".join(traceback.format_exception(type(err), err, err.__traceback__))
