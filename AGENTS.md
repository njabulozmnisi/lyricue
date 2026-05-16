# AGENTS.md — guide for AI coding agents working on LyriCue

This file is the durable context any AI agent (Claude Code, OpenAI Codex, Cursor, etc.) should load
into its head before touching the codebase. Read it once at the start of a session.

A companion file `HANDOFF.md` captures the moment-in-time state at the most recent handoff —
read that AFTER this file for the immediate "what's open right now / what's next" picture.

---

## 1. What this project is

**LyriCue** is an AI-powered live-lyric-synchronisation tool built on top of [FreeShow](https://freeshow.app/).
It learns songs from a reference recording, produces word-level timing maps, and during live performance
highlights each word in tempo with the lead vocalist, adapting to their actual pace via beat detection
and voice-activity gating.

**Primary launch market:** worship in multi-campus churches (Hillside Church's ~60 campuses).
**Architecture is deliberately domain-neutral** — it's also intended to work for karaoke, theater,
live music, language learning, school sing-alongs, conference teleprompting.

The product was originally called "WorshipSync" and renamed to LyriCue to keep the
domain-neutral framing.

### Three-tier graceful degradation (load-bearing constraint)

> The system **never crashes during live performance**.

If AI sync fails (low beat confidence) the system degrades to **Timer mode** (cursor advances at
the reference BPM with no audio-driven tempo scaling). If Timer drifts too far, the system falls
back to **Manual mode** (operator drives slide changes). The Mode Indicator badge is always
visible so the operator knows which tier they're in.

### Offline-first

Every live-performance dependency runs in-process with **zero outbound network calls**.
ML pipeline (Demucs vocal isolation, WhisperX forced alignment) is all local. No general-purpose
LLMs — only specialised audio models. See `_bmad-output/architecture.md` §2.1 for the offline
guarantee + hardware requirements (Apple M1+ is a first-class target).

---

## 2. Where the project is in its lifecycle

LyriCue uses the [BMAD methodology](https://docs.bmad-method.org/). Four phases:

- **Phase 1 (Analysis):** Complete — `_bmad-output/product-brief.md`
- **Phase 2 (PRD):** Complete — `_bmad-output/PRD.md`
- **Phase 3 (Solutioning):** Complete — `_bmad-output/architecture.md` (~172 KB, 17 ADRs) +
  `_bmad-output/epics.md` (~126 KB, 20 epics, ~133 stories)
- **Phase 4 (Implementation):** **In progress.** This is where AI agents do most of their work.

See HANDOFF.md for which epics/stories are landed, deferred, or blocked.

The PRD, architecture, and epics documents are the **source of truth for what to build.** If
something in those docs conflicts with what you find in code, raise it with the operator — don't
silently choose one over the other.

---

## 3. Repository layout

This is a single npm workspaces monorepo per ADR-17 (see architecture.md). Build-time flag
`LC_DEPLOYMENT_MODE=fork|sister` selects which Electron app is packaged.

```
lyricue/
├── apps/
│   ├── fork/                          Fork-mode Electron app (vendors FreeShow as submodule)
│   │   ├── src/
│   │   │   ├── electron-main.ts       Stub entry; FreeShow's own main owns the BrowserWindow
│   │   │   ├── main/index.ts          initLyriCueMain() called by FreeShow's patched main
│   │   │   ├── frontend/index.ts      initLyriCueFrontend() called by FreeShow's patched frontend
│   │   │   └── output/ForkOutputAdapter.ts  Sends frames over FreeShow's OUTPUT IPC
│   │   ├── scripts/                   Demo runner + tsc validation entries
│   │   └── freeshow/                  Git submodule (lyricue-integration branch)
│   │
│   └── sister/                        Sister-mode standalone Electron app
│       ├── src/
│       │   ├── main.ts                Main process — owns SyncEngine, audio, IPC, both windows
│       │   ├── audio/
│       │   │   └── synthetic-audio-driver.ts  Synthetic 120 BPM driver for LC_E2E_MODE
│       │   ├── output/
│       │   │   ├── OwnWindowOutputAdapter.ts
│       │   │   └── electron-browser-window-factory.ts
│       │   ├── preload/               Both window preloads (.cts → native .cjs)
│       │   │   ├── karaoke-output-preload.cts
│       │   │   └── operator-window-preload.cts
│       │   └── renderer/              Both window bootstraps (Vite-bundled IIFE)
│       │       ├── karaoke-output-bootstrap.ts
│       │       └── operator-window-bootstrap.ts
│       ├── public/                    Static HTML shells + Vite output
│       │   ├── karaoke-output.html
│       │   ├── operator-window.html
│       │   └── build/                 karaoke-output.bundle.{js,css}, operator-window.bundle.{js,css}
│       ├── vite.config.mjs            Karaoke output bundler
│       └── vite.config.operator.mjs   Operator window bundler
│
├── packages/
│   ├── core/                          Mode-agnostic TS modules
│   │   └── src/
│   │       ├── types/                 LyriCueSettings, TimingMap, IdentityConfig, schema versions
│   │       ├── fs/                    writeFileAtomic + crash test
│   │       ├── settings/              JsonFileStore + per-domain stores + paths
│   │       ├── output/                OutputAdapter contract + SyncFrame + LoadMapPayload + Mock
│   │       ├── diagnostics/           DiagnosticsObserver (polls AdapterHealth)
│   │       ├── timing/                TimingMapStorage + orphan cleanup + migration framework
│   │       ├── sidecar/               SidecarController + path resolver + Node spawner
│   │       ├── audio/                 tempo, BPM estimator, Meyda wrapper, AudioInput, VAD
│   │       ├── sync/                  SyncEngine, tick loop, state machine, keyboard router
│   │       └── library/, storage/, stt/  Empty placeholder dirs (scaffolded for future epics)
│   │
│   └── ui/                            Shared Svelte 3 components (matches FreeShow's Svelte version)
│       └── src/
│           ├── KaraokeOutput.svelte           The karaoke rendering surface (both modes)
│           ├── SetlistPanel.svelte            Primary operator UI
│           ├── ModeIndicator.svelte           AUTO/TIMER/MANUAL tier badge
│           ├── TierChangeBanner.svelte        Transient surface for tier transitions
│           ├── AudioDevicePicker.svelte       Audio input selector
│           ├── DiagnosticsPanel.svelte        Adapter health surface
│           ├── FirstRunWizard.svelte          Onboarding (host-agnostic)
│           ├── SettingsTab/                   Settings panel + per-subsection sections
│           ├── types.ts                       Shared TS types for components
│           └── karaoke-easing.ts              Tempo-adaptive easing pure function
│
├── python-sidecar/                    ML pipeline (PyInstaller-bundled per platform at release time)
│   ├── lyricue_sidecar/
│   │   ├── __main__.py                JSON-RPC 2.0 entry
│   │   ├── protocol.py                JSON-RPC server
│   │   └── methods.py                 ping, check_models, shutdown (real ML methods land in EP-05+)
│   ├── tests/                         pytest cases
│   └── pyproject.toml
│
├── infra/
│   └── publish-worker/                Cloudflare Worker scaffold for R2 library hosting (EP-14)
│
├── docs/
│   └── qa-reports/                    QA reports from /qa-analyst passes + evidence screenshots
│       ├── M1-partial-sister-only-2026-05-14.md
│       ├── M1-close-2026-05-15.md
│       ├── EP-06-karaoke-renderer-2026-05-15.md
│       ├── EP-09-e2e-2026-05-15.md
│       ├── EP-10-operator-window-2026-05-16.md
│       └── evidence/                  PNG screenshots from live runs
│
├── _bmad-output/
│   ├── product-brief.md               Phase 1 vision + positioning
│   ├── PRD.md                         11 FR groups, 6 NFR groups, 8 user journeys
│   ├── architecture.md                System decomposition, 17 ADRs, multi-tenant infra
│   ├── epics.md                       20 epics, ~133 stories, walking-skeleton release plan
│   └── freeshow-upstream-discussion-draft.md
│
├── AGENTS.md                          THIS FILE
├── HANDOFF.md                         Moment-in-time handoff snapshot (read after AGENTS.md)
└── README.md                          Operator-facing overview
```

---

## 4. Dual-mode deployment (ADR-16)

The same code base ships as two Electron apps. Both modes are first-class. ~95% of code is shared
through `packages/core` and `packages/ui`. Only the `OutputAdapter` differs.

- **Fork mode** (`apps/fork`): LyriCue code lives inside a FreeShow fork; operator runs ONE
  combined Electron app. Best rendering fidelity. Periodic merges from upstream FreeShow required.
  Currently blocked on FreeShow's native vendor SDKs (NDI, Blackmagic, libltc) being installed —
  see FreeShow's own dev setup at https://freeshow.app/docs.

- **Sister mode** (`apps/sister`): LyriCue runs as a STANDALONE Electron app and drives FreeShow
  externally via its public APIs (REST + WebSocket — wiring in EP-15). Simpler maintenance;
  rendering relies on a separate karaoke output window. **This is the mode currently runnable.**

The operator picks at install time via `LC_DEPLOYMENT_MODE=fork|sister` baked into electron-builder.

---

## 5. How to run

### Prerequisites
- Node ≥20 (the user has Node 25.9.0 installed via Homebrew; their shell has a stale `NODE_PATH`
  from an old NVM install, so every Node/Electron command needs the `env -i` wrapper below).
- Python ≥3.10 (for sidecar dev; bundled into the installer at release time).
- macOS arm64 is a first-class target. Windows and Linux are supported targets but less-tested.

### Build everything
```bash
cd /Users/njabulomnisi/Projects/Dojo/worshipsync   # (your local clone)

# Install workspace deps (first-time only)
npm install

# TS composite build
env -i HOME="$HOME" PWD="$PWD" PATH="/opt/homebrew/opt/node@25/bin:$PWD/node_modules/.bin:/usr/bin:/bin" \
  npx tsc -b

# Karaoke output renderer bundle
env -i HOME="$HOME" PWD="$PWD" PATH="/opt/homebrew/opt/node@25/bin:$PWD/node_modules/.bin:/usr/bin:/bin" \
  sh -c "cd apps/sister && npx vite build --config vite.config.mjs"

# Operator window renderer bundle
env -i HOME="$HOME" PWD="$PWD" PATH="/opt/homebrew/opt/node@25/bin:$PWD/node_modules/.bin:/usr/bin:/bin" \
  sh -c "cd apps/sister && npx vite build --config vite.config.operator.mjs"
```

The `env -i ... PATH=...` wrapper is **mandatory** on the operator's machine because their shell
has a stale `NODE_PATH` that breaks Node ≥20. If you see `Cannot find module 'node:path'`, that's
the cause. The wrapper isolates the shell.

### Run the live demo

**E2E mode** (recommended — real Sync Engine + dual windows):
```bash
env -i HOME="$HOME" PWD="$PWD" PATH="/opt/homebrew/opt/node@25/bin:$PWD/node_modules/.bin:/usr/bin:/bin" \
  LC_DEPLOYMENT_MODE=sister LC_E2E_MODE=1 LC_VERBOSE=1 \
  electron apps/sister/dist-electron/main.js
```

You'll get TWO windows: the karaoke output (transparent, frameless, alwaysOnTop) and the operator
control panel (focusable, regular window). The synthetic audio driver feeds a 120-BPM beat into
BpmEstimator + VAD → SyncEngine → OutputAdapter → KaraokeOutput.

**DEMO mode** (legacy — DemoSyncEngine path, single window, kept for EP-06 evidence capture):
```bash
... LC_DEMO_MODE=1 ...
```

**Useful env vars:**
- `LC_VERBOSE=1` — forwards renderer console + lifecycle events to stderr
- `LC_OPEN_DEVTOOLS=1` — opens DevTools detached for both windows
- `LC_CAPTURE_EVIDENCE=1` — captures four screenshots of each window then quits

### Run tests
```bash
# TypeScript (currently 556 tests across 36 files)
env -i HOME="$HOME" PWD="$PWD" PATH="/opt/homebrew/opt/node@25/bin:$PWD/node_modules/.bin:/usr/bin:/bin" \
  npx vitest run

# Python sidecar (currently 30 tests)
env -i HOME="$HOME" PATH="/opt/homebrew/bin:/usr/bin:/bin" \
  sh -c "cd python-sidecar && .venv/bin/pytest -q"

# svelte-check (UI components type check)
env -i HOME="$HOME" PWD="$PWD" PATH="/opt/homebrew/opt/node@25/bin:$PWD/node_modules/.bin:/usr/bin:/bin" \
  sh -c "cd packages/ui && npx svelte-check --tsconfig tsconfig.json"
```

The test sweep MUST be clean before you commit. The user values "quality over speed" — see §8.

---

## 6. Critical design constraints (memorise these)

These are non-obvious things that have already cost time. Internalise before you write code.

### NFR1.3 — 30 fps frame budget
SE's tick body must run in <2ms on a 4-core M1. lookupWord is the hot path and is benchmarked
at <200µs per lookup (see `packages/core/src/sync/lookup-word.test.ts`). Don't add per-frame
allocations without measuring.

### NFR2.1 — Zero crashes during live worship
`pushSyncFrame` MUST NEVER throw. Bad frames count toward `framesDropped` but never propagate.
Same rule applies to every per-frame hot path: VAD, BPM estimator, KR. **Defensive guards**
(non-finite coercion to 0, malformed-input → null return) are everywhere on purpose. Don't remove them.

### NFR2.4 — Audio input loss → Timer within 3s
`MediaStreamTrack.onended` → SE.dispatch({kind:"audioInputLost"}) → SE forces auto/timer → timer
immediately. Manual tier is preserved (operator choice takes precedence). See `sync-engine-state.ts`.

### FR2 — Karaoke rendering pattern (architecture §4.9)
No per-frame JS DOM mutation. Each word is a `<span class="word" style="--progress: ...">` and the
CSS does the visual sweep via `background-clip: text` + a linear gradient. The renderer is dumb:
it derives every pixel from `(TimingMap, SyncFrame, displaySettings)` with no internal state.

### Tempo ratio clamp [0.7, 1.4]
Hard clamp in `packages/core/src/audio/tempo.ts`. Out-of-band values return 1.0 (treat as
detection error, not "play at half speed"). See FR3.4 + the rationale in the file header.

### Schmitt-trigger VAD with asymmetric dwells
silent → active: RMS > enterThreshold for ≥300ms. active → silent: RMS < exitThreshold for ≥1500ms.
The longer silent dwell is **deliberate** — worship music has legitimate soft passages and we
want to hold the display through them, not yo-yo. See `packages/core/src/audio/vad.ts`.

### Atomic writes for all persisted state (ADR-7)
Every persisted artefact (settings, timing maps, arrangements, library config, identity) writes
through `writeFileAtomic` (temp + fsync + rename). A SIGKILL mid-write must never produce a
partial file at the canonical path. There's a real subprocess crash test in
`packages/core/src/fs/atomic-write.test.ts`.

### Multi-tenant identity is OPTIONAL (MC-NFR6)
Anonymous + local-only is the DEFAULT. The first-run wizard's "skip" path leaves the install
with no org/campus/user identity. Don't write any code that assumes identity is populated.

### Reference-track time vs wall-clock
SE's `cursorRefTime` is in REFERENCE-TRACK ms, not wall-clock. Conversion is encapsulated in
`tick()` per architecture §4.8: `deltaRefMs = wallElapsed * tempoRatio`. KR consumes
`currentWordIndex` and `wordProgress` — it NEVER sees milliseconds.

### Adapter abstraction is THE bet (ADR-16)
`OutputAdapter` is the single architectural seam between fork and sister modes. Adding logic to
SE that knows which mode it's in is a code smell. SE pushes frames through the adapter; the
adapter decides how they reach the projector. Period.

---

## 7. Conventions

### Commits
Format: `<type>:(#<ticket>): <description>` (the `#<ticket>` part is omitted when no ticker exists).
Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`, `security`.

Examples from the recent history:
- `feat(core): EP-09 Sync Engine Core — state, tick loop, transitions`
- `fix: M1-close defects D11 (load-map race) + D12 (CSP warning)`

**NEVER add AI attribution** in commits, PRs, issue/ticket text, code comments, docs, or anywhere.
This is a global project rule — see `~/.claude/CLAUDE.md` for the operator's full list of
forbidden strings. Every commit must pass:
```bash
git log -1 --format="%B" | grep -iE "co-authored|🤖|generated with claude|generated by (claude|gpt|copilot)|noreply@anthropic|noreply@github\.com" || echo "[OK] no AI attribution"
```

### Pull requests
PR title uses the same conventional-commit format. PR body includes Summary + Test Results +
Files Changed. Link to the relevant GitHub Issue when one exists.

### Code style
- Prettier: matches FreeShow exactly. `printWidth: 500`, `tabWidth: 4`, `semi: false`,
  `singleQuote: false`, `trailingComma: "none"`.
- TypeScript strict mode. `exactOptionalPropertyTypes: true` — be careful about `undefined` vs
  "omitted" (use conditional object spread, not `...{ x: undefined }`).
- Comments: default to no comments. Only add one when the WHY is non-obvious (hidden constraint,
  subtle invariant, workaround for a specific bug, surprising behaviour). Don't explain WHAT
  the code does — names + types should make that clear.
- No `// removed`, `// TODO`, or other rot-prone markers — delete cleanly.

### Testing posture
- Pure logic tests in `*.test.ts` alongside the source file. Run with vitest.
- Svelte component tests use `new Component({ target })` directly (no @testing-library/svelte
  dependency). The pattern is documented in `KaraokeOutput.test.ts` etc.
- Async Svelte reactivity needs `await Promise.resolve()` after `cmp.$set(...)` before asserting
  DOM updates — Svelte 3 in jsdom doesn't flush synchronously.
- Integration tests that touch a real subprocess (e.g. SidecarController integration) use
  `describe.skipIf(!haveVenv)` so CI cooperates when prerequisites are missing.
- The user values quality over speed: do NOT cut corners on tests. See feedback memory
  `feedback_quality_over_speed.md`.

### Workspace package paths
- `@lyricue/core` — pure modules, exports per subpath (`./types`, `./fs`, `./settings`,
  `./output`, `./diagnostics`, `./timing`, `./sidecar`, `./audio`, `./sync`).
- `@lyricue/ui` — Svelte components (Svelte 3, matching FreeShow).
- `@lyricue/fork` — fork-mode Electron app.
- `@lyricue/sister` — sister-mode Electron app.

When adding a new subpath to `@lyricue/core`, you must:
1. Create `packages/core/src/<name>/index.ts` with the barrel re-exports.
2. Add the path to `packages/core/src/index.ts`.
3. Add the subpath to `packages/core/package.json` "exports".
4. Run `npx tsc -b` to verify it compiles.

---

## 8. The operator's working style (durable memory)

The user has explicit standing preferences:

1. **Quality over speed.** "High fidelity, high accuracy, high quality always over speed. No
   shortcuts, no cut corners." Don't ship a partial implementation to call something "done."
   When defects exist, surface them; don't paper over.

2. **Full autonomy granted** (for AI agents working on the project).
   The user has explicitly delegated authority to complete the project autonomously: "I give
   you authority and permission to complete the entire project and all of it epics and stories
   autonomously. Any issues that surface, you must autonomously resolve them with the intent
   of keep accuracy, quality and best interest of the project at the forefront." This means:
   - Don't ask for permission on routine decisions.
   - Do ask for permission on irreversible / cross-cutting decisions.
   - When you hit a real blocker, surface it with options and a recommendation.

3. **Senior+ technical depth.** The user is a Senior Full Stack Software Engineer with 13+
   years of experience (started 2013). Backend-strong but works across the stack. Comfortable
   with technical depth — frame responses for that audience. Don't dumb things down.

4. **South Africa context.** The user is based in South Africa. Worship music with Zulu/Xhosa
   parallel lyrics is a real use case — parallel-language rendering (FR10, EP-19) is a
   first-class feature, not an afterthought.

5. **Direct + respectful tone.** Practical, context-aware, no buzzwords or exaggerated claims.

---

## 9. What NOT to do

- **Don't ship without running the test sweep.** 556 TS + 30 Python tests must be green.
- **Don't add AI attribution to anything.** See §7.
- **Don't change the architecture without an ADR.** The 17 ADRs in architecture.md are
  load-bearing decisions. If you find one is wrong, propose a new ADR rather than silently
  diverging.
- **Don't introduce per-frame allocations in the SE tick.** Profile-then-add, not the reverse.
- **Don't remove defensive guards.** The NFR2.1 zero-crash invariant is the most important
  property of the system.
- **Don't reintroduce the WS_/WorshipSync naming.** The project renamed to LyriCue; channels
  are `LC_*`, settings are `lyricue.*`, etc.
- **Don't merge without verification.** Code review (`/code-review`), QA pass
  (`/qa-analyst`), and explicit user authorization are the gates before merge to main.
- **Don't blanket-fix known carry-forwards without authorization.** Multiple QA reports document
  defects with proposed fixes; the user authorizes specific ones to land per pass.

---

## 10. Pointers to deeper context

- **Vision + positioning:** `_bmad-output/product-brief.md`
- **Functional + non-functional requirements:** `_bmad-output/PRD.md`
- **System architecture + ADRs:** `_bmad-output/architecture.md` (172KB — read sections as needed)
- **Epics + stories + acceptance criteria:** `_bmad-output/epics.md`
- **QA history (read in chronological order to understand defect evolution):**
  1. `docs/qa-reports/M1-partial-sister-only-2026-05-14.md`
  2. `docs/qa-reports/EP-06-karaoke-renderer-2026-05-15.md`
  3. `docs/qa-reports/STORY-02-05-diagnostics-2026-05-15.md`
  4. `docs/qa-reports/M1-close-2026-05-15.md`
  5. `docs/qa-reports/EP-09-e2e-2026-05-15.md`
  6. `docs/qa-reports/EP-10-operator-window-2026-05-16.md` ← most recent
- **README:** `README.md` — operator-facing overview, also has the dev setup commands.
- **Current moment-in-time state:** `HANDOFF.md` — read this AFTER AGENTS.md.

---

## 11. Acknowledgements + license

LyriCue is built on top of FreeShow (https://freeshow.app/). It is GPL-3.0 licensed by virtue
of FreeShow's copyleft. The fork lives at `njabulozmnisi/lyricue-freeshow` on the
`lyricue-integration` branch. There is a proposed Captions extension PR draft at
`_bmad-output/freeshow-upstream-discussion-draft.md` that, if accepted upstream, would unlock
the third (caption-injection) deployment mode in EP-20.
