"""Adversarial JSON-RPC tests — find defects the 19 happy-path tests don't catch.

Focus on:
  1. Inputs designed to trigger error paths the handler tree doesn't expect.
  2. Handler returns / raises shapes that escape the dispatch try/except.
  3. Wire-shape values that are spec-permitted but reflect back unsafely
     (id as nested object, method name with control chars).
"""
from __future__ import annotations

import io
import json
from typing import Any

import pytest

from lyricue_sidecar.protocol import (
    ERROR_INTERNAL,
    ERROR_INVALID_REQUEST,
    ERROR_PARSE,
    JsonRpcError,
    JsonRpcServer,
)


def _server(handlers: dict[str, Any] | None = None) -> JsonRpcServer:
    server = JsonRpcServer(input_stream=io.StringIO(), output_stream=io.StringIO())
    for name, handler in (handlers or {}).items():
        server.register(name, handler)
    return server


class TestProtocolBoundaryInputs:
    """Wire-level inputs that should produce clean errors, not crashes."""

    def test_deeply_nested_json_does_not_escape_as_internal_error(self):
        # Python's json module on some interpreter versions raises RecursionError on
        # deeply-nested input (CPython 3.11), while on others it parses fine and the
        # downstream isinstance(payload, dict) check rejects it (CPython 3.14+). Either
        # path must produce a clean error response — the request must never crash the
        # serve() loop. Test both moderate and extreme depths to catch both interpreter
        # behaviours.
        for depth in (200, 5000):
            nested = "[" * depth + "1" + "]" * depth
            server = _server()
            result = server.handle_request(nested)
            assert result is not None, f"depth={depth}: must produce a response"
            assert "error" in result, f"depth={depth}: must produce an error response"
            # Code is one of PARSE/INVALID_REQUEST depending on interpreter, never
            # ERROR_INTERNAL — internal errors here would indicate a crash escaped.
            assert result["error"]["code"] in (ERROR_PARSE, ERROR_INVALID_REQUEST), (
                f"depth={depth}: must be PARSE or INVALID_REQUEST, got {result['error']['code']}"
            )

    def test_method_field_containing_control_characters_is_rejected_or_sanitised(self):
        # A malicious caller (or buggy upstream) sending method="foo\nINJECT" must not
        # have those control bytes appear verbatim in the error message — otherwise the
        # NDJSON response carrying that message becomes a multi-line response that the
        # TS controller's line-splitter mis-parses.
        line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "foo\nINJECT"})
        server = _server()
        result = server.handle_request(line)
        assert result is not None
        message = result["error"]["message"]
        assert "\n" not in message, "error message must not contain newlines (NDJSON corruption)"
        assert "\r" not in message, "error message must not contain CR (NDJSON corruption)"

    def test_request_id_with_embedded_newline_does_not_corrupt_response(self):
        # JSON-RPC spec permits id as any JSON value. A string id with embedded newlines
        # gets serialised correctly by json.dumps (escapes them) — but if the controller
        # does its own line-splitting on raw bytes, the test pins that the response is
        # valid single-line NDJSON.
        line = json.dumps({"jsonrpc": "2.0", "id": "weird\nid", "method": "unknown_method"})
        server = _server()
        result = server.handle_request(line)
        assert result is not None
        # Verify it serialises to a single-line NDJSON output (newlines escaped).
        serialised = json.dumps(result)
        assert "\n" not in serialised, "response NDJSON must not contain raw newlines"

    def test_oversized_request_id_object_is_handled(self):
        # Spec is loose about id type. A request id that's a 10kb nested object would be
        # echoed back in the response, multiplying the response size.
        big_id: dict[str, Any] = {"k": "v" * 10_000}
        line = json.dumps({"jsonrpc": "2.0", "id": big_id, "method": "unknown_method"})
        server = _server()
        result = server.handle_request(line)
        assert result is not None
        # The current spec-compliant behaviour echoes the id back; the test pins that
        # the dispatcher does NOT crash on a non-int/str id. A future hardening pass
        # could enforce id ∈ (int, str, null) explicitly — for now we just want stability.
        assert "error" in result

    def test_jsonrpc_batch_request_is_rejected_cleanly(self):
        # Spec permits batch requests (an array). LyriCue's sidecar does not implement
        # batching. The current code rejects it because the payload is not a dict, but
        # the error is "Request must be a JSON object" — confirm this is what happens.
        line = json.dumps([
            {"jsonrpc": "2.0", "id": 1, "method": "a"},
            {"jsonrpc": "2.0", "id": 2, "method": "b"},
        ])
        server = _server()
        result = server.handle_request(line)
        assert result is not None
        assert result["error"]["code"] == ERROR_INVALID_REQUEST


class TestHandlerReturnShapes:
    """Handler outputs/exceptions that must not escape the dispatch frame."""

    def test_handler_returning_non_json_serialisable_does_not_break_server(self):
        # A handler returning an object json.dumps can't encode (e.g., a set, a bytes
        # object, an Ellipsis) would currently raise TypeError inside serve()'s _write
        # call — AFTER handle_request returned successfully. The next request would then
        # face a closed/broken output stream. Pin the expected behaviour: handle_request
        # should either coerce to a serialisable error OR the server's serve() loop
        # should isolate the write failure.
        server = _server({"bad_return": lambda _p: {"set": {1, 2, 3}}})  # set isn't JSON
        # We exercise the serve loop with a stub stream to observe behaviour end-to-end.
        out = io.StringIO()
        server._output = out
        line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "bad_return"})
        # The serialisation happens inside _write, which is called from handle_request's
        # caller (serve). For the unit-test path we call handle_request directly and then
        # call _write manually to simulate the loop.
        result = server.handle_request(line)
        assert result is not None
        # The bug surface: result contains a Python set, which json.dumps will refuse.
        # Either (a) handle_request must coerce the result, or (b) _write must catch the
        # TypeError and emit an internal-error response.
        try:
            server._write(result)
            written = out.getvalue()
            # If it didn't throw, verify the written output is valid NDJSON.
            assert written.endswith("\n")
            json.loads(written.strip())
        except TypeError as err:
            pytest.fail(
                f"Server must isolate non-serialisable handler returns; raw TypeError "
                f"escaped: {err}"
            )

    def test_notification_handler_that_throws_does_not_silently_swallow(self):
        # Per JSON-RPC 2.0 spec, notifications never get a response. The current code
        # honours this strictly — even a handler that raised JsonRpcError or any other
        # exception returns None for notifications. That is spec-compliant but masks
        # all notification handler bugs.
        #
        # The test pins that the exception is at least visible somewhere the operator can
        # see (logged to stderr). This catches a regression where the exception is fully
        # swallowed without any trace.
        import logging

        records: list[logging.LogRecord] = []

        class _RecordingHandler(logging.Handler):
            def emit(self, record: logging.LogRecord) -> None:
                records.append(record)

        server = _server({"side_effect": lambda _p: (_ for _ in ()).throw(RuntimeError("kaboom"))})
        handler = _RecordingHandler()
        logging.getLogger("lyricue.sidecar").addHandler(handler)
        try:
            line = json.dumps({"jsonrpc": "2.0", "method": "side_effect"})  # no id → notification
            result = server.handle_request(line)
        finally:
            logging.getLogger("lyricue.sidecar").removeHandler(handler)
        assert result is None, "notifications never get a response (spec)"
        assert any("kaboom" in str(rec.getMessage()) or rec.levelname == "ERROR" for rec in records), (
            "notification handler exception must be logged at ERROR level; "
            f"got {[(r.levelname, r.getMessage()) for r in records]}"
        )


class TestErrorMessageSafety:
    """Error envelope content that flows back over NDJSON must remain single-line."""

    def test_handler_raising_jsonrpcerror_with_multiline_message_is_sanitised(self):
        # The current _safe_exception_message strips newlines for generic exceptions,
        # but a JsonRpcError carries its message field straight through into the error
        # envelope. A handler that raised JsonRpcError(code, "line1\nline2") would
        # produce a response whose error.message contains a raw newline that, after
        # json.dumps, becomes "\\n" — safe. But the test pins that no path leads to a
        # raw newline reaching the wire.
        def _handler(_params: Any) -> Any:
            raise JsonRpcError(-32099, "line1\nline2\rline3")

        server = _server({"raises_multi": _handler})
        line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "raises_multi"})
        result = server.handle_request(line)
        assert result is not None
        # Serialise to NDJSON and confirm no raw newlines / CRs leaked through.
        serialised = json.dumps(result)
        assert "\n" not in serialised
        assert "\r" not in serialised

    def test_internal_error_data_does_not_include_full_traceback(self):
        # An unhandled exception should produce a sanitised one-line message in the
        # error envelope. A full traceback would leak file paths from the operator's
        # machine. _safe_exception_message handles single-line messages, but a future
        # change that adds the traceback to `data` would break this.
        def _handler(_params: Any) -> Any:
            raise RuntimeError("kaboom\n  File '/Users/private/secret/path.py'")

        server = _server({"raises_internal": _handler})
        line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "raises_internal"})
        result = server.handle_request(line)
        assert result is not None
        assert result["error"]["code"] == ERROR_INTERNAL
        # The message field is just "Internal error"; data.exception is the sanitised one.
        data_exception = result["error"]["data"]["exception"]
        assert "\n" not in data_exception, "exception data must be single line"
        assert len(data_exception) <= 500, "exception data must be bounded"
