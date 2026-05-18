#!/usr/bin/env node
import { generateKeyPairSync, randomBytes } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { chmod } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { spawnSync } from "node:child_process"

const args = parseArgs(process.argv.slice(2))
const dryRun = args["dry-run"] !== "false"
const rl = createInterface({ input, output })

try {
    const orgId = normalizeOrgId(args["org-id"] ?? (await ask("Org ID (will be in URLs): ")))
    const orgName = args["org-name"] ?? (await ask("Org name: "))
    const accountId = args["account-id"] ?? (await ask("Cloudflare account ID: "))
    const bucketName = args["bucket"] ?? `${orgId}-lyricue-library`
    const workerName = args["worker"] ?? `${orgId}-lyricue-publish`
    const namespaceName = args["credentials-namespace"] ?? `${orgId}-lyricue-credentials`
    const publicBaseUrl = args["public-base-url"] ?? `https://${bucketName}.r2.dev`
    const githubRepo = args["github-repo"]
    const outputDir = args["output-dir"] ?? join(homedir(), `.lyricue-library-${orgId}`)
    const token = randomBytes(24).toString("base64url")
    const credential = {
        orgId,
        campusId: "central",
        role: "central",
        keyId: "central-1"
    }
    const { privateKey, publicKey } = generateKeyPairSync("ed25519")
    const trust = {
        $schema: "lyricue-trust-v1",
        orgId,
        orgName,
        generatedAt: new Date().toISOString(),
        keys: [
            {
                keyId: "central-1",
                algorithm: "ed25519",
                publicKeyPem: publicKey.export({ type: "spki", format: "pem" })
            }
        ]
    }
    const credentialJson = JSON.stringify(credential)
    const commands = [
        ["wrangler", "r2", "bucket", "create", bucketName],
        ["wrangler", "kv", "namespace", "create", namespaceName],
        ["wrangler", "deploy", "--config", "infra/publish-worker/wrangler.toml", "--name", workerName, "--var", `PUBLIC_BASE_URL:${publicBaseUrl}`],
        ["wrangler", "kv", "key", "put", token, credentialJson, "--namespace-id", `<${namespaceName}-id>`],
        ["wrangler", "r2", "object", "put", `${bucketName}/trust.json`, "--file", join(outputDir, "trust.json")]
    ]
    if (githubRepo) {
        commands.splice(3, 0, ["wrangler", "secret", "put", "GITHUB_MIRROR_TOKEN", "--name", workerName])
        commands.splice(4, 0, [
            "wrangler",
            "deploy",
            "--config",
            "infra/publish-worker/wrangler.toml",
            "--name",
            workerName,
            "--var",
            `GITHUB_MIRROR_REPO:${githubRepo}`
        ])
    }

    console.log(`LyriCue library setup plan for ${orgName} (${accountId})`)
    console.log(`Artifacts: ${outputDir}`)
    for (const command of commands) console.log(`$ ${command.join(" ")}`)
    if (dryRun) {
        console.log("Dry run only; no files or Cloudflare resources were changed. Pass --dry-run=false to execute.")
        process.exit(0)
    }

    mkdirSync(outputDir, { recursive: true })
    writeFileSync(join(outputDir, "central-credential.txt"), `${token}\n`, { mode: 0o600 })
    writeFileSync(join(outputDir, "central-credential.json"), JSON.stringify(credential, null, 2), { mode: 0o600 })
    writeFileSync(join(outputDir, "central-signing-private.pem"), privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 })
    writeFileSync(join(outputDir, "trust.json"), JSON.stringify(trust, null, 2))
    await chmod(join(outputDir, "central-credential.txt"), 0o600)
    await chmod(join(outputDir, "central-credential.json"), 0o600)
    await chmod(join(outputDir, "central-signing-private.pem"), 0o600)

    for (const command of commands) runIdempotent(command)
    console.log(`Setup complete. Library URL: ${publicBaseUrl}`)
} finally {
    rl.close()
}

async function ask(prompt) {
    const value = (await rl.question(prompt)).trim()
    if (!value) throw new Error(`${prompt.trim()} is required.`)
    return value
}

function parseArgs(values) {
    const parsed = {}
    for (const value of values) {
        if (!value.startsWith("--")) continue
        const [key, raw = "true"] = value.slice(2).split("=", 2)
        parsed[key] = raw
    }
    return parsed
}

function runIdempotent(command) {
    const result = spawnSync(command[0], command.slice(1), { encoding: "utf8" })
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.status === 0) return
    const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.toLowerCase()
    if (combined.includes("already exists") || combined.includes("already_exist") || combined.includes("exists")) {
        console.warn(`Continuing because resource already exists: ${command.join(" ")}`)
        return
    }
    process.exit(result.status ?? 1)
}

function normalizeOrgId(value) {
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    if (!normalized) throw new Error("Organization ID must contain at least one letter or number.")
    return normalized
}
