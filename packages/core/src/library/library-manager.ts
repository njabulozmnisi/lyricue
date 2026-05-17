import { createHash } from "node:crypto"
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
    const bundle: LibraryBundle = {
        manifest,
        show: input.show,
        timingMap: input.timingMap,
        arrangements
    }
    return new TextEncoder().encode(stableJson(bundle))
}

export function readBundle(bytes: Uint8Array): LibraryBundle {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as LibraryBundle
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
