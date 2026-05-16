# Codex Handoff QA Report — 2026-05-16

**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** LyriCue walking skeleton in sister mode: D13-D18 re-verification, tempo-adaptive karaoke easing, LC_DEMO_MODE and LC_E2E_MODE launch paths, and operator IPC surface checks.
**Environment:** Local dev, macOS, branch `codex/fix-ep10-operator-defects`, Electron app launched from `/Users/njabulomnisi/Projects/Dojo/worshipsync` with the required `env -i` Node 25 wrapper.
**Status:** Pass-with-caveats

## Executive summary

Current HEAD is ahead of the stale handoff snapshot: D13-D18 from `EP-10-operator-window-2026-05-16.md` are no longer reproducible on this branch. The sister-mode walking skeleton launches cleanly in both real SyncEngine E2E mode and legacy demo mode, with renderer frames delivered, load maps received, capture screenshots written, and no dropped frames in the observed run.

No new **CRITICAL** or **HIGH** defects surfaced in this pass. The caveat is scope: this was a local Electron walking-skeleton pass, not a production FreeShow fork, packaged-app, external microphone, or ML sidecar certification pass.

## Test environment + persona setup

- Repo state: pass. `git status --short` showed only untracked `.claude/`, which the operator explicitly instructed agents to ignore.
- Branch/version: pass. Branch `codex/fix-ep10-operator-defects`; HEAD `860407c feat:(#EP-08): add STT phrase matcher`.
- Runtime: pass. `env -i ... node -v` returned `v25.9.0`; `npm -v` returned `11.12.1`.
- TypeScript: pass. `env -i ... npx tsc -b` completed cleanly.
- UI bundles: pass. `apps/sister` karaoke and operator Vite builds both completed cleanly.
- Svelte diagnostics: pass. `svelte-check` found 0 errors and 0 warnings.
- Test floor: pass. `npx vitest run` passed 585 tests across 40 files; `python-sidecar/.venv/bin/pytest -q` passed 30 tests.
- API/DB/services: not applicable to this walking skeleton. There is no HTTP API, Prisma DB, Redis, MinIO, mailer, or queue dependency in the scoped Electron path.
- Persona: local tech operator. No auth persona is required; the app has no login/session boundary in this scope.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| TC-01 | Pre-flight build/test floor | Local operator | TypeScript, bundles, Svelte, TS tests, Python tests pass | `tsc -b`, two Vite builds, 585 TS tests, 30 Python tests, and `svelte-check` passed | Pass |
| TC-02 | D13 selected-device persistence | Local operator | Device chosen in operator window remains selected after state refresh | `operatorSelectedDeviceId` persists in main state and is emitted as `selectedDeviceId`; screenshot shows `Synthetic 120 BPM (E2E demo)` selected | Pass |
| TC-03 | D14 macOS reopen path | Local operator | Closing/reopening on macOS can restore operator window when output is still running | `app.on("activate")` calls `startOperatorWindow()` when E2E mode is active and operator window is missing | Pass |
| TC-04 | D15 first-state hydration | Local operator | First operator render hydrates from main-process state, not renderer defaults | `mountPanel()` is deferred until after the first state envelope updates `currentState`; screenshot shows hydrated device and two-song setlist | Pass |
| TC-05 | D16 shortcut focus guard | Local operator | Space/arrow shortcuts do not hijack interactive controls | `shouldBypassOperatorShortcutTarget()` guards input, textarea, select, button, link, and contenteditable targets; targeted tests pass | Pass |
| TC-06 | D17 state broadcast pressure | Local operator | SyncEngine state snapshots do not emit to operator IPC at frame cadence | Main throttles state broadcasts to 200ms while leaving karaoke frames unthrottled; live run delivered frames with 0 drops | Pass |
| TC-07 | D18 duplicate IPC handlers | Local operator | Reopening operator window does not accumulate command/ready listeners | `removeOperatorIpcHandlers()` runs before install, on close, and during shutdown | Pass |
| TC-08 | Tempo-adaptive easing | Congregation output | Staccato, normal, and held words map to distinct smooth transition ranges | `wordEaseMs()` pins 50ms, 80ms, and 200ms anchors; CSS applies the variable to background, opacity, and filter | Pass |
| TC-09 | LC_E2E_MODE pipeline | Local operator | Synthetic audio drives SyncEngine, OutputAdapter, karaoke output, and operator window | Electron capture logged `adapter.start() OK`, `E2E mode`, `operator window: renderer signalled ready`, `LC_LOAD_MAP`, frames, and 0 dropped frames | Pass |
| TC-10 | LC_DEMO_MODE pipeline | Local operator | Legacy DemoSyncEngine path still renders karaoke output | Electron capture logged `DEMO mode`, `LC_LOAD_MAP`, frame delivery, screenshots, and 0 dropped frames | Pass |
| TC-11 | Operator IPC sender validation | Local operator | Main ignores ready/command IPC from non-operator senders | Ready and command handlers compare `event.sender` to `operatorWindow.webContents` before acting | Pass |
| TC-12 | Operator channel constant drift | Local operator | Main and preload use identical channel constants | `lyricue:operator:state`, `lyricue:operator:command`, and `lyricue:operator:ready` match across main and preload | Pass |
| TC-13 | Pre-ready buffer behaviour | Local operator | State emitted before renderer readiness is not lost | Main stores last pending state and flushes it after `signalReady()` | Pass |

## Defects surfaced + fixed

No new defects were surfaced in this pass.

**D13 — HIGH — fixed before this pass.** Symptom from prior report: selected audio device snapped back to `null` after a main-process state refresh. Root cause was missing main-process ownership of selected device state. Current verification: `operatorSelectedDeviceId` is initialized in `apps/sister/src/main.ts:171`, updated on `changeDevice` at `apps/sister/src/main.ts:498`, and included in state payload at `apps/sister/src/main.ts:577`. Evidence: E2E operator screenshot `docs/qa-reports/evidence/ep10-operator-window-2026-05-15/01-first-word-active-operator.png` shows `Synthetic 120 BPM (E2E demo)` selected. Fix status: fixed in current branch.

**D14 — MEDIUM — fixed before this pass.** Symptom from prior report: macOS activate path could reopen the karaoke output without the operator window. Root cause was output-only lifecycle handling. Current verification: `app.on("activate")` reopens the operator window when E2E mode is active and the operator window is absent at `apps/sister/src/main.ts:829`. Fix status: fixed in current branch.

**D15 — HIGH — fixed before this pass.** Symptom from prior report: operator controls briefly rendered from default state before first IPC hydration, creating a data-loss-style UI hazard for selected device state. Root cause was mounting `SetlistPanel` before the first state envelope. Current verification: `mountPanel()` is first called after `currentState = next` inside the subscription path at `apps/sister/src/renderer/operator-window-bootstrap.ts:188`, with the selected device passed at `apps/sister/src/renderer/operator-window-bootstrap.ts:204`. Fix status: fixed in current branch.

**D16 — MEDIUM — fixed before this pass.** Symptom from prior report: global operator keyboard shortcuts could intercept typing or select/menu interactions. Root cause was no focus-target guard. Current verification: `onKeyDown()` returns early through `shouldBypassOperatorShortcutTarget(event.target)` at `apps/sister/src/renderer/operator-window-bootstrap.ts:170`; the guard covers interactive targets in `apps/sister/src/renderer/operator-shortcuts.ts:1`. Targeted tests passed in `apps/sister/src/renderer/operator-shortcuts.test.ts`. Fix status: fixed in current branch.

**D17 — LOW — fixed before this pass.** Symptom from prior report: operator IPC state might be broadcast at SyncEngine tick cadence, creating avoidable renderer pressure. Root cause was no operator-state throttle. Current verification: `OPERATOR_STATE_BROADCAST_INTERVAL_MS` is 200ms at `apps/sister/src/main.ts:127`; `syncEngine.state` schedules broadcasts rather than sending directly at `apps/sister/src/main.ts:354`; the throttle path is `apps/sister/src/main.ts:600`. Live E2E diagnostics showed `dropped=0`. Fix status: fixed in current branch.

**D18 — INFO — fixed before this pass.** Symptom from prior report: duplicate IPC handlers could become a future reopen hazard. Root cause was install-only handler lifecycle. Current verification: `startOperatorWindow()` removes prior handlers before install at `apps/sister/src/main.ts:380`, close removes handlers at `apps/sister/src/main.ts:432`, and shutdown removes handlers at `apps/sister/src/main.ts:780`. Fix status: fixed in current branch.

## Network / data layer observations

- Network: no HTTP traffic is expected in this scoped local Electron path. The relevant contract is Electron IPC, not API fetches.
- IPC channels: pass. Main and preload agree on `lyricue:operator:state`, `lyricue:operator:command`, and `lyricue:operator:ready` at `apps/sister/src/main.ts:124` and `apps/sister/src/preload/operator-window-preload.cts:26`.
- Sender validation: pass. `ipcReadyHandler` and `ipcCommandHandler` ignore events whose sender is not `operatorWindow.webContents` at `apps/sister/src/main.ts:443`.
- Pre-ready buffer: pass. Pending state is last-write-wins at `apps/sister/src/main.ts:592` and flushed after renderer readiness at `apps/sister/src/main.ts:443`.
- Tempo easing: pass. `wordEaseMs()` maps staccato words to 50ms, normal 500ms words to 80ms, and held notes to 200ms at `packages/ui/src/karaoke-easing.ts:25`. `KaraokeOutput.svelte` applies the computed `--word-ease-ms` to background, opacity, and filter transitions at `packages/ui/src/KaraokeOutput.svelte:367` and `packages/ui/src/KaraokeOutput.svelte:582`.
- Literal drift: no seed-vs-production literal surface exists in this scope. The only scoped literals are IPC channels, command kinds, and sync tiers; grep/code inspection found channel constants aligned and tier validation constrained to `auto`, `timer`, and `manual`.
- SSR/CSR contract: not applicable. This Electron walking skeleton has no SSR route, browser cookie session, or authenticated per-user response.
- Form hydration: not applicable. The scoped operator panel has controls, but no persisted edit form.
- Privacy boundary: not applicable. There is no owner/self/admin data boundary or PII response in this walking skeleton.
- Idempotency: pass for the scoped local launch. Running capture in E2E and demo modes completed and exited cleanly; generated screenshots were restored so the report commit remains isolated.
- Schema drift: not applicable. No ORM model, SQL schema, or migration is used by the scoped path.

## Cumulative defect tally (if multi-pass)

| Pass | Scope | Critical | High | Medium | Low | Info | Open after pass |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| EP-10 operator QA | Operator BrowserWindow | 0 | 2 | 2 | 1 | 1 | 6 |
| Codex handoff QA | Walking skeleton sister-mode | 0 | 0 | 0 | 0 | 0 | 0 for D13-D18 on current branch |

## Recommendations before production shipping

1. **MEDIUM:** Add an Electron-level smoke harness for the operator window that asserts selected-device hydration, initial setlist hydration, and command IPC sender validation. This would have caught D13, D15, and the D18 reopen hazard.
2. **MEDIUM:** Add a focused assertion around operator state broadcast cadence. Existing code throttles at 200ms; a regression test should prove SyncEngine frame cadence cannot leak into operator state IPC.
3. **MEDIUM:** Add an operator keyboard interaction test that focuses the audio device select and verifies Space/arrow keys do not dispatch global commands. The helper has unit tests, but the integration boundary is where D16 lived.
4. **LOW:** Re-run this pass on a clean post-merge branch after the current feature branch lands, because the handoff report is stale relative to current HEAD.

## Final verdict

The scoped LyriCue walking skeleton is ship-ready for local M2-style demo verification on this branch: D13-D18 are fixed, tempo-adaptive easing is pinned and applied, both launch paths run, and the operator IPC surface passes the targeted cross-cut checks. It is not yet a production release verdict for FreeShow fork integration, packaged builds, external audio hardware, ML transcription, or signed distribution.
