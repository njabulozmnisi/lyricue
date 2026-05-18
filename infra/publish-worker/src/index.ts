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
            return json({ error: "not_found" }, 404)
        } catch (err) {
            const status = err instanceof HttpError ? err.status : 500
            return json({ error: status === 500 ? "internal_error" : "request_failed", message: (err as Error).message }, status)
        }
    }
}

async function publish(request: Request, env: Env): Promise<Response> {
    const { token, credential } = await requireCredential(request, env)
    await enforceRateLimit(token, env)
    const body = await request.arrayBuffer()
    if (body.byteLength === 0) throw new HttpError(400, "Bundle body is required.")
    if (body.byteLength > 25 * 1024 * 1024) throw new HttpError(413, "Bundle exceeds the 25 MB publish limit.")

    const bytes = new Uint8Array(body)
    const manifest = readBundleManifest(bytes)
    if (!manifest?.songId || !manifest.title || !manifest.bundleVersion) {
        throw new HttpError(400, "Bundle manifest must include songId, title, and bundleVersion.")
    }

    const target = request.headers.get("X-LC-Target") ?? "central"
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
        const manifest = readBundleManifest(bytes)
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

async function requireCredential(request: Request, env: Env): Promise<{ token: string; credential: Credential }> {
    const token = request.headers.get("X-LC-Credential")
    if (!token) throw new HttpError(401, "X-LC-Credential is required.")
    const raw = await env.CREDENTIALS.get(token)
    if (!raw) throw new HttpError(403, "Publish credential is not recognized.")
    return { token, credential: JSON.parse(raw) as Credential }
}

async function enforceRateLimit(token: string, env: Env): Promise<void> {
    if (!env.RATE_LIMITS) return
    const limit = Number.parseInt(env.RATE_LIMIT_WRITES_PER_HOUR ?? "60", 10)
    const bucket = Math.floor(Date.now() / 3_600_000)
    const key = `publish:${token}:${bucket}`
    const count = Number.parseInt((await env.RATE_LIMITS.get(key)) ?? "0", 10)
    if (count >= limit) throw new HttpError(429, "Publish credential exceeded the hourly write limit.")
    await env.RATE_LIMITS.put(key, String(count + 1), { expirationTtl: 7200 })
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
