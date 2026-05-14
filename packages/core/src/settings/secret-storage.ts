/**
 * Abstraction over the host OS keychain. Defined here so core code can hold
 * `SecretRef` handles and resolve them through an injected backend, without `packages/core/`
 * depending on `electron`.
 *
 * Production backend (`ElectronSafeStorageBackend`) lives in `apps/*` and wraps
 * `electron.safeStorage.encryptString` / `decryptString` per architecture.md §6.4.
 * Test backend (`InMemorySecretStorage`) is in `test-utils/`.
 *
 * The SecretRef.handle is opaque to callers — concretely it's a base64-encoded encrypted
 * blob with safeStorage, or a UUID lookup key with a future cross-platform backend.
 */

import type { SecretRef } from "../types/library-config.js"

export interface SecretStorage {
    /**
     * Encrypts a plaintext secret and returns a SecretRef that can be persisted.
     * The keyId is a user-visible label (e.g. "central-publish-2026-Q1"); the actual
     * secret material is in `handle`.
     */
    store(keyId: string, plaintext: string): Promise<SecretRef>

    /**
     * Decrypts a previously-stored ref. Throws if the OS keychain can't decrypt
     * (e.g., the install was restored to a different user account).
     */
    reveal(ref: SecretRef): Promise<string>

    /**
     * Drops the underlying secret. Safe to call on a ref that's already been removed
     * (e.g. after a re-install) — implementations should treat absent secrets as success.
     */
    remove(ref: SecretRef): Promise<void>

    /**
     * Whether the backend is functional on this platform. Electron's safeStorage returns
     * false on Linux without an unlocked keychain; callers should warn the operator before
     * accepting publish credentials in that environment.
     */
    isAvailable(): boolean
}
