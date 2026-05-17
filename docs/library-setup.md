# LyriCue Library Setup

This is the operator-facing setup path for a shared LyriCue song library.

## Prerequisites

- Cloudflare account with R2 enabled.
- A private Worker route for publishing.
- A public-read base URL for `catalog.json` and `songs/`.
- A central publish credential issued to the library administrator.

## Bucket Layout

```text
catalog.json
songs/<songId>/<bundleVersion>.lcbundle
meta/publish-log.jsonl
trust.json
```

## Worker Setup

1. Create an R2 bucket, for example `lyricue-library`.
2. Bind it to the Worker as `LIBRARY`.
3. Create a KV namespace for publish credentials and bind it as `CREDENTIALS`.
4. Store each credential token as a KV key. The value is JSON:

```json
{
  "orgId": "hillside",
  "campusId": "central",
  "role": "central",
  "keyId": "central-2026-q1"
}
```

5. Deploy `infra/publish-worker` with Wrangler.
6. Publish a `.lcbundle` with `PUT /publish` and header `X-LC-Credential`.
7. Verify `catalog.json` updates and `meta/publish-log.jsonl` receives an entry.

## Current Caveats

- The setup script is not automated yet; provision R2/KV manually.
- Screenshots are intentionally omitted until the exact Cloudflare account flow is available.
- GitHub mirror and signing-key upload are planned follow-up work.
