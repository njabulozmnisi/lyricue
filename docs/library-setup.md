# LyriCue Library Setup

This is the operator-facing setup path for a shared LyriCue song library.

## Prerequisites

- Cloudflare account with R2 enabled.
- Wrangler authenticated to the target Cloudflare account.
- Optional GitHub repository and fine-scoped token for the disaster-recovery mirror.

## Bucket Layout

```text
catalog.json
songs/<songId>/<bundleVersion>.lcbundle
meta/publish-log.jsonl
trust.json
```

## Worker Setup

Estimated time: 15 minutes when the Cloudflare account already exists.

1. Dry-run the setup plan:

```bash
node infra/publish-worker/setup-library.mjs \
  --dry-run \
  --org-id=hillside \
  --org-name="Hillside Church" \
  --account-id=<cloudflare-account-id> \
  --github-repo=hillside/lyricue-library
```

2. Review the printed Wrangler commands and artifact paths.
3. Run the same command with `--dry-run=false` from the repository root when ready. The script:
   - creates or reuses the R2 bucket layout;
   - creates the Worker KV namespace for publish credentials;
   - deploys `infra/publish-worker`;
   - generates the central publish credential;
   - generates an Ed25519 signing keypair;
   - uploads `trust.json` to the library bucket;
   - configures the optional GitHub mirror secret/vars.
4. Store the generated `central-credential.txt` and `central-signing-private.pem` in the admin's password manager or keychain.
5. Publish a `.lcbundle` with `PUT /publish` and header `X-LC-Credential`.
6. Verify `catalog.json` updates, `meta/publish-log.jsonl` receives an entry, and the GitHub mirror receives matching commits if configured.

Credential values stored in KV use this JSON shape:

```json
{
  "orgId": "hillside",
  "campusId": "central",
  "role": "central",
  "keyId": "central-2026-q1"
}
```

## Disaster Recovery Drill

1. Configure a client with the primary library URL plus the GitHub raw mirror URL.
2. Point the primary URL to a nonexistent host.
3. Run a catalog refresh. The client should fetch `catalog.json` from the mirror and surface the backup-mirror hint.
4. Download a bundle from the mirror and verify its SHA256 against the mirrored catalog entry.

## Current Caveats

- The script can generate local setup artifacts and execute Wrangler commands, but this repository has not yet been verified against a real church-owned Cloudflare account.
- Screenshots are intentionally omitted until the exact Cloudflare account flow is available.
