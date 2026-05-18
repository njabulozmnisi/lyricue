import { describe, expect, it } from "vitest"
import { createElectronSafeStorageSecretStorage, type ElectronSafeStorageLike } from "./electron-safe-storage.js"

function createFakeSafeStorage(available = true): ElectronSafeStorageLike {
    return {
        isEncryptionAvailable: () => available,
        encryptString: (plaintext) => Buffer.from(`encrypted:${Buffer.from(plaintext).toString("base64")}`),
        decryptString: (encrypted) => {
            const encoded = encrypted.toString()
            if (!encoded.startsWith("encrypted:")) throw new Error("Bad encrypted payload")
            return Buffer.from(encoded.slice("encrypted:".length), "base64").toString()
        }
    }
}

describe("createElectronSafeStorageSecretStorage", () => {
    it("stores only an encrypted base64 handle and can reveal the credential", async () => {
        const storage = createElectronSafeStorageSecretStorage(createFakeSafeStorage())
        const ref = await storage.store("central-1", "credential-secret")

        expect(ref.keyId).toBe("central-1")
        expect(ref.handle).not.toContain("credential-secret")
        await expect(storage.reveal(ref)).resolves.toBe("credential-secret")
    })

    it("reports unavailable encryption and rejects store/reveal when safeStorage is unavailable", async () => {
        const storage = createElectronSafeStorageSecretStorage(createFakeSafeStorage(false))

        expect(storage.isAvailable()).toBe(false)
        await expect(storage.store("central-1", "credential-secret")).rejects.toThrow("not available")
        await expect(storage.reveal({ keyId: "central-1", handle: "ignored" })).rejects.toThrow("not available")
    })

    it("treats remove as an idempotent no-op because the encrypted bytes live in the ref", async () => {
        const storage = createElectronSafeStorageSecretStorage(createFakeSafeStorage())
        await expect(storage.remove({ keyId: "central-1", handle: "ignored" })).resolves.toBeUndefined()
    })
})
