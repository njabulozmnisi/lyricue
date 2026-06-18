# HANDOFF.md — LyriCue project handoff snapshot

## Latest continuation notes — 2026-06-18

This file began as the 2026-05-16 handoff. The current roadmap is
`docs/project-completion-roadmap-2026-05-19.md`; read it after this section for the up-to-date
epic matrix and release gates.

Current `main` has moved beyond the original snapshot:

- Full local gate passes with 82 TypeScript/Vitest files and 789 tests, Worker 11/11,
  UI diagnostics 0 errors / 0 warnings, both Python sidecar suites 88 passed / 1 skipped,
  and sister renderer/main/preload builds passing.
- EP-10 operator defects D13-D18 are closed locally.
- EP-15 operator Publish opens the live dialog, fails closed without credentials, and the
  sister host now exports the active learned song into a valid ZIP `.lcbundle` before calling
  the Worker publish API. The raw publish credential remains main-process only through
  Electron `safeStorage`.
- EP-16 Setlist Source is mounted in the sister operator. The host can list local/central
  project sources, select local projects, and load central project plans through
  `fetchCatalog()` + `loadProjectPlanBundles()` when a library URL is configured.
- Electron smoke captures Settings, Publish, and Setlist Source overlays in pass-specific
  `LC_CAPTURE_EVIDENCE_DIR` directories so evidence runs do not overwrite historical baselines.
- The only known dirty working-tree entries at the time of this update were pre-existing:
  `package-lock.json` and `.claude/`. Do not stage or revert them unless the operator asks.

Recent commits after the original handoff include:

- `680eb94 fix:(#EP-15): mount operator publish bridge`
- `bcdddbd feat:(#EP-16): mount operator project source picker`
- Current in-flight slice after those commits: EP-15 song publish exporter, documented in
  `docs/qa-reports/qa-report-ep15-song-publish-exporter-2026-06-18.md`.

Remaining production blockers are still external proof gates, not local walking-skeleton defects:
real Cloudflare R2/KV/Worker + GitHub mirror token, packaged safe-storage credential proof,
code-signing certificates, FreeShow native vendor SDKs for fork-mode verification, and physical
microphone/display hardware QA.

**Date:** 2026-05-16
**Handoff from:** Claude (Anthropic) working under operator Njabulo Mnisi
**Handoff to:** OpenAI Codex (or any AI agent picking up the project)
**Branch:** `claude/upbeat-dijkstra-86e3bd` (merged into `main`)
**HEAD commit:** `ecdfd97` `feat(sister,ui): operator BrowserWindow + tempo-adaptive sweep easing`
**Test floor:** 556 TS tests across 36 files + 30 Python tests, all passing.
**Build state:** `tsc -b` clean; `svelte-check` 0/0.

This file captures the exact state of the project at handoff. Read `AGENTS.md` first for the
durable context; then read this to understand what's open right now and what's next.

---

## 1. What's landed

### Epic progress matrix

| Epic | Stories landed | Stories deferred | Notes |
|---|---|---|---|
| **EP-01** (Foundation) | All | — | Workspace scaffold, settings, fs, identity, FirstRunWizard |
| **EP-02** (Walking-skeleton OutputAdapter) | 5/5 | — | Complete |
| **EP-03** (Timing Map & Storage) | 6/6 | — | Complete |
| **EP-04** (Python sidecar infra) | 4/7 | 04.5, 04.6, 04.7 | ML deferral (PyInstaller CI + R2 + ~800MB model downloads) |
| **EP-05** (Song Learning Pipeline) | 0/N | All | Blocked by EP-04.5–07 |
| **EP-06** (Karaoke Renderer) | 6/8 | 06.5, 06.8 | 06.5 needs EP-09 sectionApproaching; 06.8 needs Playwright in CI |
| **EP-07** (Audio Input & Beat Detection) | 6/7 | 07.7 | Real-hardware loopback test only |
| **EP-08** (VAD & STT Position Correction) | 1/6 | 08.2–08.6 | 08.1 (VAD) only; STT stack blocked on whisper.cpp native addon |
| **EP-09** (Sync Engine Core) | 8/8 | — | Complete + E2E demo wired |
| **EP-10** (Operator UI) | 4/8 | 10.4, 10.5, 10.6, 10.8 | Components live; settings UI subsections + Playwright deferred |
| **EP-11** through **EP-20** | 0/N | All | Not started |

### What this means concretely

**The walking-skeleton runs end-to-end.** A real Sync Engine drives the karaoke output and the
operator window from a synthetic 120-BPM audio source. Every architectural seam — BpmEstimator →
tempoRatio → SyncEvent → SyncEngineState → SyncFrame → LC_SYNC_FRAME → KaraokeOutput — is
exercised in a single end-to-end path.

The dual-window demo is the **strongest proof we have that the architecture's vertical slice
is sound.** Run it with the command in §3 below.

---

## 2. Open defects (as of EP-10 operator-window QA pass — 2026-05-16)

The most recent /qa-analyst pass surfaced **6 defects** in the new operator-window infrastructure.
All proposed fixes are in-pass status: **awaiting authorization** (operator preferred to defer
the fix work to Codex). Full report at `docs/qa-reports/EP-10-operator-window-2026-05-16.md`.

### HIGH severity (block real operator flow)

**D13 — `selectedDeviceId` evaporates 16ms after operator picks a device.**
File: `apps/sister/src/main.ts:538-539`. `broadcastOperatorState()` rebuilds `selectedDeviceId`
per call from an optional `commandHint`. The SyncEngine state subscription fires `broadcastOperatorState()`
every tick with no hint, overwriting the operator's pick. **Fix proposal:** Add module-level
`let operatorSelectedDeviceId: string | null = null`; update in `handleOperatorCommand`'s
`case "changeDevice"`; read from it unconditionally in `broadcastOperatorState`.

**D15 — AudioDevicePicker dropdown stays empty until manual Refresh.**
File: `apps/sister/src/renderer/operator-window-bootstrap.ts:134`. The picker's
`enumerateDevices` is called once on mount, before the first IPC state envelope arrives. At
that point `currentState.audioDevices === []` (the DEFAULT_STATE default). The picker doesn't
auto-refresh when state arrives. **Fix proposal:** Defer the `new SetlistPanel(...)`
construction in the bootstrap until the first state envelope arrives. Simpler than wiring a
refresh-callback pattern.

### MEDIUM severity

**D16 — Keyboard router intercepts shortcut keys regardless of focused element.**
File: `apps/sister/src/renderer/operator-window-bootstrap.ts:166-178`. When the operator focuses
a button (Refresh, Test, mode badge) or select element and presses Space/Enter/arrows, the
router fires the SE action AND `preventDefault()`s — blocking normal button activation.
**Fix proposal:** In `onKeyDown`, before calling `handleKey`, check
`event.target?.tagName` and bail on `input/textarea/select/button` or `isContentEditable`.

**D17 — Operator-state broadcast fires every tick (~60 Hz) with mostly identical payload.**
File: `apps/sister/src/main.ts:317`. `~30 KB/s` of IPC traffic, mostly wasted. **Fix proposal:**
Throttle to ~5 Hz (200ms). The operator UI doesn't need 60Hz updates — only the karaoke
SyncFrame channel does. Decouple operator broadcasts from the per-tick state subscription.

### LOW + INFO

**D14 (LOW) — macOS Dock activate doesn't restore a closed operator window.**
File: `apps/sister/src/main.ts:758-763`. The handler only re-checks the karaoke adapter.
**Fix proposal:** Also check `if (!operatorWindow || operatorWindow.isDestroyed())` and call
`startOperatorWindow()`.

**D18 (INFO) — Latent ipcMain handler leak if `startOperatorWindow()` runs twice.**
Currently unreachable (single-call lifecycle). Becomes a real leak if D14 is fixed by allowing
operator-window re-spawn. **Fix proposal:** Add `ipcMain.off(...)` before each `ipcMain.on(...)`
in `startOperatorWindow`, OR make `startOperatorWindow` idempotent.

### Defect ordering

The operator's stated preference for fixes (from a clarification before handoff): authorize
**D13 + D15 + D16 together** as the highest-leverage trio (~45 min, restores the operator UX
flow). D17 follows. D14 + D18 batch together as cleanup.

---

## 3. Quick verification — make sure it still works

After cloning + installing, verify the test floor + the live demo:

```bash
# 1. Install + build (one-time after clone)
cd /path/to/lyricue
npm install
env -i HOME="$HOME" PWD="$PWD" PATH="/opt/homebrew/opt/node@25/bin:$PWD/node_modules/.bin:/usr/bin:/bin" \
  sh -c "npx tsc -b && cd apps/sister && npx vite build --config vite.config.mjs && npx vite build --config vite.config.operator.mjs"

# 2. Python sidecar venv (one-time)
cd python-sidecar && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"

# 3. Test sweep — both should be green
env -i HOME="$HOME" PWD="$PWD" PATH="/opt/homebrew/opt/node@25/bin:$PWD/node_modules/.bin:/usr/bin:/bin" \
  npx vitest run                                                                        # 556 tests
env -i HOME="$HOME" PATH="/opt/homebrew/bin:/usr/bin:/bin" \
  sh -c "cd python-sidecar && .venv/bin/pytest -q"                                     # 30 tests

# 4. Live demo — opens two BrowserWindows (karaoke output + operator panel)
env -i HOME="$HOME" PWD="$PWD" PATH="/opt/homebrew/opt/node@25/bin:$PWD/node_modules/.bin:/usr/bin:/bin" \
  LC_DEPLOYMENT_MODE=sister LC_E2E_MODE=1 LC_VERBOSE=1 \
  electron apps/sister/dist-electron/main.js
```

If the demo runs, you should see:
- A transparent karaoke output window with "Hello world this is / LyriCue running end to end in
  demo mode" cycling through the words with a tempo-adaptive yellow sweep
- An operator panel showing the AUTO badge, project title, audio device picker (empty per D15),
  pulsing "Sync engaged" indicator, setlist with the demo song marked ▶ Now
- Stderr probes every 5s showing `delivered=N dropped=0 fps=~57 rss=~130MB`
- No errors in console

Reference: live evidence screenshots at `docs/qa-reports/evidence/`.

---

## 4. What's blocked, and on whom

These items can't be unblocked by an AI agent alone — they need the operator's action.

### Cloudflare R2 account (operator action)
**Blocks:** EP-04 STORY-04.6 (model download mirror), EP-13 (Library Manager), EP-14 (Library
Hosting Setup), EP-15 (Multi-Tenant Identity & Publishing), parts of EP-04.7. The operator
committed to setting up the R2 account; until then, anything that depends on remote model
mirrors or shared library hosting is on hold.

### PyInstaller CI matrix (operator action — needs CI access)
**Blocks:** EP-04 STORY-04.5 (per-platform sidecar binaries), EP-04.7 (end-to-end ML smoke).
Needs a GitHub Actions matrix that builds Mac/Win/Linux PyInstaller bundles and uploads them
as artifacts for electron-builder to consume.

### FreeShow native vendor SDKs (operator action — local install)
**Blocks:** Fork-mode runtime verification. FreeShow depends on NDI, Blackmagic, and libltc
SDKs that aren't open-source. The operator installs them via FreeShow's own dev setup at
https://freeshow.app/docs. Once installed, `npm run dev:fork` should work.

### ~800 MB ML model downloads (operator action — one-time)
**Blocks:** Real song learning (EP-05+). Once R2 is up, models can be hosted there. Until
then, the sidecar's `check_models` method reports them all absent (verified in
`python-sidecar/tests/test_methods.py`).

### Whisper.cpp Node native addon (operator + build pipeline)
**Blocks:** EP-08 STT stack (STORY-08.2 onwards). Needs a Node native addon build for each
target platform.

### Code-signing certificates (operator action — M7 release)
**Blocks:** Signed installers per M7. Needed for the multi-campus rollout.

---

## 5. The next logical steps (recommended order)

The walking-skeleton is done. The natural next direction depends on which constraint relaxes first.

### Path A — Operator UX polish (no blockers; fix the QA-surfaced defects)
1. Fix D13 + D15 + D16 (operator-flow trio). ~45 min combined.
2. Fix D17 (broadcast throttle). ~30 min.
3. Fix D14 + D18 (cleanup batch). ~15 min.
4. Re-run /qa-analyst pass on the EP-10 surface to verify closures.
5. **Then:** EP-12 (Setlist & Continuous Playback). This builds on the SyncEngine's
   `onSongComplete` hook to auto-advance between songs, and adds the disk-backed setlist
   data model that replaces the hardcoded `[DEMO_TIMING_MAP]` in `broadcastOperatorState`.

This is the recommended path. It cashes in on prior work and unblocks EP-12.

### Path B — Forward into uncharted epics (more risk)
- **EP-08 STORY-08.4 (Phrase matcher)** — pure-logic STT fuzzy matcher. Closes the
  position-correction loop. SE already accepts the event (`{kind: "positionCorrection"}`);
  the matcher would be the missing event source. Doesn't unblock anything else but de-risks
  EP-08 when STT lands.
- **EP-11 (Lyrics Sourcing & Show Creation)** — populates the song catalogue. Could land
  ahead of EP-05 if STT is deferred.
- **EP-15 (Multi-Tenant Identity & Publishing)** — partly blocked by R2 but the local-side
  publishing logic + Ed25519 signing can land before R2 is up.

### Path C — Wait on operator for the R2/PyInstaller/SDK blockers
- If you have no autonomy budget at all, idle. Less recommended given the standing
  autonomy grant — see AGENTS.md §8.

---

## 6. Important files and their purpose

For the things most likely to need editing right now:

| File | Purpose | Recent activity |
|---|---|---|
| `apps/sister/src/main.ts` | Sister-mode Electron main, wires SE + adapter + audio + operator window | EP-10 operator window + E2E mode |
| `apps/sister/src/renderer/operator-window-bootstrap.ts` | Operator renderer entry | D15 + D16 fix sites |
| `packages/core/src/sync/sync-engine.ts` | SyncEngine orchestrator | Stable since EP-09 |
| `packages/core/src/sync/sync-engine-state.ts` | Pure state + transitions | Stable |
| `packages/core/src/sync/tick.ts` | Per-frame tick body | Stable |
| `packages/core/src/sync/lookup-word.ts` | Pure cursor → (slide, word, progress) | Stable |
| `packages/ui/src/KaraokeOutput.svelte` | The karaoke rendering surface | EP-06 + tempo-adaptive easing |
| `packages/ui/src/SetlistPanel.svelte` | Primary operator UI | EP-10 |
| `packages/ui/src/karaoke-easing.ts` | Tempo-adaptive easing | Closes operator feedback |
| `packages/core/src/audio/*` | Audio pipeline pure modules | EP-07 + EP-08.1 |
| `python-sidecar/lyricue_sidecar/protocol.py` | JSON-RPC server | EP-04.2 |

---

## 7. Things to know about working with the operator

The operator is in South Africa (UTC+2). They are technically deep — Senior Full Stack engineer,
13+ years experience, backend-strong but works across the stack. They have explicitly granted
autonomy: routine decisions don't need permission, but irreversible / cross-cutting ones do.

They use Claude Code as their primary AI assistant; this handoff is to OpenAI Codex
specifically. Their direct feedback style means defects are surfaced clearly — they don't expect
sugar-coating.

The operator has the standing memory entries (see AGENTS.md §8):
- "Quality over speed always. No shortcuts, no cut corners."
- "Complete the project autonomously. Resolve issues yourself with quality + accuracy + best
  interest. Single notification when finished."

The operator is on `~/.claude/projects/-Users-njabulomnisi-Projects-Dojo-worshipsync/memory/`
for the Claude Code memory system — Codex won't see those memories directly, but the relevant
preferences are captured here in AGENTS.md and HANDOFF.md.

---

## 8. Final notes from the previous agent

A few things I wish I'd known earlier:

- **The `env -i` wrapper is non-negotiable** on the operator's machine. Every Node/Electron
  command needs it. Don't try to work around it; just include it.
- **Svelte 3 + jsdom needs `await Promise.resolve()`** after `cmp.$set(...)` before asserting
  DOM updates. Several existing tests demonstrate the pattern.
- **The Svelte component subscribe trick:** for components that consume an external store via
  `subscribe` prop, call `subscribe(handler)` SYNCHRONOUSLY in the script body, NOT inside
  `onMount`. Otherwise tests race — see how `KaraokeOutput.svelte` and
  `AudioDevicePicker.svelte` do it.
- **The user has flagged the operator-feedback rhythm explicitly:** when something feels wrong
  visually, they'll say so. Make sure to capture screenshots and run a live smoke before
  reporting "done." Visual smoothness is a real acceptance criterion (see the tempo-adaptive
  easing work).
- **Test sweep before commit, every time.** Currently 556 TS + 30 Python. If your changes
  drop the count or break any test, you're not done.
- **Don't add AI attribution. Anywhere. Ever.** The operator has a global rule about this and
  there's a check helper in AGENTS.md §7. The recent commits all pass this check; preserve it.

Good luck. The walking-skeleton is solid — build outward with confidence.

— Previous agent (Claude)
