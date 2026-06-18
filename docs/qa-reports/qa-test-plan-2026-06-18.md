# QA-test plan — LyriCue local feature surface — 2026-06-18

## Under test

The complete locally-implemented LyriCue surface across packages/core, packages/ui, apps/sister, and infra/publish-worker (EP-01 through EP-20). Baseline: 793 TS + 88 Python + 16 Worker tests pass on commit a688eff. This plan attacks the surfaces from a QA perspective — boundaries, weird middle, hostile inputs, racey sequences — not from the implementer's perspective.

## Risk-ranked surface (where to spend effort)

**Tier 1 — data-loss / security / live-worship-critical:**
1. `packages/core/src/fs/atomic-write.ts` — every persisted artifact rides on this
2. `infra/publish-worker/src/index.ts` — multi-tenant security boundary
3. `packages/core/src/timing/timing-map-storage.ts` — atomic CRUD around live worship data
4. `apps/sister/src/output/OwnWindowOutputAdapter.ts` — frame delivery + pre-ready buffering
5. `packages/core/src/sync/sync-engine-state.ts` + `tick.ts` — tier-fallback under stress
6. `packages/core/src/settings/library-credentials.ts` + safe-storage — secrets

**Tier 2 — correctness / operator integrity:**
7. Arrangement builder + IPC, translation editor + IPC
8. Rehearsal capture / segmentation / variant promotion
9. Setlist controller, project-storage, REST project adapter
10. STT correction controller — live-safe gating

**Tier 3 — boundary / UX:**
11. Lyrics parser, phrase matcher, karaoke easing
12. Library catalog/bundle integrity, sidecar controller

## In scope

### Input space exploration

**Atomic write**:
- Empty content (string `""` and zero-length Buffer).
- Very large content (≥10 MB) — does fsync block forever or succeed?
- Path with spaces, unicode, emoji in filename.
- Path components with `..` segments — should NOT escape (caller's responsibility but check for path-traversal-via-content).
- Absolute path that does NOT exist deeply (10+ levels) — does mkdir recursive handle it?
- Already-existing `<path>.tmp` from a prior crash — does the next write overwrite cleanly?
- Concurrent write to the same path from two callers — last-write-wins or interleave-corruption?
- A file path that's actually a directory.

**Publish Worker**:
- Empty headers (`X-LC-Org: ""`).
- Whitespace-padded headers — `X-LC-Org: " orgA "` vs credential.orgId `"orgA"`.
- Headers with control characters (`\0`, `\n`, `\r`).
- Unicode in `orgId`, `campusId` — should the SAFE_KEY_SEGMENT regex apply to these too?
- A bundle whose manifest has unicode `songId` — passes `SAFE_KEY_SEGMENT` only with ASCII.
- A bundle ZIP with a manifest.json larger than the bundle (corrupt offsets) — does the ZIP parser bound-check?
- A bundle ZIP with a manifest.json that uses `STORED` but has a compressedSize that exceeds the file — does `readZipTextEntry` clamp?
- A bundle ZIP where `entryCount` in EOCD ≥ bytes.length — infinite-loop hazard?
- A bundle whose first two bytes are 0x504B but is actually a JSON file — parser should fall through OR fail safely.
- A bundle whose EOCD is at the absolute minimum offset (22 bytes from end) — boundary.
- A JSON bundle with manifest as a string `"manifest"` not an object — type-safety boundary.
- A bundle body of exactly 25 MB + 1 byte — limit boundary.
- A `X-LC-Target: CENTRAL` (wrong case) — currently rejected; verify.
- A credential record whose `role` is `"central\n"` — currently rejected.
- A `keyId` that's an empty string — currently passes `!== undefined && typeof === "string"` ✗ defect candidate.

**Timing-map storage**:
- A showId that contains `/` or `..` — should produce a path traversal? (depends on `timingMapPath` implementation — need to read).
- A timing map saved to one showId where map.showId disagrees — guarded.
- `loadVariant` with a variant string outside `"studio" | "rehearsal"` — TS narrows, but if called from IPC, could be runtime drift.
- A timing map file containing `null` (literally `"null"`) — JSON.parse succeeds, validator should reject.
- A timing map file ending in incomplete UTF-8 sequence.
- A file with BOM at the start — JSON.parse rejects.

**SyncEngine state**:
- `tempoRatio` arrives as `NaN`, `Infinity`, `-1`.
- `beatConfidence` outside [0,1] — `1.5`, `-0.1`, `NaN`.
- `vadUpdate` with state `"unknown"` cast as `"active"`.
- `forceTier` with same tier as current — current impl returns state unchanged (good).
- `nextSection` with `targetRefMs > totalDurationMs` — would jump past the end.
- `nextSection` with negative `targetRefMs`.
- `positionCorrection` with `targetRefMs` that is the same as current cursor — no-op or busy animation?
- `loadSong` mid-running song — does the previous song's cursor + position-correction state get cleared?
- `engageSync` when no song loaded — guarded (`activeTimingMap === null` → return state).
- `engageSync` after `songComplete` — does it restart correctly?
- `audioInputLost` when tier=manual — preserved per spec; verify.
- `audioInputLost` arrives while a position-correction animation is mid-flight — animation continues or drops?

### State and sequence

**OwnWindowOutputAdapter**:
- `start()` → `pushSyncFrame` → renderer-ready → `pushSyncFrame` → `loadTimingMap` AFTER ready — order is non-canonical (frames before map); does adapter cope?
- `loadTimingMap` called multiple times before ready — only last is retained (correct per code, but verify counter).
- `stop()` → `start()` → `pushSyncFrame` — adapter should be reusable.
- `start()` → window closes (OS) → `pushSyncFrame` — should drop, not throw.
- `start()` while already started — idempotent (guarded).
- `pushSyncFrame` exactly at `PENDING_FRAME_BUFFER_CAP+1` — does the shift+push behave correctly?
- Renderer-ready fires twice (race / re-mount) — second flush is no-op (buffer drained).
- `stop()` mid-flight `loadTimingMap` (race between async map send and stop).
- Errors during the pre-ready flush — verify `framesDropped` counter increments.

**SyncEngine tick loop**:
- Two `tempoUpdate` events arrive in the same tick before SE reads — second overwrites first; verify.
- `songComplete` fires while `positionCorrectionTargetMs` is set — does animation finish or get cut?
- `loadSong` while another song is finishing — clean transition?

**Timing-map storage**:
- `save()` while `load()` is in-flight on the same showId — atomic-write should serialize at the rename, but the loader gets one of: old, new, or ENOENT during the rename window.
- `delete()` while `load()` in-flight — race window.

### Negative paths and error handling

**Atomic write**:
- `fs.rename` fails (cross-device, permission) — caller error vs swallow?
- `handle.sync()` throws — caller's data is in tempfile but not at final path; is the tempfile cleaned up?
- The directory fsync swallows errors silently — verify intentional.

**Publish Worker**:
- KV.get throws (not just returns null) — does the Worker leak the stack trace in `internal_error`?
- R2.put throws mid-publish — was the GitHub mirror already called? Half-publish state?
- `regenerateCatalog` reads a stored bundle whose manifest is now invalid — does it skip-and-continue or crash the catalog regeneration?
- GitHub mirror fails — currently swallowed; verify the warning is logged but the publish still succeeds.
- Rate-limit KV.get returns a corrupt non-numeric string — `Number.parseInt` returns NaN; `NaN >= limit` is false → silent rate-limit bypass.
- `Number.parseInt(env.RATE_LIMIT_WRITES_PER_HOUR ?? "60", 10)` — if env var is `"unlimited"`, NaN, comparison fails open.
- Empty/missing `LIBRARY` binding — assumed present; crash hazard.

**Timing-map storage**:
- Disk-full during `save()` — partial tempfile orphaned.
- Cross-filesystem path rename — degrades silently.
- `loadArrangements` with arrangement[i].showId set but file's overall structure invalid — caught by validateArrangements first.

### Integration reality

- Cross-platform path separators in showId — Windows `\` vs POSIX `/`.
- Filesystem case-sensitivity — APFS case-insensitive vs ext4 case-sensitive.
- DST / timezone — `new Date().toISOString()` is UTC so safe; but `Math.floor(Date.now() / 3_600_000)` for rate-limit buckets crosses hour boundaries — burst on the boundary.
- Clock skew between Worker and KV (eventual consistency).
- Bundle ZIP with extra fields (DataDescriptor flag set, Zip64) — the parser assumes simple format.
- Sidecar JSON-RPC with very large lyric text — newline-delimited framing OK?

### Concurrency and load

- Two concurrent publishes from same campus at exactly the rate-limit hour boundary — bucket key changes mid-flight.
- Many `pushSyncFrame` calls before ready (200 frames in <16ms) — should drop ~140, keep last 60.
- `applyEvent` is pure, but the surrounding subscriber broadcast may not be — verify subscriber error isolation.
- Operator window IPC under burst load — broadcast cap honored?

### Security posture

- Path traversal via showId — if showId is `../../../etc/passwd`, does `timingMapPath` block it?
- Path traversal via Publish Worker — does `assertSafeKeySegment` cover ALL key segments including the leading `songs/`/`projects/` prefixes? Already does for IDs.
- Replay attack — same `X-LC-Credential` token used twice within 1ms — both pass; rate-limit catches eventual misuse.
- HTTP-header smuggling — `X-LC-Credential` with `\r\n` — fetch API normalizes; verify locally.
- Worker `internal_error` leaks `(err as Error).message` — should this be redacted?
- Safe-storage wrapper — does it overwrite the same keyId atomically? What if the SecretStorage backend silently fails?
- `revealPublishCredential` — does it log the secret to console on error?
- Sidecar lyrics with embedded shell metacharacters — Demucs subprocess invocation safe?

### Regression and compatibility

- Reading a v0 timing map written by an old build (synthetic baseline migration) — migration framework covers this; verify.
- Reading a v2 timing map (future version) — should reject loudly per design.
- Loading a settings file written by an older schema — does the settings schema have a version?
- An arrangement file written before the same-ID-update fix — does it still load?
- The .show meta-pointer hooks: if a host registers them and the host raises during `onSaveMetaPointer`, the save has already committed — is this exposed?

### Observability

- `pushSyncFrame` failures increment `framesDropped` and record `lastError`. If 100 failures occur, `lastError` is the last one — earlier failures are lost. Acceptable but worth confirming.
- `loadTimingMap` failure (window.send throws) records `lastError` but DOES NOT increment `framesDropped` (right — it's not a frame). Verify the operator can see this state.
- Worker's `console.warn` on GitHub mirror failure — never reaches the LyriCue UI; is that intentional?
- Operator IPC — does the renderer log when it drops a stale payload?

### User-shaped

- An operator triggers `forceTier(timer)` exactly when `audioInputLost` fires — race between two onTier transitions.
- Operator hits Space twice within 5ms — `engageSync` debounce?
- Operator opens settings, edits a shortcut to match another shortcut, saves — conflict detection (already in `keyboard-shortcuts.ts`); verify.
- Operator deletes credential while a publish is in-flight — does the in-flight publish complete or fail?
- Operator closes operator window mid-rehearsal-capture — does the WAV writer flush cleanly?

## Out of scope (with reason)

- **External infra (Cloudflare, GitHub mirror, code-signing, real audio hardware)** — Gate C/D/E external proofs; the user explicitly scoped these out.
- **FreeShow fork-mode runtime** — requires vendor SDKs that aren't installed.
- **Visual/perceptual karaoke smoothness** — already addressed via tempo-adaptive easing + operator live verification.
- **PyInstaller packaged-binary launch** — covered by existing Gate D smoke; out of adversarial scope here.

## Open risks (flagged, not tested)

- **Real Cloudflare R2 list pagination behavior** — Worker's `regenerateCatalog` iterates `listed.objects` without pagination; if a tenant exceeds the 1000-object batch, only the first page is in the catalog. Mocked R2 in tests doesn't paginate. Needs Gate C external proof.
- **Disk-full + concurrent writes** — can be simulated but isn't part of fixture tests; needs a host-level fault-injection harness.
- **Electron renderer crash mid-broadcast** — adapter handles `window.isDestroyed()` but not the in-between state where the renderer is being destroyed but `isDestroyed()` hasn't flipped yet.
- **Sidecar subprocess hang during cancel** — covered by SIGTERM but no proof that a stuck Demucs in `ctypes`-bound C code respects SIGTERM.
- **GitHub mirror rate-limit (5000 req/hr)** — Worker fires a mirror call per write; bulk import would exceed; not tested.

