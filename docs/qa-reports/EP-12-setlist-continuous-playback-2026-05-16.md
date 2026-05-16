# EP-12 Setlist & Continuous Playback QA Report — 2026-05-16

**Scope:** EP-12 implementation slice: mode-agnostic project/setlist contracts, sync-status derivation, learned-song loading, songComplete auto-advance, VAD-active engagement for waiting songs, sister-mode E2E wiring, and the congregation-facing "Next:" karaoke hint.
**Branch:** `main`
**Status:** **Pass-with-known-blockers** — core setlist behavior and local sister-mode visual surfaces are implemented and verified; real FreeShow project adapters remain blocked by host API/runtime availability.

## Coverage

| Story | Status | Notes |
|---|---:|---|
| 12.1 Project read adapter | Partial | Added `ProjectAdapter` contract and in-memory adapter. Fork store and sister REST adapters are deferred until FreeShow runtime/API access is available. |
| 12.2 Setlist sync-status badges | Pass | `deriveSetlistSongs()` maps project show refs through timing-map existence and feeds `SetlistPanel`. |
| 12.3 Auto-advance between songs | Pass | `SetlistController` listens for `songComplete`, loads the next learned map, sends it to the output adapter, and engages when VAD is active. |
| 12.4 Non-learned pass-through | Partial | Controller forces manual tier, clears the active song, and emits `onPassThrough`. Hiding/yielding the sister output is deferred until the host renderer handoff exists. |
| 12.5 Jump-to-song from setlist | Pass | Operator `selectSong` commands now route through `SetlistController.jumpToSong()`. |
| 12.6 Next-up indicator | Pass | Operator panel receives `nextSongTitle`; `SyncFrame.nextSongTitle` now carries the congregation hint during the final section, and `KaraokeOutput` renders `Next: <title>` at the bottom of the output. |

## Verification

- `npx vitest run packages/ui/src/KaraokeOutput.test.ts packages/core/src/output/sync-frame-fixture.test.ts packages/core/src/setlist/setlist-controller.test.ts` — 42 passing.
- `npx tsc -b` — clean.
- `cd packages/ui && npx svelte-check --tsconfig tsconfig.json` — 0 errors, 0 warnings.
- `npx vitest run` — 585 passing.
- `cd python-sidecar && .venv/bin/pytest -q` — 30 passing.
- `LC_DEPLOYMENT_MODE=sister LC_E2E_MODE=1 LC_VERBOSE=1 LC_CAPTURE_EVIDENCE=1 electron apps/sister/dist-electron/main.js` — dual-window capture completed, `Next: Walking-Skeleton Reprise` rendered on the karaoke output, second `LC_LOAD_MAP` observed when the controller advanced to the reprise item, dropped frames remained 0.

## Evidence

Refreshed karaoke evidence is in `docs/qa-reports/evidence/ep09-e2e-2026-05-15/`; `01-first-word-active.png` shows the congregation-facing `Next: Walking-Skeleton Reprise` hint. Refreshed operator evidence is in `docs/qa-reports/evidence/ep10-operator-window-2026-05-15/`; the final capture shows the two-item project with `Walking-Skeleton Reprise` marked as the active setlist item after the first map completes.
