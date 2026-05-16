# EP-10 Operator Window Defect Closure — 2026-05-16

**Scope:** Follow-up closure pass for D13-D18 from `EP-10-operator-window-2026-05-16.md`.
**Branch:** `codex/fix-ep10-operator-defects`
**Status:** **Closed** — all six defects fixed or made non-reproducible in the dual-window E2E path.

## Disposition

| Defect | Severity | Disposition |
|---|---:|---|
| D13 — selectedDeviceId evaporates after selection | HIGH | Fixed. Main process now persists `operatorSelectedDeviceId`; state broadcasts no longer derive selection from one-off command hints. |
| D15 — AudioDevicePicker mounts before IPC state | HIGH | Fixed. Operator renderer defers `SetlistPanel` construction until the first state envelope, so the picker enumerates against hydrated state. |
| D16 — keyboard router steals keys from focused controls | MEDIUM | Fixed. Shortcut routing now bypasses input, textarea, select, button, link, and contenteditable targets. |
| D17 — operator state broadcasts at frame cadence | MEDIUM | Fixed. SyncEngine state changes now schedule operator broadcasts at a 200ms control-plane cadence; karaoke SyncFrames remain at frame cadence. |
| D14 — macOS Dock activate does not restore operator window | LOW | Fixed. Dock activate respawns the operator window when the karaoke adapter is still running. |
| D18 — latent ipcMain handler leak on operator respawn | INFO | Fixed. Operator IPC handlers are removed before registration, on operator close, and during shutdown. |

## Verification

- `npx vitest run packages/ui/src/AudioDevicePicker.test.ts apps/sister/src/renderer/operator-shortcuts.test.ts` — 24 passing.
- `npx tsc -b` — clean.
- `cd packages/ui && npx svelte-check --tsconfig tsconfig.json` — 0 errors, 0 warnings.
- `npx vitest run` — 561 passing, 3 skipped.
- `cd python-sidecar && .venv/bin/pytest -q` — 30 passing.
- `LC_DEPLOYMENT_MODE=sister LC_E2E_MODE=1 LC_VERBOSE=1 LC_CAPTURE_EVIDENCE=1 electron apps/sister/dist-electron/main.js` — dual-window capture completed; dropped frames remained 0.

## Evidence

Refreshed evidence screenshots were written under:

- `docs/qa-reports/evidence/ep09-e2e-2026-05-15/`
- `docs/qa-reports/evidence/ep10-operator-window-2026-05-15/`

The operator screenshot now shows `Synthetic 120 BPM (E2E demo)` present and selected on first paint.
