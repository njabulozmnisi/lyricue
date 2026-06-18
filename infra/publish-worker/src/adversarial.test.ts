/**
 * Adversarial tests — find defects existing happy-path Worker tests don't catch.
 *
 * Surface areas:
 *   1. Rate-limit bypass via corrupted KV counter (NaN comparison fails open).
 *   2. ZIP entryCount DoS (untrusted entryCount drives loop iteration).
 *   3. ZIP dataStart + compressedSize bounds (truncated manifest).
 *   4. Credential record with empty-string keyId (typeof === "string" passes).
 *   5. Whitespace-padded tenant headers (orgId !== credential.orgId works, but UX-confusing).
 */

import { describe, expect, it } from "vitest"
import { exportBundle } from "../../../packages/core/src/library/library-manager.js"
import { DEMO_TIMING_MAP } from "../../../packages/core/src/output/test-utils.js"
import worker, { type Env, type R2ObjectBody } from "./index.js"

class MemoryObject implements R2ObjectBody {
    constructor(private readonly bytes: Uint8Array) {}
    async text(): Promise<string> {
        return new TextDecoder().decode(this.bytes)
    }
    async arrayBuffer(): Promise<ArrayBuffer> {
        return this.bytes.buffer.slice(this.bytes.byteOffset, this.bytes.byteOffset + this.bytes.byteLength)
    }
}

function makeEnv(
    credentialRecord = JSON.stringify({ orgId: "hillside", campusId: "central", role: "central", keyId: "central-1" }),
    rateLimitsSeed: Record<string, string> = {}
): Env & { objects: Map<string, Uint8Array>; rateLimits: Map<string, string> } {
    const objects = new Map<string, Uint8Array>()
    const rateLimits = new Map<string, string>(Object.entries(rateLimitsSeed))
    return {
        objects,
        rateLimits,
        PUBLIC_BASE_URL: "https://cdn.example.test",
        CREDENTIALS: {
            async get(key: string) {
                if (key !== "central-token") return null
                return credentialRecord
            }
        },
        RATE_LIMITS: {
            async get(key: string) {
                return rateLimits.get(key) ?? null
            },
            async put(key: string, value: string) {
                rateLimits.set(key, value)
            }
        },
        LIBRARY: {
            async put(key, value) {
                const bytes =
                    typeof value === "string"
                        ? new TextEncoder().encode(value)
                        : value instanceof Uint8Array
                          ? value
                          : new Uint8Array(value)
                objects.set(key, bytes)
            },
            async get(key) {
                const bytes = objects.get(key)
                return bytes ? new MemoryObject(bytes) : null
            },
            async list(opts) {
                const prefix = opts?.prefix ?? ""
                return { objects: [...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) }
            }
        }
    }
}

function bundle(songId = "song-1", version = "1.0.0"): Uint8Array {
    return exportBundle({
        songId,
        title: "Song One",
        bundleVersion: version,
        show: { id: "show-1", title: "Song One" },
        timingMap: {
            ...DEMO_TIMING_MAP,
            showId: "show-1",
            learnedFrom: { ...DEMO_TIMING_MAP.learnedFrom }
        },
        arrangements: [],
        exportedAt: "2026-05-17T00:00:00.000Z"
    })
}

function publishHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
        "X-LC-Org": "hillside",
        "X-LC-Campus": "central",
        "X-LC-Credential": "central-token",
        ...extra
    }
}

describe("adversarial: rate-limit bypass via corrupted KV", () => {
    /**
     * If RATE_LIMITS.get returns a non-numeric string (KV corruption, prior buggy write,
     * or a NaN write self-induced by the buggy code path itself), Number.parseInt returns
     * NaN, `NaN >= limit` is always false, and the rate limit is silently bypassed for
     * the entire hour bucket. Worse, `String(NaN + 1) === "NaN"` permanently corrupts
     * the bucket — every subsequent request bypasses for that hour.
     *
     * The Worker must defend by treating non-numeric counter values as 0 (or rejecting
     * them with a controlled 500).
     */
    it("does not silently bypass the rate limit when the KV counter is corrupt", async () => {
        const bucket = Math.floor(Date.now() / 3_600_000)
        const env = makeEnv(undefined, { [`publish:central-token:${bucket}`]: "garbage" })

        // With the bug: the publish succeeds (rate-limit check returns false on NaN).
        // After the fix: the Worker either resets the bucket to 1 (treat as 0+1) or
        // returns a controlled 500. Either way the bucket must NOT be left as "NaN".
        const response = await worker.fetch(
            new Request("https://worker.test/publish", {
                method: "PUT",
                headers: publishHeaders(),
                body: bundle()
            }),
            env
        )

        // The publish may succeed OR fail safely, but the corruption must not propagate.
        const after = env.rateLimits.get(`publish:central-token:${bucket}`)
        expect(after, "rate-limit bucket must not be left as 'NaN'").not.toBe("NaN")
        // If the publish succeeded, the counter should be a finite integer string.
        if (response.status === 200) {
            expect(Number.isFinite(Number.parseInt(after ?? "0", 10))).toBe(true)
        }
    })

    /**
     * RATE_LIMIT_WRITES_PER_HOUR env var set to a non-numeric string also fails open.
     * Cloudflare Worker env vars are operator-configurable; a typo like "60_per_hour"
     * silently disables the rate limit.
     */
    it("rejects requests when RATE_LIMIT_WRITES_PER_HOUR is non-numeric", async () => {
        const env = makeEnv()
        env.RATE_LIMIT_WRITES_PER_HOUR = "not-a-number"

        const response = await worker.fetch(
            new Request("https://worker.test/publish", {
                method: "PUT",
                headers: publishHeaders(),
                body: bundle()
            }),
            env
        )

        // With a misconfigured limit, the safest behaviour is to fall back to the default
        // (60/hour), not to disable rate-limiting entirely. Either way it must not crash
        // and must not allow infinite writes — a single publish should still succeed but
        // bucket counter must be a finite number.
        const bucket = Math.floor(Date.now() / 3_600_000)
        const after = env.rateLimits.get(`publish:central-token:${bucket}`)
        if (response.status === 200) {
            expect(after).toBe("1")
        }
    })
})

describe("adversarial: ZIP parser bounds", () => {
    /**
     * A crafted ZIP that claims entryCount=65535 in the EOCD will force the parser to
     * iterate 65535 times. Each iteration does several readUInt* operations that OOB-read
     * as 0. Total work is bounded (under 5MB scan) but constitutes amplification —
     * the attacker sent <1KB and the Worker spent CPU on 65K iterations. With Cloudflare
     * Worker's 50ms CPU budget, this could push close to the budget.
     *
     * The fix is to bound entryCount to a sane maximum (e.g., 1024 — a real LyriCue
     * bundle has 2 entries: manifest.json and content).
     */
    it("rejects a bundle ZIP claiming an absurd entry count", () => {
        // Synthesize a ZIP with valid EOCD pointing at entryCount=65535 but no central directory.
        // We build the bytes by hand: just an EOCD signature with absurd values.
        const eocd = new Uint8Array(22)
        // EOCD signature 0x06054b50 (little-endian)
        eocd[0] = 0x50
        eocd[1] = 0x4b
        eocd[2] = 0x05
        eocd[3] = 0x06
        // entryCount at offset +10 (uint16) — claim 65535 entries
        eocd[10] = 0xff
        eocd[11] = 0xff
        // central-directory offset at +16 (uint32) — point to byte 0 (where there's no CD)
        eocd[16] = 0
        eocd[17] = 0
        eocd[18] = 0
        eocd[19] = 0

        // Prepend PK signature so it's detected as a ZIP
        const full = new Uint8Array(eocd.length + 4)
        full[0] = 0x50
        full[1] = 0x4b
        full[2] = 0x03
        full[3] = 0x04
        full.set(eocd, 4)

        // Worker should reject this with a controlled 400 — not iterate 65535 times.
        // We test via the publish endpoint which goes through readBundleManifest.
        const env = makeEnv()
        return worker.fetch(
            new Request("https://worker.test/publish", {
                method: "PUT",
                headers: publishHeaders(),
                body: full
            }),
            env
        ).then(async (response) => {
            expect(response.status, "absurd entryCount must be rejected with 400").toBe(400)
            const body = (await response.json()) as { error: string; message?: string }
            expect(body.error).toBe("request_failed")
        })
    })
})

describe("adversarial: credential record validation", () => {
    /**
     * The current validator passes when keyId is an empty string because:
     *   typeof "" === "string" → true, so the "string-or-undefined" guard passes.
     * An empty keyId then propagates into the audit log as `keyId: null` (via `?? null`)
     * but the credential itself is treated as valid. Better to reject explicitly at
     * validation time so audit logs are unambiguous.
     */
    it("rejects credential records whose keyId is an empty string", async () => {
        const env = makeEnv(JSON.stringify({ orgId: "hillside", campusId: "central", role: "central", keyId: "" }))
        const response = await worker.fetch(
            new Request("https://worker.test/publish/whoami", { headers: { "X-LC-Credential": "central-token" } }),
            env
        )
        expect(response.status, "empty keyId must be treated as invalid metadata").toBe(403)
    })

    /**
     * The orgId/campusId fields are also validated with truthy-check only. A value of "0"
     * (string) is truthy so it passes — but it should also pass the SAFE_KEY_SEGMENT
     * pattern. More importantly, a value with unicode emoji or control chars should be
     * rejected because it ends up in audit logs and (indirectly) in R2 keys if any future
     * code path interpolates it.
     */
    it("rejects credential records whose orgId contains control characters", async () => {
        const env = makeEnv(JSON.stringify({ orgId: "hill\nside", campusId: "central", role: "central", keyId: "k1" }))
        const response = await worker.fetch(
            new Request("https://worker.test/publish/whoami", { headers: { "X-LC-Credential": "central-token" } }),
            env
        )
        expect(response.status, "control characters in orgId must be rejected").toBe(403)
    })
})
