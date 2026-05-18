import type { SecretRef } from "../types/library-config.js"
import type { SecretStorage } from "./secret-storage.js"

export interface ElectronSafeStorageLike {
    isEncryptionAvailable(): boolean
    encryptString(plaintext: string): Buffer
    decryptString(encrypted: Buffer): string
}

export function createElectronSafeStorageSecretStorage(safeStorage: ElectronSafeStorageLike): SecretStorage {
    return {
        isAvailable() {
            return safeStorage.isEncryptionAvailable()
        },

        async store(keyId, plaintext) {
            if (!safeStorage.isEncryptionAvailable()) {
                throw new Error("Electron safeStorage encryption is not available.")
            }
            return {
                keyId,
                handle: safeStorage.encryptString(plaintext).toString("base64")
            }
        },

        async reveal(ref) {
            if (!safeStorage.isEncryptionAvailable()) {
                throw new Error("Electron safeStorage encryption is not available.")
            }
            return safeStorage.decryptString(Buffer.from(ref.handle, "base64"))
        },

        async remove(_ref: SecretRef) {
            // safeStorage returns self-contained encrypted bytes, so removing the persisted
            // SecretRef handle is sufficient; there is no external keychain item to delete.
        }
    }
}
