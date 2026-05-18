import { createHash } from "node:crypto"
import { inflateRawSync } from "node:zlib"
import type { ProjectPlan } from "../setlist/project-adapter.js"
import type { TimingMap, Arrangement } from "../types/timing-map.js"
import { validateArrangements, validateTimingMap } from "../types/timing-map-schema.js"
import { SCHEMA_LYRICUE_BUNDLE_V1, SCHEMA_LYRICUE_CATALOG_V1 } from "../types/schema-versions.js"

export interface LibraryCatalogEntry {
    songId: string
    title: string
    bundleVersion: string
    bundleUrl: string
    sha256: string
    updatedAt?: string
}

export interface LibraryCatalog {
    $schema: typeof SCHEMA_LYRICUE_CATALOG_V1
    catalogVersion: string
    generatedAt: string
    songs: LibraryCatalogEntry[]
    campuses?: Array<{ id: string; name: string }>
}

export interface LibraryBundleManifest {
    $schema: typeof SCHEMA_LYRICUE_BUNDLE_V1
    songId: string
    title: string
    bundleVersion: string
    exportedAt: string
    timingSha256: string
    showSha256: string
    arrangementsSha256?: string
    signature?: {
        keyId: string
        algorithm: "ed25519"
        value: string
    }
}

export interface LibraryBundle {
    manifest: LibraryBundleManifest
    show: unknown
    timingMap: TimingMap
    arrangements: Arrangement[]
}

export interface CatalogDiff {
    added: LibraryCatalogEntry[]
    updated: LibraryCatalogEntry[]
    removed: LibraryCatalogEntry[]
}

export interface PublishCredentialInfo {
    orgId: string
    campusId: string
    role: "central" | "campus"
    keyId: string | null
}

export interface PublishBundleResult {
    ok: true
    songId: string
    bundleUrl: string
    catalogVersion: string
}

export interface ProjectPlanFilter {
    scope?: "central" | "campus"
    campusId?: string
}

export async function fetchCatalog(
    libraryUrl: string,
    opts: { mirrorUrl?: string | null; fetchImpl?: typeof fetch } = {}
): Promise<{ catalog: LibraryCatalog; usedMirror: boolean }> {
    const fetchImpl = opts.fetchImpl ?? fetch
    const primary = catalogUrl(libraryUrl)
    try {
        return { catalog: validateCatalog(await fetchJson(fetchImpl, primary)), usedMirror: false }
    } catch (err) {
        if (!opts.mirrorUrl) throw err
        return {
            catalog: validateCatalog(await fetchJson(fetchImpl, catalogUrl(opts.mirrorUrl))),
            usedMirror: true
        }
    }
}

export function diffCatalog(remote: LibraryCatalog, local: LibraryCatalog | null): CatalogDiff {
    const localBySong = new Map((local?.songs ?? []).map((entry) => [entry.songId, entry]))
    const remoteBySong = new Map(remote.songs.map((entry) => [entry.songId, entry]))
    const added: LibraryCatalogEntry[] = []
    const updated: LibraryCatalogEntry[] = []
    const removed: LibraryCatalogEntry[] = []

    for (const entry of remote.songs) {
        const localEntry = localBySong.get(entry.songId)
        if (!localEntry) added.push(entry)
        else if (localEntry.bundleVersion !== entry.bundleVersion) updated.push(entry)
    }
    for (const entry of local?.songs ?? []) {
        if (!remoteBySong.has(entry.songId)) removed.push(entry)
    }
    return { added, updated, removed }
}

export async function testPublishCredential(
    workerUrl: string,
    credential: string,
    opts: { fetchImpl?: typeof fetch } = {}
): Promise<PublishCredentialInfo> {
    const response = await (opts.fetchImpl ?? fetch)(`${workerUrl.replace(/\/+$/, "")}/publish/whoami`, {
        headers: { "X-LC-Credential": credential }
    })
    const body = (await response.json()) as { ok?: boolean; credential?: PublishCredentialInfo; message?: string }
    if (!response.ok || !body.ok || !body.credential) {
        throw new Error(body.message ?? `Publish credential check failed: ${response.status}`)
    }
    return body.credential
}

export async function publishBundle(
    bundle: Uint8Array,
    opts: {
        workerUrl: string
        credential: string
        orgId: string
        campusId: string
        target: "central" | "campus"
        fetchImpl?: typeof fetch
    }
): Promise<PublishBundleResult> {
    const response = await (opts.fetchImpl ?? fetch)(`${opts.workerUrl.replace(/\/+$/, "")}/publish`, {
        method: "PUT",
        headers: {
            "content-type": "application/vnd.lyricue.bundle+zip",
            "X-LC-Org": opts.orgId,
            "X-LC-Campus": opts.campusId,
            "X-LC-Credential": opts.credential,
            "X-LC-Target": opts.target
        },
        body: arrayBufferFromBytes(bundle)
    })
    const body = (await response.json()) as PublishBundleResult | { message?: string }
    if (!response.ok) throw new Error("message" in body && body.message ? body.message : `Publish failed: ${response.status}`)
    return body as PublishBundleResult
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return copy.buffer
}

export async function listProjects(
    libraryUrl: string,
    filter: ProjectPlanFilter = {},
    opts: { fetchImpl?: typeof fetch } = {}
): Promise<ProjectPlan[]> {
    const response = await (opts.fetchImpl ?? fetch)(projectIndexUrl(libraryUrl, filter))
    if (!response.ok) throw new Error(`Project list fetch failed: ${response.status} ${response.statusText}`.trim())
    const body = (await response.json()) as { projects?: ProjectPlan[] } | ProjectPlan[]
    return Array.isArray(body) ? body.map(validateProjectPlan) : (body.projects ?? []).map(validateProjectPlan)
}

export async function fetchProject(
    libraryUrl: string,
    id: string,
    filter: ProjectPlanFilter = {},
    opts: { fetchImpl?: typeof fetch } = {}
): Promise<ProjectPlan> {
    const response = await (opts.fetchImpl ?? fetch)(projectPlanUrl(libraryUrl, id, filter))
    if (!response.ok) throw new Error(`Project fetch failed: ${response.status} ${response.statusText}`.trim())
    return validateProjectPlan(await response.json())
}

export async function publishProjectPlan(
    plan: ProjectPlan,
    opts: {
        workerUrl: string
        credential: string
        orgId: string
        campusId: string
        target: "central" | "campus"
        fetchImpl?: typeof fetch
    }
): Promise<{ ok: true; projectId: string; projectUrl: string }> {
    const response = await (opts.fetchImpl ?? fetch)(`${opts.workerUrl.replace(/\/+$/, "")}/publish/project`, {
        method: "PUT",
        headers: {
            "content-type": "application/json",
            "X-LC-Org": opts.orgId,
            "X-LC-Campus": opts.campusId,
            "X-LC-Credential": opts.credential,
            "X-LC-Target": opts.target
        },
        body: JSON.stringify(validateProjectPlan(plan))
    })
    const body = (await response.json()) as { ok: true; projectId: string; projectUrl: string } | { message?: string }
    if (!response.ok) throw new Error("message" in body && body.message ? body.message : `Project publish failed: ${response.status}`)
    return body as { ok: true; projectId: string; projectUrl: string }
}

export async function downloadBundle(
    entry: LibraryCatalogEntry,
    opts: { fetchImpl?: typeof fetch; onProgress?: (progress: { receivedBytes: number; totalBytes: number | null }) => void } = {}
): Promise<Uint8Array> {
    const fetchImpl = opts.fetchImpl ?? fetch
    const response = await fetchImpl(entry.bundleUrl)
    if (!response.ok) throw new Error(`Bundle download failed: ${response.status} ${response.statusText}`.trim())
    const bytes = new Uint8Array(await response.arrayBuffer())
    opts.onProgress?.({ receivedBytes: bytes.byteLength, totalBytes: bytes.byteLength })
    const actual = sha256(bytes)
    if (actual !== entry.sha256) {
        throw new Error(`Bundle SHA256 mismatch for ${entry.songId}: expected ${entry.sha256}, got ${actual}`)
    }
    return bytes
}

export function exportBundle(input: {
    songId: string
    title: string
    bundleVersion: string
    show: unknown
    timingMap: TimingMap
    arrangements?: Arrangement[]
    exportedAt?: string
}): Uint8Array {
    const timingResult = validateTimingMap(input.timingMap)
    if (!timingResult.ok) throw new Error(`Cannot export invalid timing map: ${timingResult.errors[0]?.message}`)
    const arrangements = input.arrangements ?? []
    const arrangementResult = validateArrangements(arrangements)
    if (!arrangementResult.ok) throw new Error(`Cannot export invalid arrangements: ${arrangementResult.errors[0]?.message}`)

    const timingJson = stableJson(input.timingMap)
    const showJson = stableJson(input.show)
    const arrangementsJson = stableJson(arrangements)
    const manifest: LibraryBundleManifest = {
        $schema: SCHEMA_LYRICUE_BUNDLE_V1,
        songId: input.songId,
        title: input.title,
        bundleVersion: input.bundleVersion,
        exportedAt: input.exportedAt ?? new Date().toISOString(),
        timingSha256: sha256Text(timingJson),
        showSha256: sha256Text(showJson)
    }
    if (arrangements.length > 0) manifest.arrangementsSha256 = sha256Text(arrangementsJson)
    return createZip({
        "manifest.json": stableJson(manifest),
        "timing.json": timingJson,
        "show.json": showJson,
        "arrangements.json": arrangementsJson
    })
}

export function readBundle(bytes: Uint8Array): LibraryBundle {
    const parsed = isZip(bytes) ? readZipBundle(bytes) : readLegacyJsonBundle(bytes)
    if (!parsed.manifest || parsed.manifest.$schema !== SCHEMA_LYRICUE_BUNDLE_V1) {
        throw new Error("Bundle manifest schema is missing or unsupported")
    }
    if (sha256Text(stableJson(parsed.timingMap)) !== parsed.manifest.timingSha256) {
        throw new Error("Bundle timing map hash mismatch")
    }
    if (sha256Text(stableJson(parsed.show)) !== parsed.manifest.showSha256) {
        throw new Error("Bundle show hash mismatch")
    }
    const arrangements = parsed.arrangements ?? []
    if (parsed.manifest.arrangementsSha256 && sha256Text(stableJson(arrangements)) !== parsed.manifest.arrangementsSha256) {
        throw new Error("Bundle arrangements hash mismatch")
    }
    const timing = validateTimingMap(parsed.timingMap)
    if (!timing.ok) throw new Error(`Bundle timing map failed validation: ${timing.errors[0]?.message}`)
    const arrangementResult = validateArrangements(arrangements)
    if (!arrangementResult.ok) throw new Error(`Bundle arrangements failed validation: ${arrangementResult.errors[0]?.message}`)
    return { ...parsed, timingMap: timing.value, arrangements: arrangementResult.value }
}

export async function importBundle(
    bytes: Uint8Array,
    opts: {
        saveTimingMap(showId: string, map: TimingMap): Promise<void>
        saveArrangements(showId: string, arrangements: Arrangement[]): Promise<void>
        createShow?(show: unknown): Promise<void>
    }
): Promise<{ songId: string; showId: string; title: string }> {
    const bundle = readBundle(bytes)
    await opts.createShow?.(bundle.show)
    await opts.saveTimingMap(bundle.timingMap.showId, {
        ...bundle.timingMap,
        learnedFrom: {
            ...bundle.timingMap.learnedFrom,
            method: "imported",
            source: `library:${bundle.manifest.songId}@${bundle.manifest.bundleVersion}`
        }
    })
    await opts.saveArrangements(bundle.timingMap.showId, bundle.arrangements)
    return {
        songId: bundle.manifest.songId,
        showId: bundle.timingMap.showId,
        title: bundle.manifest.title
    }
}

export function sha256(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex")
}

export function sha256Text(text: string): string {
    return createHash("sha256").update(text).digest("hex")
}

function catalogUrl(base: string): string {
    return `${base.replace(/\/+$/, "")}/catalog.json`
}

function projectIndexUrl(base: string, filter: ProjectPlanFilter): string {
    return `${projectScopeBase(base, filter)}/index.json`
}

function projectPlanUrl(base: string, id: string, filter: ProjectPlanFilter): string {
    return `${projectScopeBase(base, filter)}/${encodeURIComponent(id)}.json`
}

function projectScopeBase(base: string, filter: ProjectPlanFilter): string {
    const root = `${base.replace(/\/+$/, "")}/projects`
    if (filter.scope === "campus") return `${root}/campuses/${encodeURIComponent(filter.campusId ?? "default")}`
    return `${root}/central`
}

function validateProjectPlan(input: unknown): ProjectPlan {
    if (!input || typeof input !== "object") throw new Error("Project plan must be an object")
    const plan = input as ProjectPlan
    if (typeof plan.id !== "string" || plan.id.trim() === "") throw new Error("Project plan id must be a non-empty string")
    if (typeof plan.name !== "string" || plan.name.trim() === "") throw new Error("Project plan name must be a non-empty string")
    if (!Array.isArray(plan.songs)) throw new Error("Project plan songs must be an array")
    for (const [index, song] of plan.songs.entries()) {
        if (!song || typeof song !== "object") throw new Error(`Project plan songs[${index}] must be an object`)
        if (typeof song.songId !== "string" || song.songId.trim() === "") throw new Error(`Project plan songs[${index}].songId must be a string`)
        if (typeof song.bundleVersion !== "string" || song.bundleVersion.trim() === "") {
            throw new Error(`Project plan songs[${index}].bundleVersion must be a string`)
        }
    }
    return plan
}

async function fetchJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
    const response = await fetchImpl(url)
    if (!response.ok) throw new Error(`Catalog fetch failed: ${response.status} ${response.statusText}`.trim())
    return response.json()
}

function validateCatalog(input: unknown): LibraryCatalog {
    if (!input || typeof input !== "object") throw new Error("Catalog must be an object")
    const catalog = input as LibraryCatalog
    if (catalog.$schema !== SCHEMA_LYRICUE_CATALOG_V1) throw new Error("Catalog schema is unsupported")
    if (!Array.isArray(catalog.songs)) throw new Error("Catalog songs must be an array")
    for (const [index, song] of catalog.songs.entries()) {
        for (const field of ["songId", "title", "bundleVersion", "bundleUrl", "sha256"] as const) {
            if (typeof song[field] !== "string" || song[field].trim() === "") {
                throw new Error(`Catalog songs[${index}].${field} must be a non-empty string`)
            }
        }
    }
    return catalog
}

function createZip(files: Record<string, string>): Uint8Array {
    const localParts: Buffer[] = []
    const centralParts: Buffer[] = []
    let offset = 0

    for (const [name, text] of Object.entries(files)) {
        const nameBytes = Buffer.from(name, "utf8")
        const data = Buffer.from(text, "utf8")
        const crc = crc32(data)
        const localHeader = Buffer.alloc(30 + nameBytes.byteLength)
        localHeader.writeUInt32LE(0x04034b50, 0)
        localHeader.writeUInt16LE(20, 4)
        localHeader.writeUInt16LE(0, 6)
        localHeader.writeUInt16LE(0, 8)
        localHeader.writeUInt16LE(0, 10)
        localHeader.writeUInt16LE(0, 12)
        localHeader.writeUInt32LE(crc, 14)
        localHeader.writeUInt32LE(data.byteLength, 18)
        localHeader.writeUInt32LE(data.byteLength, 22)
        localHeader.writeUInt16LE(nameBytes.byteLength, 26)
        localHeader.writeUInt16LE(0, 28)
        nameBytes.copy(localHeader, 30)

        const centralHeader = Buffer.alloc(46 + nameBytes.byteLength)
        centralHeader.writeUInt32LE(0x02014b50, 0)
        centralHeader.writeUInt16LE(20, 4)
        centralHeader.writeUInt16LE(20, 6)
        centralHeader.writeUInt16LE(0, 8)
        centralHeader.writeUInt16LE(0, 10)
        centralHeader.writeUInt16LE(0, 12)
        centralHeader.writeUInt16LE(0, 14)
        centralHeader.writeUInt32LE(crc, 16)
        centralHeader.writeUInt32LE(data.byteLength, 20)
        centralHeader.writeUInt32LE(data.byteLength, 24)
        centralHeader.writeUInt16LE(nameBytes.byteLength, 28)
        centralHeader.writeUInt16LE(0, 30)
        centralHeader.writeUInt16LE(0, 32)
        centralHeader.writeUInt16LE(0, 34)
        centralHeader.writeUInt16LE(0, 36)
        centralHeader.writeUInt32LE(0, 38)
        centralHeader.writeUInt32LE(offset, 42)
        nameBytes.copy(centralHeader, 46)

        localParts.push(localHeader, data)
        centralParts.push(centralHeader)
        offset += localHeader.byteLength + data.byteLength
    }

    const centralOffset = offset
    const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0)
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(0, 4)
    eocd.writeUInt16LE(0, 6)
    eocd.writeUInt16LE(centralParts.length, 8)
    eocd.writeUInt16LE(centralParts.length, 10)
    eocd.writeUInt32LE(centralSize, 12)
    eocd.writeUInt32LE(centralOffset, 16)
    eocd.writeUInt16LE(0, 20)

    return new Uint8Array(Buffer.concat([...localParts, ...centralParts, eocd]))
}

function readZipBundle(bytes: Uint8Array): LibraryBundle {
    const entries = readZipTextEntries(bytes)
    const manifest = JSON.parse(requiredZipEntry(entries, "manifest.json")) as LibraryBundleManifest
    return {
        manifest,
        timingMap: JSON.parse(requiredZipEntry(entries, "timing.json")) as TimingMap,
        show: JSON.parse(requiredZipEntry(entries, "show.json")) as unknown,
        arrangements: JSON.parse(requiredZipEntry(entries, "arrangements.json")) as Arrangement[]
    }
}

function readLegacyJsonBundle(bytes: Uint8Array): LibraryBundle {
    return JSON.parse(new TextDecoder().decode(bytes)) as LibraryBundle
}

function requiredZipEntry(entries: Map<string, string>, name: string): string {
    const entry = entries.get(name)
    if (entry === undefined) throw new Error(`Bundle ZIP is missing ${name}`)
    return entry
}

function readZipTextEntries(bytes: Uint8Array): Map<string, string> {
    const decoder = new TextDecoder()
    const eocdOffset = findEndOfCentralDirectory(bytes)
    const entryCount = readUInt16LE(bytes, eocdOffset + 10)
    let cursor = readUInt32LE(bytes, eocdOffset + 16)
    const entries = new Map<string, string>()

    for (let index = 0; index < entryCount; index += 1) {
        expectZipSignature(bytes, cursor, 0x02014b50, "central directory")
        const compressionMethod = readUInt16LE(bytes, cursor + 10)
        const compressedSize = readUInt32LE(bytes, cursor + 20)
        const uncompressedSize = readUInt32LE(bytes, cursor + 24)
        const fileNameLength = readUInt16LE(bytes, cursor + 28)
        const extraLength = readUInt16LE(bytes, cursor + 30)
        const commentLength = readUInt16LE(bytes, cursor + 32)
        const localHeaderOffset = readUInt32LE(bytes, cursor + 42)
        const fileName = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + fileNameLength))

        expectZipSignature(bytes, localHeaderOffset, 0x04034b50, "local file header")
        const localFileNameLength = readUInt16LE(bytes, localHeaderOffset + 26)
        const localExtraLength = readUInt16LE(bytes, localHeaderOffset + 28)
        const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength
        const compressed = bytes.subarray(dataStart, dataStart + compressedSize)
        const content = inflateZipEntry(compressed, compressionMethod)
        if (content.byteLength !== uncompressedSize) {
            throw new Error(`Bundle ZIP entry ${fileName} has invalid uncompressed size`)
        }
        entries.set(fileName, decoder.decode(content))
        cursor += 46 + fileNameLength + extraLength + commentLength
    }

    return entries
}

function inflateZipEntry(compressed: Uint8Array, compressionMethod: number): Uint8Array {
    if (compressionMethod === 0) return compressed
    if (compressionMethod === 8) return inflateRawSync(Buffer.from(compressed))
    throw new Error(`Bundle ZIP uses unsupported compression method ${compressionMethod}`)
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
    const minimumOffset = Math.max(0, bytes.byteLength - 65557)
    for (let offset = bytes.byteLength - 22; offset >= minimumOffset; offset -= 1) {
        if (readUInt32LE(bytes, offset) === 0x06054b50) return offset
    }
    throw new Error("Bundle ZIP end-of-central-directory record is missing")
}

function expectZipSignature(bytes: Uint8Array, offset: number, expected: number, label: string): void {
    if (readUInt32LE(bytes, offset) !== expected) throw new Error(`Bundle ZIP ${label} signature is invalid`)
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
    const value = bytes[offset] ?? 0
    return value | ((bytes[offset + 1] ?? 0) << 8)
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
    return (
        (bytes[offset] ?? 0) |
        ((bytes[offset + 1] ?? 0) << 8) |
        ((bytes[offset + 2] ?? 0) << 16) |
        ((bytes[offset + 3] ?? 0) << 24)
    ) >>> 0
}

function isZip(bytes: Uint8Array): boolean {
    return bytes[0] === 0x50 && bytes[1] === 0x4b
}

const CRC32_TABLE = new Uint32Array(
    Array.from({ length: 256 }, (_unused, index) => {
        let value = index
        for (let bit = 0; bit < 8; bit += 1) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
        }
        return value >>> 0
    })
)

function crc32(bytes: Uint8Array): number {
    let value = 0xffffffff
    for (const byte of bytes) {
        value = (CRC32_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8)
    }
    return (value ^ 0xffffffff) >>> 0
}

function stableJson(value: unknown): string {
    return JSON.stringify(sortForJson(value))
}

function sortForJson(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortForJson)
    if (!value || typeof value !== "object") return value
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, sortForJson(item)])
    )
}
