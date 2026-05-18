import type { LibraryConfig, SecretRef, TrustedKey } from "../types/library-config.js"
import type { SecretStorage } from "./secret-storage.js"

export async function configurePublishCredential(
    config: LibraryConfig,
    storage: SecretStorage,
    credential: string,
    keyId: string
): Promise<LibraryConfig> {
    if (!storage.isAvailable()) throw new Error("Secure credential storage is not available on this system.")
    const secretRef = await storage.store(keyId, credential)
    return {
        ...config,
        publishCredential: {
            type: "cloudflare-worker-token",
            keyId,
            secretRef
        }
    }
}

export async function clearPublishCredential(config: LibraryConfig, storage: SecretStorage): Promise<LibraryConfig> {
    if (config.publishCredential) await storage.remove(config.publishCredential.secretRef)
    const { publishCredential: _removed, ...next } = config
    return next
}

export async function revealPublishCredential(config: LibraryConfig, storage: SecretStorage): Promise<string | null> {
    return config.publishCredential ? storage.reveal(config.publishCredential.secretRef) : null
}

export async function configureSigningKey(
    config: LibraryConfig,
    storage: SecretStorage,
    opts: { keyId: string; privateKey: string; publicKey: string; label?: string; addedAt?: string }
): Promise<LibraryConfig> {
    if (!storage.isAvailable()) throw new Error("Secure signing-key storage is not available on this system.")
    const privateKeyRef: SecretRef = await storage.store(opts.keyId, opts.privateKey)
    const trustedKey: TrustedKey = {
        keyId: opts.keyId,
        publicKey: opts.publicKey,
        label: opts.label ?? opts.keyId,
        addedAt: opts.addedAt ?? new Date().toISOString()
    }
    const trustedPublicKeys = [
        ...config.trustedPublicKeys.filter((key) => key.keyId !== opts.keyId),
        trustedKey
    ]
    return {
        ...config,
        signing: {
            enabled: true,
            privateKeyRef,
            publicKeyId: opts.keyId
        },
        trustedPublicKeys
    }
}
