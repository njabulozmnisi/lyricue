/**
 * LibraryConfig — per-install configuration for the shared song library.
 *
 * Per architecture.md §6.4:
 *   - The library URL is public-by-obscurity (no read auth gates).
 *   - publishCredential.secretRef holds a handle into the OS keychain; the raw secret
 *     never appears in plaintext on disk. Storage / retrieval is handled by the
 *     SecretRef abstraction (see settings/secrets.ts).
 *   - trustedPublicKeys is the local Ed25519 trust list per ADR-13. Bundles signed by
 *     keys outside this list trigger a UI warning during import; tampered bundles are
 *     hard-rejected.
 *   - catalogCacheTtlSeconds: 0 by default per ADR-15 (manual-pull-only).
 */

import { z } from "zod"
import { SCHEMA_LYRICUE_LIBRARY_CONFIG_V1 } from "./schema-versions.js"

/**
 * A keychain-stored secret reference. The raw secret is *never* in this object.
 * Main-process code resolves a `SecretRef` to its plaintext via Electron `safeStorage`.
 * Renderer code only sees the handle.
 *
 * The keyId is a short user-visible identifier (e.g. "central-2026-q1") that the operator
 * can display without leaking secret material. It is NOT cryptographic — it's a label.
 */
export const SecretRefSchema = z.object({
    keyId: z.string().min(1).max(80),
    handle: z.string().min(1) // opaque pointer into the OS keychain
})
export type SecretRef = z.infer<typeof SecretRefSchema>

export const TrustedKeySchema = z.object({
    keyId: z.string().min(1).max(80),
    publicKey: z.string().min(1), // base64 Ed25519
    label: z.string().min(1).max(200),
    addedAt: z.string().datetime()
})
export type TrustedKey = z.infer<typeof TrustedKeySchema>

export const PublishCredentialTypeSchema = z.enum([
    "cloudflare-worker-token",
    "s3-iam",
    "github-pat"
])
export type PublishCredentialType = z.infer<typeof PublishCredentialTypeSchema>

export const LibraryConfigSchema = z.object({
    $schema: z.literal(SCHEMA_LYRICUE_LIBRARY_CONFIG_V1),

    /**
     * Whether the library is in use at all. When false, all library UI is hidden and
     * no network calls are made. Anonymous local-only installs run with `enabled: false`.
     */
    enabled: z.boolean(),

    /**
     * The primary library URL. Cloudflare R2 endpoint per ADR-11 — the church's setup
     * script provisions this. Null when `enabled: false`.
     */
    primaryUrl: z.string().url().nullable(),

    /**
     * Disaster-recovery mirror URL (typically a GitHub raw URL). When the primary fails,
     * the LM falls back to this. Null when no mirror is configured.
     */
    mirrorUrl: z.string().url().nullable(),

    /**
     * Present only on installs that publish (central team, or a campus with write access).
     * Most installs are read-only and omit this field entirely.
     */
    publishCredential: z
        .object({
            type: PublishCredentialTypeSchema,
            keyId: z.string().min(1).max(80).optional(),
            secretRef: SecretRefSchema
        })
        .optional(),

    /**
     * Signing config — opt-in per ADR-13. When signing.enabled is false, this install
     * publishes unsigned bundles (which produces a soft warning on import elsewhere).
     */
    signing: z
        .object({
            enabled: z.boolean(),
            privateKeyRef: SecretRefSchema.optional(),
            publicKeyId: z.string().min(1).max(80).optional()
        })
        .optional(),

    /**
     * Trust list for incoming signed bundles. Empty array = "verify nothing" (every bundle
     * is treated as unsigned during import — same UX as bundles that genuinely lack signatures).
     */
    trustedPublicKeys: z.array(TrustedKeySchema).default([]),

    /**
     * 0 = manual-pull-only (the default per ADR-15). Higher values enable a soft cache window:
     * the catalog is considered fresh for N seconds after a manual fetch, so successive
     * operator "Check Library" clicks don't hammer the endpoint. The UI still drives all fetches.
     */
    catalogCacheTtlSeconds: z.number().int().nonnegative().default(0)
})

export type LibraryConfig = z.infer<typeof LibraryConfigSchema>

/**
 * Disabled library — the default until the first-run wizard configures one.
 */
export const DEFAULT_LIBRARY_CONFIG: LibraryConfig = {
    $schema: SCHEMA_LYRICUE_LIBRARY_CONFIG_V1,
    enabled: false,
    primaryUrl: null,
    mirrorUrl: null,
    trustedPublicKeys: [],
    catalogCacheTtlSeconds: 0
}
