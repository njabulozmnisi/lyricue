/**
 * JSON-RPC 2.0 wire shapes — the protocol the SidecarController speaks with the Python
 * subprocess. Mirrors `python-sidecar/lyricue_sidecar/protocol.py`.
 *
 * Per architecture.md §6.5 and EP-04 STORY-04.3.
 *
 * We define these shapes in `@lyricue/core` so any module that wants to talk to the
 * sidecar can use them — but only SidecarController actually spawns/owns the process.
 */

export type JsonRpcId = number | string

export interface JsonRpcRequest {
    jsonrpc: "2.0"
    id: JsonRpcId
    method: string
    params?: Record<string, unknown>
}

export interface JsonRpcNotification {
    jsonrpc: "2.0"
    method: string
    params?: Record<string, unknown>
}

export interface JsonRpcSuccessResponse<T = unknown> {
    jsonrpc: "2.0"
    id: JsonRpcId
    result: T
}

export interface JsonRpcErrorBody {
    code: number
    message: string
    data?: unknown
}

export interface JsonRpcErrorResponse {
    jsonrpc: "2.0"
    id: JsonRpcId | null
    error: JsonRpcErrorBody
}

export type JsonRpcResponse<T = unknown> = JsonRpcSuccessResponse<T> | JsonRpcErrorResponse

/** Standard JSON-RPC 2.0 error codes. */
export const RpcErrorCode = {
    PARSE: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL: -32603
} as const

/** LyriCue-specific error codes (per architecture §6.5). */
export const LyriCueRpcErrorCode = {
    MODEL_NOT_FOUND: -32001,
    SIDECAR_BUSY: -32002,
    PYTHON_RUNTIME: -32003
} as const

/** Errors thrown from request() when the response is an error. */
export class SidecarRpcError extends Error {
    constructor(
        public readonly code: number,
        message: string,
        public readonly data?: unknown
    ) {
        super(message)
        this.name = "SidecarRpcError"
    }
}

/** Errors thrown from ensureRunning() before any RPC is issued. */
export const SidecarLifecycleCode = {
    PYTHON_NOT_FOUND: "PYTHON_NOT_FOUND",
    PYTHON_VERSION_TOO_OLD: "PYTHON_VERSION_TOO_OLD",
    SIDECAR_FAILED_TO_START: "SIDECAR_FAILED_TO_START",
    SIDECAR_TIMED_OUT: "SIDECAR_TIMED_OUT",
    SIDECAR_CRASHED: "SIDECAR_CRASHED"
} as const

export type SidecarLifecycleCodeT = (typeof SidecarLifecycleCode)[keyof typeof SidecarLifecycleCode]

export class SidecarLifecycleError extends Error {
    constructor(
        public readonly code: SidecarLifecycleCodeT,
        message: string,
        public override readonly cause?: unknown
    ) {
        super(message)
        this.name = "SidecarLifecycleError"
    }
}

/**
 * Type guard: is this parsed line a JSON-RPC response (i.e., has either result or error)?
 * Notifications have a method instead.
 */
export function isJsonRpcResponse(msg: unknown): msg is JsonRpcResponse {
    if (typeof msg !== "object" || msg === null) return false
    const m = msg as Record<string, unknown>
    return m.jsonrpc === "2.0" && ("result" in m || "error" in m)
}

export function isJsonRpcNotification(msg: unknown): msg is JsonRpcNotification {
    if (typeof msg !== "object" || msg === null) return false
    const m = msg as Record<string, unknown>
    return m.jsonrpc === "2.0" && typeof m.method === "string" && !("id" in m) && !("result" in m) && !("error" in m)
}
