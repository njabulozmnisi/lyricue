"""Unit tests for the JSON-RPC 2.0 protocol layer (STORY-04.2)."""
from __future__ import annotations

import io
import json
from typing import Any

import pytest

from lyricue_sidecar.protocol import (
    ERROR_INTERNAL,
    ERROR_INVALID_PARAMS,
    ERROR_INVALID_REQUEST,
    ERROR_METHOD_NOT_FOUND,
    ERROR_PARSE,
    JsonRpcError,
    JsonRpcServer,
)


def _build_server(handlers: dict[str, Any]) -> JsonRpcServer:
    server = JsonRpcServer(input_stream=io.StringIO(), output_stream=io.StringIO())
    for name, handler in handlers.items():
        server.register(name, handler)
    return server


class TestHandleRequest:
    """Single-line request handling — the load-bearing dispatch logic."""

    def test_happy_path_request_response(self):
        server = _build_server({"echo": lambda params: {"got": params or {}}})
        line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "echo", "params": {"a": 1}})
        result = server.handle_request(line)
        assert result == {"jsonrpc": "2.0", "id": 1, "result": {"got": {"a": 1}}}

    def test_handler_returning_a_scalar(self):
        server = _build_server({"two_plus_two": lambda _p: 4})
        line = json.dumps({"jsonrpc": "2.0", "id": "x", "method": "two_plus_two"})
        result = server.handle_request(line)
        assert result == {"jsonrpc": "2.0", "id": "x", "result": 4}

    def test_notifications_have_no_response(self):
        called: list[bool] = []
        server = _build_server({"side_effect": lambda _p: called.append(True)})
        line = json.dumps({"jsonrpc": "2.0", "method": "side_effect"})
        result = server.handle_request(line)
        assert result is None
        assert called == [True]

    def test_unknown_method_returns_method_not_found(self):
        server = _build_server({})
        line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "missing"})
        result = server.handle_request(line)
        assert result is not None
        assert result["error"]["code"] == ERROR_METHOD_NOT_FOUND

    def test_unknown_method_as_notification_silently_dropped(self):
        server = _build_server({})
        line = json.dumps({"jsonrpc": "2.0", "method": "missing"})
        assert server.handle_request(line) is None

    def test_parse_error(self):
        server = _build_server({})
        result = server.handle_request("{ not valid json")
        assert result is not None
        assert result["id"] is None
        assert result["error"]["code"] == ERROR_PARSE

    def test_request_not_an_object_is_invalid(self):
        server = _build_server({})
        result = server.handle_request("[]")
        assert result is not None
        assert result["error"]["code"] == ERROR_INVALID_REQUEST

    def test_missing_jsonrpc_field_is_invalid(self):
        server = _build_server({})
        line = json.dumps({"id": 1, "method": "x"})
        result = server.handle_request(line)
        assert result is not None
        assert result["error"]["code"] == ERROR_INVALID_REQUEST

    def test_non_string_method_is_invalid(self):
        server = _build_server({})
        line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": 42})
        result = server.handle_request(line)
        assert result is not None
        assert result["error"]["code"] == ERROR_INVALID_REQUEST

    def test_params_must_be_object_or_array(self):
        server = _build_server({"x": lambda _p: None})
        line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "x", "params": "not-allowed"})
        result = server.handle_request(line)
        assert result is not None
        assert result["error"]["code"] == ERROR_INVALID_PARAMS

    def test_handler_jsonrpc_error_propagates_as_protocol_error(self):
        def handler(_p):
            raise JsonRpcError(-32001, "Model X missing", {"model": "X"})

        server = _build_server({"check": handler})
        line = json.dumps({"jsonrpc": "2.0", "id": 7, "method": "check"})
        result = server.handle_request(line)
        assert result is not None
        assert result["error"]["code"] == -32001
        assert result["error"]["message"] == "Model X missing"
        assert result["error"]["data"] == {"model": "X"}

    def test_handler_unexpected_exception_becomes_internal_error(self):
        def handler(_p):
            raise RuntimeError("boom")

        server = _build_server({"broken": handler})
        line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "broken"})
        result = server.handle_request(line)
        assert result is not None
        assert result["error"]["code"] == ERROR_INTERNAL
        # The exception message is sanitised into data, not on the wire as a raw stack.
        assert "exception" in result["error"]["data"]
        assert "boom" in result["error"]["data"]["exception"]

    def test_handler_exception_in_notification_silently_dropped(self):
        def handler(_p):
            raise RuntimeError("boom")

        server = _build_server({"broken": handler})
        line = json.dumps({"jsonrpc": "2.0", "method": "broken"})
        assert server.handle_request(line) is None

    def test_exception_message_is_truncated_for_safety(self):
        def handler(_p):
            raise RuntimeError("x" * 1000)

        server = _build_server({"broken": handler})
        line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "broken"})
        result = server.handle_request(line)
        assert result is not None
        msg = result["error"]["data"]["exception"]
        assert len(msg) <= 500
        assert msg.endswith("...")


class TestServeLoop:
    """End-to-end transport: feed NDJSON, capture stdout, assert one response per request."""

    def test_emits_responses_in_order_one_per_request(self):
        in_stream = io.StringIO(
            "\n".join(
                [
                    json.dumps({"jsonrpc": "2.0", "id": 1, "method": "echo", "params": {"v": 1}}),
                    json.dumps({"jsonrpc": "2.0", "id": 2, "method": "echo", "params": {"v": 2}}),
                ]
            )
            + "\n"
        )
        out_stream = io.StringIO()
        server = JsonRpcServer(input_stream=in_stream, output_stream=out_stream)
        server.register("echo", lambda p: p or {})

        server.serve()

        lines = [json.loads(l) for l in out_stream.getvalue().splitlines() if l]
        assert lines == [
            {"jsonrpc": "2.0", "id": 1, "result": {"v": 1}},
            {"jsonrpc": "2.0", "id": 2, "result": {"v": 2}},
        ]

    def test_notifications_produce_no_output(self):
        in_stream = io.StringIO(
            json.dumps({"jsonrpc": "2.0", "method": "noisy_log", "params": {"x": 1}}) + "\n"
        )
        out_stream = io.StringIO()
        server = JsonRpcServer(input_stream=in_stream, output_stream=out_stream)
        server.register("noisy_log", lambda _p: None)

        server.serve()
        assert out_stream.getvalue() == ""

    def test_blank_lines_are_ignored(self):
        in_stream = io.StringIO(
            "\n\n"
            + json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping"})
            + "\n\n\n"
        )
        out_stream = io.StringIO()
        server = JsonRpcServer(input_stream=in_stream, output_stream=out_stream)
        server.register("ping", lambda _p: "pong")
        server.serve()
        lines = [l for l in out_stream.getvalue().splitlines() if l]
        assert len(lines) == 1
        assert json.loads(lines[0])["result"] == "pong"

    def test_emit_notification_writes_to_output_stream(self):
        out_stream = io.StringIO()
        server = JsonRpcServer(input_stream=io.StringIO(), output_stream=out_stream)
        server.emit_notification("ready", {"version": "1.2.3"})
        payload = json.loads(out_stream.getvalue().strip())
        assert payload == {"jsonrpc": "2.0", "method": "ready", "params": {"version": "1.2.3"}}

    def test_context_handler_can_emit_tagged_progress_before_response(self):
        in_stream = io.StringIO(json.dumps({"jsonrpc": "2.0", "id": 42, "method": "work", "params": {"x": 1}}) + "\n")
        out_stream = io.StringIO()
        server = JsonRpcServer(input_stream=in_stream, output_stream=out_stream)

        def handler(params, context):
            context.progress("stage-a", value=params["x"])
            return {"ok": True}

        server.register_with_context("work", handler)
        server.serve()

        lines = [json.loads(l) for l in out_stream.getvalue().splitlines() if l]
        assert lines == [
            {"jsonrpc": "2.0", "method": "progress", "params": {"request_id": 42, "stage": "stage-a", "value": 1}},
            {"jsonrpc": "2.0", "id": 42, "result": {"ok": True}},
        ]


class TestRegisterSemantics:
    def test_register_replaces_prior_binding(self):
        server = _build_server({})
        server.register("x", lambda _p: 1)
        server.register("x", lambda _p: 2)
        result = server.handle_request(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "x"}))
        assert result == {"jsonrpc": "2.0", "id": 1, "result": 2}
