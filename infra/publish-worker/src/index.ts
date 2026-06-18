// LyriCue library publish Worker.
// Validates publish credentials, writes .lcbundle payloads to R2, regenerates
// catalog.json, and appends an audit log entry after every successful publish.

export interface R2ObjectBody {
    text(): Promise<string>
    arrayBuffer(): Promise<ArrayBuffer>
}

export interface R2BucketLike {
    put(key: string, value: string | ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }): Promise<void>
    get(key: string): Promise<R2ObjectBody | null>
    list(opts?: { prefix?: string }): Promise<{ objects: Array<{ key: string }> }>
}

export interface KVNamespaceLike {
    get(key: string): Promise<string | null>
}

export interface KVWritableNamespaceLike extends KVNamespaceLike {
    put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>
}

export interface Env {
    LIBRARY: R2BucketLike
    CREDENTIALS: KVNamespaceLike
    RATE_LIMITS?: KVWritableNamespaceLike
    PUBLIC_BASE_URL?: string
    RATE_LIMIT_WRITES_PER_HOUR?: string
    GITHUB_MIRROR_REPO?: string
    GITHUB_MIRROR_TOKEN?: string
    GITHUB_MIRROR_BRANCH?: string
}

interface Credential {
    orgId: string
    campusId: string
    role: "central" | "campus"
    keyId?: string
}

interface BundleManifest {
    songId: string
    title: string
    bundleVersion: string
}

interface ProjectPlan {
    id: string
    name: string
    date?: string
    songs: Array<{ songId: string; bundleVersion: string; arrangementId?: string }>
}

const SAFE_KEY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url)
        try {
            if (request.method === "GET" && url.pathname === "/publish/whoami") {
                const { credential } = await requireCredential(request, env)
                return json({ ok: true, credential: publicCredential(credential) })
            }
            if (request.method === "PUT" && url.pathname === "/publish") {
                return await publish(request, env)
            }
            if (request.method === "PUT" && url.pathname === "/publish/project") {
                return await publishProject(request, env)
            }
            return json({ error: "not_found" }, 404)
        } catch (err) {
            const status = err instanceof HttpError ? err.status : 500
            return json({ error: status === 500 ? "internal_error" : "request_failed", message: (err as Error).message }, status)
        }
    }
}

async function publishProject(request: Request, env: Env): Promise<Response> {
    const { token, credential } = await requireCredential(request, env)
    validateTenantHeaders(request, credential)
    await enforceRateLimit(token, env)
    const plan = validateProjectPlan(await request.json())
    const target = readPublishTarget(request)
    if (target === "central" && credential.role !== "central") {
        throw new HttpError(403, "Only central credentials can publish central project plans.")
    }
    const scope = target === "campus" ? `campuses/${credential.campusId}` : "central"
    const key = `projects/${scope}/${plan.id}.json`
    await putLibraryObject(env, key, JSON.stringify(plan, null, 2), "application/json", `publish-project(${plan.id}): by ${credential.campusId}`)
    await regenerateProjectIndex(env, scope)
    await appendPublishLog(env, {
        at: new Date().toISOString(),
        projectId: plan.id,
        campusId: credential.campusId,
        keyId: credential.keyId ?? null,
        target,
        key
    })
    return json({ ok: true, projectId: plan.id, projectUrl: publicUrl(env, key) })
}

async function publish(request: Request, env: Env): Promise<Response> {
    const { token, credential } = await requireCredential(request, env)
    validateTenantHeaders(request, credential)
    await enforceRateLimit(token, env)
    const body = await request.arrayBuffer()
    if (body.byteLength === 0) throw new HttpError(400, "Bundle body is required.")
    if (body.byteLength > 25 * 1024 * 1024) throw new HttpError(413, "Bundle exceeds the 25 MB publish limit.")

    const bytes = new Uint8Array(body)
    const manifest = validateBundleManifest(readBundleManifest(bytes))

    const target = readPublishTarget(request)
    if (target === "central" && credential.role !== "central") {
        throw new HttpError(403, "Only central credentials can publish to the central library.")
    }

    const key = `songs/${manifest.songId}/${manifest.bundleVersion}.lcbundle`
    const publishMessage = `publish(${manifest.songId}): version ${manifest.bundleVersion} by ${credential.campusId}`
    await putLibraryObject(env, key, bytes, "application/vnd.lyricue.bundle+zip", publishMessage)
    const catalog = await regenerateCatalog(env)
    await appendPublishLog(env, {
        at: new Date().toISOString(),
        songId: manifest.songId,
        bundleVersion: manifest.bundleVersion,
        campusId: credential.campusId,
        keyId: credential.keyId ?? null,
        target,
        key
    })

    return json({
        ok: true,
        songId: manifest.songId,
        bundleUrl: publicUrl(env, key),
        catalogVersion: catalog.catalogVersion
    })
}

async function regenerateCatalog(env: Env): Promise<{ catalogVersion: string }> {
    const listed = await env.LIBRARY.list({ prefix: "songs/" })
    const songs = []
    for (const object of listed.objects.filter((item) => item.key.endsWith(".lcbundle"))) {
        const bundle = await env.LIBRARY.get(object.key)
        if (!bundle) continue
        const bytes = new Uint8Array(await bundle.arrayBuffer())
        const manifest = validateBundleManifest(readBundleManifest(bytes))
        songs.push({
            songId: manifest.songId,
            title: manifest.title,
            bundleVersion: manifest.bundleVersion,
            bundleUrl: publicUrl(env, object.key),
            sha256: await sha256(bytes)
        })
    }
    songs.sort((a, b) => `${a.songId}:${a.bundleVersion}`.localeCompare(`${b.songId}:${b.bundleVersion}`))
    const catalog = {
        $schema: "lyricue-catalog-v1",
        catalogVersion: new Date().toISOString(),
        generatedAt: new Date().toISOString(),
        songs
    }
    await putLibraryObject(env, "catalog.json", JSON.stringify(catalog, null, 2), "application/json", "publish: regenerate catalog")
    return { catalogVersion: catalog.catalogVersion }
}

async function appendPublishLog(env: Env, entry: Record<string, unknown>): Promise<void> {
    const key = "meta/publish-log.jsonl"
    const existing = await env.LIBRARY.get(key)
    const prior = existing ? await existing.text() : ""
    await putLibraryObject(env, key, `${prior}${JSON.stringify(entry)}\n`, "application/x-ndjson", "publish: append audit log")
}

async function regenerateProjectIndex(env: Env, scope: string): Promise<void> {
    const listed = await env.LIBRARY.list({ prefix: `projects/${scope}/` })
    const projects: ProjectPlan[] = []
    for (const object of listed.objects.filter((item) => item.key.endsWith(".json") && !item.key.endsWith("/index.json"))) {
        const body = await env.LIBRARY.get(object.key)
        if (!body) continue
        projects.push(validateProjectPlan(JSON.parse(await body.text())))
    }
    projects.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.name.localeCompare(b.name))
    await putLibraryObject(env, `projects/${scope}/index.json`, JSON.stringify({ projects }, null, 2), "application/json", "publish-project: regenerate index")
}

async function requireCredential(request: Request, env: Env): Promise<{ token: string; credential: Credential }> {
    const token = request.headers.get("X-LC-Credential")
    if (!token) throw new HttpError(401, "X-LC-Credential is required.")
    const raw = await env.CREDENTIALS.get(token)
    if (!raw) throw new HttpError(403, "Publish credential is not recognized.")
    return { token, credential: validateCredentialRecord(parseCredentialRecord(raw)) }
}

function parseCredentialRecord(raw: string): unknown {
    try {
        return JSON.parse(raw)
    } catch {
        throw new HttpError(403, "Publish credential metadata is invalid.")
    }
}

function validateCredentialRecord(input: unknown): Credential {
    if (!input || typeof input !== "object") throw new HttpError(403, "Publish credential metadata is invalid.")
    const credential = input as Credential
    if (!isSafeIdentifier(credential.orgId) || !isSafeIdentifier(credential.campusId)) {
        throw new HttpError(403, "Publish credential metadata is invalid.")
    }
    if (credential.role !== "central" && credential.role !== "campus") {
        throw new HttpError(403, "Publish credential metadata is invalid.")
    }
    // keyId is optional but, when present, must be a non-empty printable string with
    // no control characters (it appears verbatim in the audit log).
    if (credential.keyId !== undefined) {
        if (typeof credential.keyId !== "string" || !isSafeIdentifier(credential.keyId)) {
            throw new HttpError(403, "Publish credential metadata is invalid.")
        }
    }
    return credential
}

/**
 * Identifier fields that flow into audit logs (and, for IDs, R2 keys) must be ASCII-safe
 * printable strings with no control characters, no leading/trailing whitespace, and a
 * sensible length cap. This is the same shape SAFE_KEY_SEGMENT enforces for IDs that
 * become R2 key segments, applied to credential metadata fields too.
 */
function isSafeIdentifier(value: unknown): value is string {
    if (typeof value !== "string") return false
    if (value.length === 0 || value.length > 128) return false
    // No control characters, no whitespace at edges, no embedded newlines/NUL.
    // eslint-disable-next-line no-control-regex
    if (/[ -]/.test(value)) return false
    if (value !== value.trim()) return false
    return true
}

function validateTenantHeaders(request: Request, credential: Credential): void {
    const orgId = request.headers.get("X-LC-Org")
    const campusId = request.headers.get("X-LC-Campus")
    if (!orgId) throw new HttpError(400, "X-LC-Org is required.")
    if (!campusId) throw new HttpError(400, "X-LC-Campus is required.")
    if (orgId !== credential.orgId) throw new HttpError(403, "Publish credential does not match X-LC-Org.")
    if (campusId !== credential.campusId) throw new HttpError(403, "Publish credential does not match X-LC-Campus.")
}

async function enforceRateLimit(token: string, env: Env): Promise<void> {
    if (!env.RATE_LIMITS) return
    // Defensive parse: a misconfigured env var ("unlimited", "1000_per_hour") or a
    // corrupt KV counter ("NaN", "abc") would silently bypass rate-limiting with the
    // naive Number.parseInt path because `NaN >= limit` is always false. Worse, the
    // subsequent `String(NaN + 1)` writes "NaN" back into the bucket, permanently
    // corrupting it for the rest of the hour. Treat non-finite values as the safe
    // default for the limit, and as 0 for the counter.
    const limit = safePositiveInt(env.RATE_LIMIT_WRITES_PER_HOUR, 60)
    const bucket = Math.floor(Date.now() / 3_600_000)
    const key = `publish:${token}:${bucket}`
    const count = safePositiveInt(await env.RATE_LIMITS.get(key), 0)
    if (count >= limit) throw new HttpError(429, "Publish credential exceeded the hourly write limit.")
    await env.RATE_LIMITS.put(key, String(count + 1), { expirationTtl: 7200 })
}

function safePositiveInt(value: string | null | undefined, fallback: number): number {
    if (value === null || value === undefined) return fallback
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed < 0) return fallback
    return parsed
}

function readPublishTarget(request: Request): "central" | "campus" {
    const target = request.headers.get("X-LC-Target") ?? "central"
    if (target !== "central" && target !== "campus") throw new HttpError(400, "X-LC-Target must be 'central' or 'campus'.")
    return target
}

async function putLibraryObject(
    env: Env,
    key: string,
    value: string | ArrayBuffer | Uint8Array,
    contentType: string,
    mirrorMessage: string
): Promise<void> {
    await env.LIBRARY.put(key, value, { httpMetadata: { contentType } })
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new Uint8Array(value)
    await mirrorToGithub(env, key, bytes, mirrorMessage).catch((err) => {
        console.warn(`GitHub mirror failed for ${key}: ${(err as Error).message}`)
    })
}

async function mirrorToGithub(env: Env, key: string, bytes: Uint8Array, message: string): Promise<void> {
    if (!env.GITHUB_MIRROR_REPO || !env.GITHUB_MIRROR_TOKEN) return
    const branch = env.GITHUB_MIRROR_BRANCH ?? "main"
    const path = key
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/")
    const url = `https://api.github.com/repos/${env.GITHUB_MIRROR_REPO}/contents/${path}`
    const headers = {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${env.GITHUB_MIRROR_TOKEN}`,
        "content-type": "application/json",
        "user-agent": "lyricue-publish-worker"
    }
    const existing = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, { headers })
    let sha: string | undefined
    if (existing.ok) {
        const body = (await existing.json()) as { sha?: string }
        sha = body.sha
    } else if (existing.status !== 404) {
        throw new Error(`GitHub lookup failed with ${existing.status}`)
    }
    const response = await fetch(url, {
        method: "PUT",
        headers,
        body: JSON.stringify({
            branch,
            message,
            content: base64(bytes),
            ...(sha ? { sha } : {})
        })
    })
    if (!response.ok) throw new Error(`GitHub commit failed with ${response.status}`)
}

function readBundleManifest(bytes: Uint8Array): BundleManifest {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
        return JSON.parse(readZipTextEntry(bytes, "manifest.json")) as BundleManifest
    }
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { manifest?: BundleManifest }
    if (!parsed.manifest) throw new HttpError(400, "Bundle manifest is missing.")
    return parsed.manifest
}

function validateProjectPlan(input: unknown): ProjectPlan {
    if (!input || typeof input !== "object") throw new HttpError(400, "Project plan must be an object.")
    const plan = input as ProjectPlan
    if (!plan.id || !plan.name || !Array.isArray(plan.songs)) {
        throw new HttpError(400, "Project plan must include id, name, and songs.")
    }
    assertSafeKeySegment(plan.id, "Project plan id")
    for (const [index, song] of plan.songs.entries()) {
        if (!song.songId || !song.bundleVersion) {
            throw new HttpError(400, `Project plan song ${index} must include songId and bundleVersion.`)
        }
        assertSafeKeySegment(song.songId, `Project plan song ${index} songId`)
        assertSafeKeySegment(song.bundleVersion, `Project plan song ${index} bundleVersion`)
    }
    return plan
}

function validateBundleManifest(manifest: BundleManifest): BundleManifest {
    if (!manifest?.songId || !manifest.title || !manifest.bundleVersion) {
        throw new HttpError(400, "Bundle manifest must include songId, title, and bundleVersion.")
    }
    assertSafeKeySegment(manifest.songId, "Bundle manifest songId")
    assertSafeKeySegment(manifest.bundleVersion, "Bundle manifest bundleVersion")
    return manifest
}

function assertSafeKeySegment(value: string, label: string): void {
    if (!SAFE_KEY_SEGMENT.test(value)) {
        throw new HttpError(400, `${label} must be a safe library key segment.`)
    }
}

function readZipTextEntry(bytes: Uint8Array, targetName: string): string {
    const decoder = new TextDecoder()
    const eocdOffset = findEndOfCentralDirectory(bytes)
    const entryCount = readUInt16LE(bytes, eocdOffset + 10)
    let cursor = readUInt32LE(bytes, eocdOffset + 16)
    for (let index = 0; index < entryCount; index += 1) {
        expectZipSignature(bytes, cursor, 0x02014b50, "central directory")
        const compressionMethod = readUInt16LE(bytes, cursor + 10)
        const compressedSize = readUInt32LE(bytes, cursor + 20)
        const fileNameLength = readUInt16LE(bytes, cursor + 28)
        const extraLength = readUInt16LE(bytes, cursor + 30)
        const commentLength = readUInt16LE(bytes, cursor + 32)
        const localHeaderOffset = readUInt32LE(bytes, cursor + 42)
        const fileName = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + fileNameLength))
        if (fileName === targetName) {
            if (compressionMethod !== 0) throw new HttpError(400, `Bundle ZIP entry ${targetName} must use stored compression.`)
            expectZipSignature(bytes, localHeaderOffset, 0x04034b50, "local file header")
            const localFileNameLength = readUInt16LE(bytes, localHeaderOffset + 26)
            const localExtraLength = readUInt16LE(bytes, localHeaderOffset + 28)
            const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength
            return decoder.decode(bytes.subarray(dataStart, dataStart + compressedSize))
        }
        cursor += 46 + fileNameLength + extraLength + commentLength
    }
    throw new HttpError(400, `Bundle ZIP is missing ${targetName}.`)
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
    const minimumOffset = Math.max(0, bytes.byteLength - 65557)
    for (let offset = bytes.byteLength - 22; offset >= minimumOffset; offset -= 1) {
        if (readUInt32LE(bytes, offset) === 0x06054b50) return offset
    }
    throw new HttpError(400, "Bundle ZIP end-of-central-directory record is missing.")
}

function expectZipSignature(bytes: Uint8Array, offset: number, expected: number, label: string): void {
    if (readUInt32LE(bytes, offset) !== expected) throw new HttpError(400, `Bundle ZIP ${label} signature is invalid.`)
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
    return (
        (bytes[offset] ?? 0) |
        ((bytes[offset + 1] ?? 0) << 8) |
        ((bytes[offset + 2] ?? 0) << 16) |
        ((bytes[offset + 3] ?? 0) << 24)
    ) >>> 0
}

function base64(bytes: Uint8Array): string {
    let binary = ""
    for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    }
    return btoa(binary)
}

function publicCredential(credential: Credential): Omit<Credential, "keyId"> & { keyId: string | null } {
    return { orgId: credential.orgId, campusId: credential.campusId, role: credential.role, keyId: credential.keyId ?? null }
}

function publicUrl(env: Env, key: string): string {
    return `${(env.PUBLIC_BASE_URL ?? "https://library.example.invalid").replace(/\/+$/, "")}/${key}`
}

async function sha256(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", bytes)
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

class HttpError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message)
    }
}
