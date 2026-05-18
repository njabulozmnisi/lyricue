import { describe, expect, it } from "vitest"
import { DEFAULT_LIBRARY_CONFIG, type SecretRef } from "../types/library-config.js"
import {
    clearPublishCredential,
    configurePublishCredential,
    configureSigningKey,
    revealPublishCredential
} from "./library-credentials.js"
import type { SecretStorage } from "./secret-storage.js"

class MemorySecretStorage implements SecretStorage {
    readonly secrets = new Map<string, string>()
    async store(keyId: string, plaintext: string): Promise<SecretRef> {
        const handle = `mem:${keyId}`
        this.secrets.set(handle, plaintext)
        return { keyId, handle }
    }
    async reveal(ref: SecretRef): Promise<string> {
        const value = this.secrets.get(ref.handle)
        if (!value) throw new Error("missing secret")
        return value
    }
    async remove(ref: SecretRef): Promise<void> {
        this.secrets.delete(ref.handle)
    }
    isAvailable(): boolean {
        return true
    }
}

describe("library credential helpers", () => {
    it("stores publish credentials only as a SecretRef", async () => {
        const storage = new MemorySecretStorage()
        const config = await configurePublishCredential(DEFAULT_LIBRARY_CONFIG, storage, "credential-secret", "central-1")

        expect(config.publishCredential?.secretRef).toEqual({ keyId: "central-1", handle: "mem:central-1" })
        expect(JSON.stringify(config)).not.toContain("credential-secret")
        await expect(revealPublishCredential(config, storage)).resolves.toBe("credential-secret")
    })

    it("removes publish credentials from config and secure storage", async () => {
        const storage = new MemorySecretStorage()
        const config = await configurePublishCredential(DEFAULT_LIBRARY_CONFIG, storage, "credential-secret", "central-1")
        const next = await clearPublishCredential(config, storage)

        expect(next.publishCredential).toBeUndefined()
        expect(storage.secrets.size).toBe(0)
    })

    it("stores signing private keys as SecretRefs and publishes public keys into trust config", async () => {
        const storage = new MemorySecretStorage()
        const config = await configureSigningKey(DEFAULT_LIBRARY_CONFIG, storage, {
            keyId: "central-signing",
            privateKey: "private-key",
            publicKey: "public-key",
            label: "Central",
            addedAt: "2026-05-18T00:00:00.000Z"
        })

        expect(config.signing).toMatchObject({ enabled: true, publicKeyId: "central-signing" })
        expect(config.signing?.privateKeyRef?.handle).toBe("mem:central-signing")
        expect(config.trustedPublicKeys).toEqual([
            { keyId: "central-signing", publicKey: "public-key", label: "Central", addedAt: "2026-05-18T00:00:00.000Z" }
        ])
        expect(JSON.stringify(config)).not.toContain("private-key")
    })
})
