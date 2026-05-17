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

export interface Env {
    LIBRARY: R2BucketLike
    CREDENTIALS: KVNamespaceLike
    PUBLIC_BASE_URL?: string
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
                const credential = await requireCredential(request, env)
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
    const credential = await requireCredential(request, env)
    const body = await request.arrayBuffer()
    if (body.byteLength === 0) throw new HttpError(400, "Bundle body is required.")
    if (body.byteLength > 25 * 1024 * 1024) throw new HttpError(413, "Bundle exceeds the 25 MB publish limit.")

    const text = new TextDecoder().decode(body)
    const parsed = JSON.parse(text) as { manifest?: BundleManifest }
    const manifest = parsed.manifest
    if (!manifest?.songId || !manifest.title || !manifest.bundleVersion) {
        throw new HttpError(400, "Bundle manifest must include songId, title, and bundleVersion.")
    }

    const target = request.headers.get("X-LC-Target") ?? "central"
    if (target === "central" && credential.role !== "central") {
        throw new HttpError(403, "Only central credentials can publish to the central library.")
    }

    const key = `songs/${manifest.songId}/${manifest.bundleVersion}.lcbundle`
    await env.LIBRARY.put(key, body, { httpMetadata: { contentType: "application/vnd.lyricue.bundle+json" } })
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
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { manifest?: BundleManifest }
        if (!parsed.manifest) continue
        songs.push({
            songId: parsed.manifest.songId,
            title: parsed.manifest.title,
            bundleVersion: parsed.manifest.bundleVersion,
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
    await env.LIBRARY.put("catalog.json", JSON.stringify(catalog, null, 2), {
        httpMetadata: { contentType: "application/json" }
    })
    return { catalogVersion: catalog.catalogVersion }
}

async function appendPublishLog(env: Env, entry: Record<string, unknown>): Promise<void> {
    const key = "meta/publish-log.jsonl"
    const existing = await env.LIBRARY.get(key)
    const prior = existing ? await existing.text() : ""
    await env.LIBRARY.put(key, `${prior}${JSON.stringify(entry)}\n`, {
        httpMetadata: { contentType: "application/x-ndjson" }
    })
}

async function requireCredential(request: Request, env: Env): Promise<Credential> {
    const token = request.headers.get("X-LC-Credential")
    if (!token) throw new HttpError(401, "X-LC-Credential is required.")
    const raw = await env.CREDENTIALS.get(token)
    if (!raw) throw new HttpError(403, "Publish credential is not recognized.")
    return JSON.parse(raw) as Credential
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
