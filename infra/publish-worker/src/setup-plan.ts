export interface SetupLibraryInput {
    orgId: string
    orgName: string
    cloudflareAccountId: string
    publicBaseUrl?: string
    bucketName?: string
    workerName?: string
    credentialsNamespaceName?: string
    githubMirrorRepo?: string
    generateSigningKey?: boolean
    generateCentralCredential?: boolean
}

export interface SetupLibraryPlan {
    orgId: string
    orgName: string
    bucketName: string
    workerName: string
    credentialsNamespaceName: string
    publicBaseUrl: string
    commands: string[]
    artifacts: Array<{ path: string; description: string; sensitive: boolean }>
}

export function buildSetupLibraryPlan(input: SetupLibraryInput): SetupLibraryPlan {
    const orgId = normalizeOrgId(input.orgId)
    const bucketName = input.bucketName ?? `${orgId}-lyricue-library`
    const workerName = input.workerName ?? `${orgId}-lyricue-publish`
    const credentialsNamespaceName = input.credentialsNamespaceName ?? `${orgId}-lyricue-credentials`
    const publicBaseUrl = input.publicBaseUrl ?? `https://${bucketName}.r2.dev`
    const commands = [
        `wrangler r2 bucket create ${bucketName}`,
        `wrangler kv namespace create ${credentialsNamespaceName}`,
        `wrangler deploy --config infra/publish-worker/wrangler.toml --name ${workerName} --var PUBLIC_BASE_URL:${publicBaseUrl}`
    ]
    if (input.githubMirrorRepo) {
        commands.push(`wrangler secret put GITHUB_MIRROR_TOKEN --name ${workerName}`)
        commands.push(
            `wrangler deploy --config infra/publish-worker/wrangler.toml --name ${workerName} --var GITHUB_MIRROR_REPO:${input.githubMirrorRepo}`
        )
    }
    if (input.generateCentralCredential ?? true) {
        commands.push(`wrangler kv key put <central-token> '<central-credential-json>' --namespace-id <${credentialsNamespaceName}-id>`)
    }
    if (input.generateSigningKey ?? true) {
        commands.push(`wrangler r2 object put ${bucketName}/trust.json --file ./trust.json`)
    }

    return {
        orgId,
        orgName: input.orgName.trim(),
        bucketName,
        workerName,
        credentialsNamespaceName,
        publicBaseUrl,
        commands,
        artifacts: [
            { path: "central-credential.txt", description: "Central publish credential token.", sensitive: true },
            { path: "central-credential.json", description: "Credential metadata uploaded to Workers KV.", sensitive: true },
            { path: "central-signing-private.pem", description: "Ed25519 private signing key.", sensitive: true },
            { path: "trust.json", description: "Public signing trust list uploaded beside catalog.json.", sensitive: false }
        ]
    }
}

export function normalizeOrgId(value: string): string {
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    if (!normalized) throw new Error("Organization ID must contain at least one letter or number.")
    return normalized
}
