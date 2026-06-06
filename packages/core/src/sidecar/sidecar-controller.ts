/**
 * SidecarController — the only LyriCue module that calls child_process.spawn.
 *
 * Per architecture.md §4.2 and EP-04 STORY-04.3. Owns the lifecycle of the Python ML
 * sidecar subprocess and brokers every RPC into / response out of it.
 *
 * Responsibilities:
 *   - Resolve a Python ≥3.10 interpreter (settings override → python3 → python).
 *   - Spawn `python -m lyricue_sidecar`, wait for the `ready` notification.
 *   - Dispatch typed request() calls; correlate responses by id.
 *   - Surface notification-shaped messages to onProgress (the standard way the sidecar
 *     reports learn_song / segment_rehearsal progress, per architecture §6.5).
 *   - Cleanly shut down via the `shutdown` RPC + stdin close.
 *   - Expose an observable status for the diagnostics UI.
 *
 * Concurrency: ONE subprocess. The architecture serialises ML jobs because parallel jobs
 * thrash the CPU/GPU. The controller queues nothing — that lives in the SC consumer (the
 * Learn-Song orchestrator, EP-08). request() is fully reentrant; multiple in-flight
 * requests with distinct ids are correlated independently.
 *
 * Testability: the spawner is injectable via the `spawn` option so tests can substitute
 * a mock-process factory (a small ChildProcessMock that emits ready-notification-shaped
 * data on stdout). The real Electron path uses Node's child_process.spawn — see
 * `sidecar-controller.electron.ts` (or the host wiring in apps/sister/main).
 */

import { writable, type Readable } from "../settings/observable.js"
import {
    SidecarLifecycleCode,
    SidecarLifecycleError,
    SidecarRpcError,
    isJsonRpcNotification,
    isJsonRpcResponse,
    type JsonRpcId,
    type JsonRpcNotification,
    type JsonRpcRequest,
    type JsonRpcResponse,
    type SidecarLifecycleCodeT
} from "./sidecar-protocol.js"

export type SidecarStatus = "idle" | "starting" | "running" | "crashed"

/**
 * Minimal interface over the Node-child-process surface so we can substitute a mock in
 * tests without ever touching the real `child_process.spawn` import.
 */
export interface SidecarProcess {
    readonly pid: number | undefined
    write(data: string): boolean
    closeStdin(): void
    kill(signal?: NodeJS.Signals): boolean
    onStdoutLine(handler: (line: string) => void): () => void
    onStderrLine(handler: (line: string) => void): () => void
    onExit(handler: (code: number | null, signal: NodeJS.Signals | null) => void): () => void
}

export interface SidecarSpawnerOptions {
    pythonPath: string
    moduleArgs: string[]
    /** Optional cwd; defaults to the parent process cwd. */
    cwd?: string
    /** Env passthrough; defaults to the parent process env. */
    env?: NodeJS.ProcessEnv
}

export type SidecarSpawner = (opts: SidecarSpawnerOptions) => Promise<SidecarProcess>

/**
 * Resolves a usable Python interpreter (settings override → python3 → python on PATH)
 * and verifies its version is ≥3.10. Returns the absolute path. Tests substitute a stub
 * that returns a fixture path without spawning anything.
 */
export type PythonResolver = (settingsOverride: string | null) => Promise<{ pythonPath: string; version: string }>

export interface SidecarControllerOptions {
    /** Settings override for the Python interpreter path. null means "auto-resolve". */
    pythonOverride?: string | null
    /** Module args for `python -m lyricue_sidecar`. Defaults to `["-m", "lyricue_sidecar"]`. */
    moduleArgs?: string[]
    /** Subprocess factory. Tests inject a mock; production wires Node child_process. */
    spawn: SidecarSpawner
    /** Python resolver. Tests inject a stub; production wires actual `python --version` checks. */
    resolvePython: PythonResolver
    /** How long to wait for the `ready` notification after spawn before declaring failure. */
    readyTimeoutMs?: number
    /** Forwarded to the spawner. */
    cwd?: string
    env?: NodeJS.ProcessEnv
    /**
     * Optional callback for stderr lines. The sidecar writes its logging to stderr and we
     * forward it to the host's logging surface (FreeShow's LOG channel in fork mode,
     * the Electron renderer console in sister mode).
     */
    onStderrLine?: (line: string) => void
}

export type ProgressHandler = (notification: JsonRpcNotification) => void

export interface RequestOptions {
    /** Called once for each notification emitted by the sidecar between request and response. */
    onProgress?: ProgressHandler
    /** Per-request timeout in ms. Default 5 minutes (ML jobs can be long). */
    timeoutMs?: number
}

interface PendingRequest {
    id: JsonRpcId
    method: string
    resolve(value: unknown): void
    reject(err: Error): void
    onProgress?: ProgressHandler
    timer: ReturnType<typeof setTimeout> | null
}

const DEFAULT_READY_TIMEOUT_MS = 30_000
const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60 * 1000

export class SidecarController {
    #status = writable<SidecarStatus>("idle")
    #process: SidecarProcess | null = null
    #nextId = 1
    #pending = new Map<JsonRpcId, PendingRequest>()
    #stdoutBuffer = ""
    #disposeStdout: (() => void) | null = null
    #disposeStderr: (() => void) | null = null
    #disposeExit: (() => void) | null = null
    #readyResolve: (() => void) | null = null
    #readyReject: ((err: Error) => void) | null = null
    #readyTimer: ReturnType<typeof setTimeout> | null = null

    constructor(private readonly opts: SidecarControllerOptions) {}

    /** Observable status for the diagnostics UI / SC consumers. */
    get status(): Readable<SidecarStatus> {
        return { subscribe: (run) => this.#status.subscribe(run) }
    }

    /** Snapshot of the current status without subscribing. */
    statusSnapshot(): SidecarStatus {
        let snap: SidecarStatus = "idle"
        this.#status.subscribe((s) => (snap = s))()
        return snap
    }

    /**
     * Spawn the subprocess if not already running, wait for the `ready` notification,
     * and resolve when the sidecar is ready to accept RPCs.
     *
     * Idempotent: a second call while running resolves immediately. A call while
     * starting awaits the same ready promise.
     */
    async ensureRunning(): Promise<void> {
        const status = this.statusSnapshot()
        if (status === "running") return
        if (status === "starting") {
            return new Promise<void>((resolve, reject) => {
                const prevResolve = this.#readyResolve
                const prevReject = this.#readyReject
                this.#readyResolve = () => {
                    prevResolve?.()
                    resolve()
                }
                this.#readyReject = (err) => {
                    prevReject?.(err)
                    reject(err)
                }
            })
        }

        this.#status.set("starting")

        // Resolve the Python interpreter. Throws SidecarLifecycleError on failure.
        let pythonPath: string
        try {
            const resolved = await this.opts.resolvePython(this.opts.pythonOverride ?? null)
            pythonPath = resolved.pythonPath
        } catch (err) {
            this.#status.set("crashed")
            throw err
        }

        // Spawn the subprocess. The spawner is responsible for any platform-specific
        // argument shaping (Windows .exe extension, etc.).
        let process: SidecarProcess
        try {
            process = await this.opts.spawn({
                pythonPath,
                moduleArgs: this.opts.moduleArgs ?? ["-m", "lyricue_sidecar"],
                ...(this.opts.cwd !== undefined ? { cwd: this.opts.cwd } : {}),
                ...(this.opts.env !== undefined ? { env: this.opts.env } : {})
            })
        } catch (err) {
            this.#status.set("crashed")
            throw new SidecarLifecycleError(
                SidecarLifecycleCode.SIDECAR_FAILED_TO_START,
                `Failed to spawn sidecar: ${(err as Error).message}`,
                err
            )
        }

        this.#process = process

        this.#disposeStdout = process.onStdoutLine((line) => this.#onStdoutLine(line))
        this.#disposeStderr = process.onStderrLine((line) => {
            if (this.opts.onStderrLine) this.opts.onStderrLine(line)
        })
        this.#disposeExit = process.onExit((code, signal) => this.#onExit(code, signal))

        // Wait for the `ready` notification.
        const readyTimeoutMs = this.opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
        await new Promise<void>((resolve, reject) => {
            this.#readyResolve = () => {
                this.#status.set("running")
                resolve()
            }
            this.#readyReject = (err) => {
                this.#status.set("crashed")
                reject(err)
            }
            this.#readyTimer = setTimeout(() => {
                this.#readyReject?.(
                    new SidecarLifecycleError(
                        SidecarLifecycleCode.SIDECAR_TIMED_OUT,
                        `Sidecar did not emit 'ready' notification within ${readyTimeoutMs}ms`
                    )
                )
                this.#readyResolve = null
                this.#readyReject = null
            }, readyTimeoutMs)
        })

        if (this.#readyTimer !== null) {
            clearTimeout(this.#readyTimer)
            this.#readyTimer = null
        }
    }

    /**
     * Send a JSON-RPC request and resolve with the typed result.
     *
     * Throws SidecarRpcError when the sidecar returns an error response. Throws a generic
     * Error when the timeout fires or the subprocess crashes mid-request.
     */
    async request<TResult>(
        method: string,
        params: Record<string, unknown>,
        options: RequestOptions = {}
    ): Promise<TResult> {
        if (this.statusSnapshot() !== "running" || this.#process === null) {
            throw new SidecarLifecycleError(
                SidecarLifecycleCode.SIDECAR_FAILED_TO_START,
                `Cannot send request; sidecar status is "${this.statusSnapshot()}"`
            )
        }

        const id = this.#nextId++
        const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS

        return new Promise<TResult>((resolve, reject) => {
            const pending: PendingRequest = {
                id,
                method,
                resolve: (value: unknown) => resolve(value as TResult),
                reject,
                ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
                timer: setTimeout(() => {
                    this.#pending.delete(id)
                    reject(new Error(`Sidecar request '${method}' timed out after ${timeoutMs}ms`))
                }, timeoutMs)
            }
            this.#pending.set(id, pending)

            const req: JsonRpcRequest = {
                jsonrpc: "2.0",
                id,
                method,
                params
            }
            try {
                this.#process!.write(JSON.stringify(req) + "\n")
            } catch (err) {
                if (pending.timer !== null) clearTimeout(pending.timer)
                this.#pending.delete(id)
                reject(err as Error)
            }
        })
    }

    /**
     * Send a shutdown RPC, then close stdin and let the subprocess exit cleanly.
     * Idempotent: calling on an already-stopped controller is a no-op.
     */
    async shutdown(): Promise<void> {
        if (this.#process === null) return

        const status = this.statusSnapshot()
        if (status === "running") {
            try {
                await this.request("shutdown", {}, { timeoutMs: 5000 })
            } catch {
                // Best-effort: even if the shutdown RPC doesn't ack, we still close stdin
                // and let the subprocess exit on its own.
            }
        }

        try {
            this.#process.closeStdin()
        } catch {
            // ignore
        }

        // The onExit handler will null out #process and reset status; nothing else to do here.
    }

    terminate(signal: NodeJS.Signals = "SIGTERM"): boolean {
        return this.#process?.kill(signal) ?? false
    }

    // --- internals ---

    #onStdoutLine(line: string): void {
        // The sidecar emits NDJSON, but we still buffer in case Node's readline ever
        // hands us a partial frame (shouldn't happen with the line-mode adapter, but
        // belt-and-braces).
        this.#stdoutBuffer += line
        const trimmed = this.#stdoutBuffer.trim()
        if (trimmed === "") return

        let parsed: unknown
        try {
            parsed = JSON.parse(trimmed)
        } catch {
            // Not yet a complete JSON line — keep buffering. The line-mode adapter
            // should make this branch unreachable in practice.
            return
        }
        this.#stdoutBuffer = ""

        if (isJsonRpcNotification(parsed)) {
            this.#dispatchNotification(parsed)
            return
        }

        if (isJsonRpcResponse(parsed)) {
            this.#dispatchResponse(parsed)
            return
        }

        // Unknown shape — log via stderr forward if available, else swallow.
        this.opts.onStderrLine?.(`[unrecognised stdout]: ${trimmed}`)
    }

    #dispatchNotification(note: JsonRpcNotification): void {
        if (note.method === "ready") {
            // Resolve the in-flight ensureRunning() promise (if any).
            const resolver = this.#readyResolve
            this.#readyResolve = null
            this.#readyReject = null
            resolver?.()
            return
        }

        // Progress events flow to the pending request whose id matches the embedded
        // `request_id` field (the sidecar tags progress notifications this way per
        // architecture §6.5). If no such tag is present, broadcast to every pending
        // request — useful for global notifications.
        const tag = note.params?.["request_id"] as JsonRpcId | undefined
        if (tag !== undefined && this.#pending.has(tag)) {
            this.#pending.get(tag)!.onProgress?.(note)
            return
        }

        for (const p of this.#pending.values()) {
            p.onProgress?.(note)
        }
    }

    #dispatchResponse(resp: JsonRpcResponse): void {
        if (resp.id === null) {
            // Spec: error responses MAY have id=null when the parse failed. Surface as
            // an stderr warning since we can't tie it to a request.
            const err = (resp as { error?: { code: number; message: string } }).error
            if (err) this.opts.onStderrLine?.(`[orphan error] ${err.code}: ${err.message}`)
            return
        }

        const pending = this.#pending.get(resp.id)
        if (!pending) {
            this.opts.onStderrLine?.(`[orphan response] id=${String(resp.id)} (no matching request)`)
            return
        }

        this.#pending.delete(resp.id)
        if (pending.timer !== null) clearTimeout(pending.timer)

        if ("error" in resp) {
            pending.reject(new SidecarRpcError(resp.error.code, resp.error.message, resp.error.data))
        } else {
            pending.resolve((resp as { result: unknown }).result)
        }
    }

    #onExit(code: number | null, signal: NodeJS.Signals | null): void {
        // Tear down listeners.
        this.#disposeStdout?.()
        this.#disposeStderr?.()
        this.#disposeExit?.()
        this.#disposeStdout = null
        this.#disposeStderr = null
        this.#disposeExit = null
        this.#process = null

        // If we were waiting on `ready`, fail that promise.
        if (this.#readyReject !== null) {
            this.#readyReject(
                new SidecarLifecycleError(
                    SidecarLifecycleCode.SIDECAR_CRASHED,
                    `Sidecar exited before 'ready' notification (code=${code}, signal=${signal})`
                )
            )
            this.#readyResolve = null
            this.#readyReject = null
            if (this.#readyTimer !== null) {
                clearTimeout(this.#readyTimer)
                this.#readyTimer = null
            }
        }

        // Fail every pending request with a structured error.
        for (const pending of this.#pending.values()) {
            if (pending.timer !== null) clearTimeout(pending.timer)
            pending.reject(
                new SidecarLifecycleError(
                    SidecarLifecycleCode.SIDECAR_CRASHED,
                    `Sidecar exited during request '${pending.method}' (code=${code}, signal=${signal})`
                )
            )
        }
        this.#pending.clear()

        // Transition: clean exit → idle; crashy exit → crashed.
        const status = this.statusSnapshot()
        if (code === 0 && signal === null) {
            this.#status.set("idle")
        } else if (status !== "crashed") {
            this.#status.set("crashed")
        }
    }
}
