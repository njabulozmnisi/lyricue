# Epics & Stories: LyriCue

**Version:** 1.0 DRAFT
**Phase:** BMAD Phase 3 — Solutioning (Epics & Stories)
**Agent:** Architect Agent (continuing from architecture.md)
**Date:** 2026-05-13
**Input Dependencies:** `product-brief.md` (Phase 1), `PRD.md` (Phase 2), `architecture.md` (Phase 3)

---

## 1. Purpose of This Document

This document decomposes the LyriCue architecture (architecture.md) into implementable epics and stories. It is the **bridge between the architecture and the code** — every story here has enough detail that an engineer can pick it up, implement it, and know when it's done.

This document defines:

1. **The 20 epics** that comprise LyriCue (16 MVP + 4 post-MVP).
2. **~150 stories** with acceptance criteria, technical notes, and traceability.
3. **The dependency graph** showing which epics block which.
4. **A release plan** that sequences epics into shippable milestones.
5. **The Phase 3 Readiness Check** — gate criteria before Phase 4 (implementation) starts.

This document does NOT define:

- Per-story UI mockups (deferred to Phase 4 implementation; PRD acceptance criteria are the visual spec).
- Detailed test plans (produced via the `qa-test` skill in Phase 4).
- Specific assignee or sprint allocations (those depend on team shape and are not architecture concerns).

---

## 2. Sequencing Philosophy — Walking Skeleton First

LyriCue's architecture is novel and has real technical risk: the dual-mode (fork + sister-service) deployment, the OutputAdapter abstraction, the Python sidecar lifecycle, the per-frame sync loop. Building these in isolation is risky — we won't know if the pieces compose until we put them together.

**The walking-skeleton approach** retires this risk fast. We build the thinnest possible end-to-end vertical slice first:

> **Audio input → Sync Engine (stub) → OutputAdapter (both modes) → Renderer (stub) → projector**

with all real interfaces and stubbed implementations, before we deepen any single component. If the walking skeleton works, we know the architecture is sound. If it doesn't, we find out in Epic 2, not Epic 12.

After the walking skeleton, we deepen vertically (real audio → real beat detection → real sync logic → real renderer) rather than horizontally (one full module at a time). Each deepening pass produces a more-complete product that can be demoed end-to-end.

**The result:**

- Architectural risk retired in the first 2 epics.
- Every milestone is demoable end-to-end (no "we have the engine but no UI" gaps).
- Integration bugs surface early when they're cheap to fix.
- The team can split work across components in parallel after EP-02 lands.

---

## 3. Story Conventions

Every story uses a consistent format:

```
### STORY-NN.M: <Imperative title>

**Type:** feature | infrastructure | refactor | research | docs
**Effort:** S (≤1 day) | M (1–3 days) | L (3–7 days) | XL (>7 days, consider splitting)
**Module:** <module code from architecture §3.2 — SE, KR, SL, etc.>
**Depends on:** <STORY-IDs that must complete first; "none" if independent>
**FR / NFR refs:** <PRD requirement IDs this story serves>
**Architecture refs:** <architecture.md section refs>

**As a** <role>
**I want** <capability>
**So that** <value>

**Acceptance Criteria:**
- [ ] AC1: ...
- [ ] AC2: ...

**Technical Notes:**
- Implementation hints, gotchas, file paths, libraries.

**Definition of Done:**
- Standard DoD applies (see §4); story-specific additions noted here.
```

## 4. Definition of Done (applies to every story)

A story is "done" when all of the following are true:

1. **Code:** Implemented per acceptance criteria; passes `npm run lint`, `npm test`, `svelte-check`.
2. **Tests:** Unit tests for pure logic; integration tests for cross-module boundaries; e2e tests for user-facing flows (via Playwright, FreeShow's existing test infrastructure).
3. **Architecture conformance:** Matches the module boundaries and interfaces defined in architecture.md. Any divergence is documented in an ADR amendment.
4. **Cross-platform:** Works on macOS arm64, macOS x86_64, Windows x86_64, Linux x86_64 (the four MVP targets). Linux arm64 is best-effort.
5. **Both deployment modes (where applicable):** If the story touches modules that vary by mode (OutputAdapter, FreeShow integration, distribution), it works in both fork and sister-service modes, OR explicitly scopes which modes it targets.
6. **Documentation:** Inline TSDoc on public interfaces; architecture.md updated if the design shifts; README updated if user-visible.
7. **Reviewed:** Code reviewed by at least one other engineer; architectural decisions reviewed by the architect role.
8. **Demoable:** A working demo can be shown to a non-technical stakeholder.

### 4.1 Definition of Done — Milestone (in addition to per-story DoD)

Story-level DoD checks correctness. Milestone-level DoD checks **functionality** — does the feature actually work end-to-end from a user's perspective, not just "the code is internally consistent"?

A milestone is "done" when all of the following are true, in addition to every constituent story being individually done:

1. **All constituent stories meet story-level DoD.**
2. **Milestone demo runs end-to-end.** The demo described in §7 for this milestone executes successfully on at least one platform (macOS arm64 acceptable; full matrix at M7).
3. **`/qa-analyst` verification pass.** A senior-QA-analyst live verification pass exercises the milestone's demo path through the actual UI (or actual command-line in the case of infrastructure milestones). The QA pass produces a structured report with:
    - Severity-tagged defects (critical / major / minor / cosmetic)
    - Reproduction steps for each defect
    - Evidence (screenshots, console output, network traces, data state)
    - Recommended disposition (fix before milestone closes / fix in next milestone / accept)
4. **Critical and major defects from the QA pass are resolved** before the milestone is marked complete. Minor and cosmetic defects may be deferred with an explicit decision recorded.
5. **The QA report is committed** to the repo at `docs/qa-reports/M<n>-<date>.md`.

**Why per-milestone, not per-story:**
- Stories like STORY-01.4 (typed config + settings scaffolding) produce modules with no user-facing surface. Running `/qa-analyst` against them would correctly report "nothing to verify."
- Milestones bound a coherent demoable feature path. That's the right unit for functional verification.
- This avoids running a heavy QA process against pre-runnable scaffolding while still locking in functional verification at every checkpoint where it has signal.

**Exceptions:**
- M1 (Architecture Proven) is the first milestone with a demoable surface; it's the first checkpoint that gets a `/qa-analyst` pass.
- For infrastructure-only milestones (none currently planned, but possible), the equivalent verification is a CLI-driven smoke test producing the same report shape.

---

## 5. Epic Index

| # | Epic | MVP | Stories | Effort estimate |
|---|---|---|---|---|
| **Foundation (walking skeleton)** | | | | |
| EP-01 | Project Foundation | ✅ | 6 | M |
| EP-02 | OutputAdapter Walking Skeleton | ✅ | 5 | L |
| EP-03 | Timing Map & Storage | ✅ | 6 | M |
| EP-04 | Python Sidecar Infrastructure | ✅ | 7 | L |
| **Core MVP capability** | | | | |
| EP-05 | Song Learning Pipeline | ✅ | 8 | XL |
| EP-06 | Karaoke Renderer | ✅ | 8 | L |
| EP-07 | Audio Input & Beat Detection | ✅ | 7 | L |
| EP-08 | VAD & STT Position Correction | ✅ | 6 | L |
| EP-09 | Sync Engine Core | ✅ | 8 | XL |
| EP-10 | Operator UI & Manual Override | ✅ | 8 | L |
| **Lyrics & Setlist** | | | | |
| EP-11 | Lyrics Sourcing & Show Creation | ✅ | 7 | M |
| EP-12 | Setlist & Continuous Playback | ✅ | 6 | M |
| **Multi-Tenant Infrastructure** | | | | |
| EP-13 | Library Manager (LM) | ✅ | 9 | L |
| EP-14 | Library Hosting Setup | ✅ | 6 | M |
| EP-15 | Multi-Tenant Identity & Publishing | ✅ | 7 | L |
| EP-16 | Mixed-Mode Project Sources | ✅ | 5 | M |
| **Post-MVP** | | | | |
| EP-17 | Rehearsal Learning Mode | — | 6 | L |
| EP-18 | Arrangement Builder | — | 5 | M |
| EP-19 | Multilingual Parallel Lyrics | — | 5 | M |
| EP-20 | Captions Word-Highlight Upstream PR | — | 4 | M |

**Total: 20 epics, ~133 stories.**

---

# Part I — Foundation (Walking Skeleton)

These four epics establish the structure, prove the architecture, and lay the rails everything else runs on. Until they're done, nothing else can land.

---

## EP-01: Project Foundation

**Goal:** Stand up the fork repo, the sister-service repo (or unified monorepo, decided in STORY-01.1), the CI matrix, the directory structure, the typed configuration scaffolding, and the first-run identity model. After this epic, an engineer can `git clone && npm install && npm start` and get a running (empty) LyriCue.

**FR/NFR refs:** P3 (clean boundary), P9 (single-installer), P11 (dual-mode), NFR3.1 (cross-platform), MC-NFR1 (zero-IT install).

**Architecture refs:** §3.4 (build & distribution), §7 (FreeShow integration), §8 (multi-tenant deployment), §12 (build pipeline).

### STORY-01.1: Confirm monorepo layout (DECIDED) and write the layout ADR

**Type:** research / docs
**Effort:** S
**Module:** Project infra
**Depends on:** none
**FR/NFR refs:** P3, P11
**Architecture refs:** §3.4

**Decision (made 2026-05-13):** **Single monorepo.** Confirmed by the project owner. The "research" element of this story is reduced to writing the ADR that records the decision and locks in the folder layout.

**As a** developer
**I want** the chosen monorepo layout documented as an ADR so subsequent stories have an unambiguous structure to follow
**So that** the team doesn't re-litigate the decision later or invent inconsistent paths.

**Acceptance Criteria:**
- [ ] AC1: New ADR added to architecture.md (ADR-17 or appropriate next number) titled "Single Monorepo Layout."
- [ ] AC2: ADR includes the agreed folder layout:
  ```
  lyricue/                          (single repo)
  ├── apps/
  │   ├── fork/                     (fork-mode entry — vendors FreeShow as a submodule or subtree)
  │   │   └── freeshow/             (git submodule pinned to a FreeShow release tag)
  │   └── sister/                   (sister-mode standalone Electron entry)
  ├── packages/
  │   ├── core/                     (shared modules: SE, BD, VAD, ST, TM, SC, LM, types, utils)
  │   └── ui/                       (shared Svelte components: KaraokeOutput, SetlistPanel, etc.)
  ├── python-sidecar/               (Python ML pipeline)
  ├── infra/
  │   └── publish-worker/           (Cloudflare Worker)
  ├── docs/
  └── package.json                  (npm workspaces root)
  ```
- [ ] AC3: ADR identifies what's shared (`packages/core/`, `packages/ui/`, `python-sidecar/`) vs. what's mode-specific (`apps/fork/`, `apps/sister/`).
- [ ] AC4: ADR documents the build-time flag `LC_DEPLOYMENT_MODE=fork|sister` selecting entry point and OutputAdapter.
- [ ] AC5: ADR notes that FreeShow is vendored as a git submodule under `apps/fork/freeshow/`, pinned to a release tag — bumped via deliberate PRs.

**Technical Notes:**
- npm workspaces (not pnpm/yarn) — matches FreeShow's tooling.
- The FreeShow submodule should be tagged at the same version FreeShow currently ships in stable (1.6.1 at draft time).
- This story is the gate that unblocks STORY-01.2 (workspace initialization). Should land within hours of starting Phase 4, not days.

**Definition of Done:**
- DoD §1 applies. ADR is reviewable before any other Phase 4 work begins.

---

### STORY-01.2: Initialize the monorepo with chosen tooling

**Type:** infrastructure
**Effort:** M
**Module:** Project infra
**Depends on:** STORY-01.1
**FR/NFR refs:** P3
**Architecture refs:** §3.4

**As a** developer
**I want** a working monorepo with workspace tooling (npm workspaces or pnpm), TypeScript, prettier (matching FreeShow's config), eslint, and a top-level `package.json` that orchestrates per-app builds
**So that** I can develop both deployment-mode builds without fighting tooling.

**Acceptance Criteria:**
- [ ] AC1: `npm install` (or `pnpm install`) at root installs all workspace dependencies.
- [ ] AC2: `npm run build:fork` produces a runnable Electron app via the FreeShow fork integration.
- [ ] AC3: `npm run build:sister` produces a runnable Electron app for sister-service mode.
- [ ] AC4: `npm run lint`, `npm run format`, `npm test` work at the workspace root and each workspace.
- [ ] AC5: Prettier config matches FreeShow's exactly (`printWidth: 500`, `tabWidth: 4`, `semi: false`, `singleQuote: false`, `trailingComma: "none"`) — verified by running prettier on FreeShow source unchanged.
- [ ] AC6: TypeScript target matches FreeShow (TS 4.9 minimum; aim for 5.x in our own code, with `skipLibCheck: true` to avoid FreeShow source friction).
- [ ] AC7: README at root explains how to run, build, test.

**Technical Notes:**
- npm workspaces is enough; no need for nx/turborepo at this scale.
- The FreeShow submodule should pin to a tagged release (1.6.1 at draft time); upgrade by bumping the submodule commit, which is a clear PR diff.

---

### STORY-01.3: Set up the CI build matrix (5 platforms)

**Type:** infrastructure
**Effort:** M
**Module:** Project infra
**Depends on:** STORY-01.2
**FR/NFR refs:** NFR3.1, MC-NFR1
**Architecture refs:** §8.6, §12.2

**As a** developer
**I want** GitHub Actions that build both fork and sister-service installers for all five target platforms on every push to main
**So that** broken builds are caught immediately, not at release time.

**Acceptance Criteria:**
- [ ] AC1: 10 jobs run on every PR: (fork, sister) × (macOS arm64, macOS x86_64, Windows x86_64, Linux x86_64, Linux arm64).
- [ ] AC2: Each job runs lint + tests before building installer.
- [ ] AC3: Linux arm64 runs on a self-hosted runner OR `ubuntu-latest` with QEMU emulation (whichever the team supports).
- [ ] AC4: Build artifacts uploaded to GitHub Actions artifacts for at least 14 days.
- [ ] AC5: PRs cannot be merged with red CI (branch protection).
- [ ] AC6: Build time per platform ≤ 20 minutes (cached) / ≤ 40 minutes (cold).

**Technical Notes:**
- electron-builder handles the per-platform packaging. The CI matrix lives in `.github/workflows/build.yml`.
- macOS code-signing certs and Apple ID for notarization are required GitHub Actions secrets.
- Windows EV code-signing cert lives in a separate signed-step using either Azure Key Vault or AWS KMS.
- For the first cut, signed builds can be optional; unsigned builds work for development; signing is required before public release (separate story in EP-14).

---

### STORY-01.4: Define the typed config & settings scaffolding

**Type:** infrastructure
**Effort:** M
**Module:** Settings (WS)
**Depends on:** STORY-01.2
**FR/NFR refs:** FR4.1–4.6, P5
**Architecture refs:** §6.3 (identity), §6.4 (library config), §6.5 (settings), §7.3

**As a** developer
**I want** typed schemas for `LyriCueSettings`, `InstallIdentity`, `LibraryConfig` (per architecture.md §6.3–6.5) and a typed accessor module that persists them atomically to `<userData>/lyricue/`
**So that** every other module reads/writes settings through one place, with confidence in the shape.

**Acceptance Criteria:**
- [ ] AC1: TS types for all three schemas live in `packages/core/types/LyriCue.ts` and exactly match architecture.md.
- [ ] AC2: `SettingsStore`, `IdentityStore`, `LibraryConfigStore` modules provide async `load()`, `save()`, and Svelte-style subscribe APIs.
- [ ] AC3: All writes use the atomic write-then-rename pattern (ADR-7); a partial write left behind from a crash is detected on next load and discarded with a logged warning.
- [ ] AC4: Schema versioning: each schema has a `$schema` field; loader rejects unknown major versions; forward migrations supported (ADR-10).
- [ ] AC5: Secret credentials use Electron `safeStorage` (per architecture §6.4); never plaintext on disk.
- [ ] AC6: Unit tests cover: fresh install (no files exist → defaults), corrupt file (malformed JSON → defaults + warning), schema mismatch (older version → migration runs), atomic write under simulated crash.

**Technical Notes:**
- The Svelte-style subscribe API lets renderer components react to settings changes without polling.
- For the keychain `safeStorage`: the renderer can't access it directly — main-process settings module exposes an `encryptValue(plaintext) → handle` and `decryptValue(handle) → plaintext` over IPC.

---

### STORY-01.5: Implement the first-run wizard skeleton (UI shell only)

**Type:** feature
**Effort:** M
**Module:** WS
**Depends on:** STORY-01.4
**FR/NFR refs:** NFR5.3, MC-NFR1, MC-NFR6
**Architecture refs:** §8.4

**As a** new user installing LyriCue for the first time
**I want** to be guided through a 5-step setup (welcome, audio device, library URL, identity, publish credential)
**So that** I can start using the app within 5 minutes without reading docs.

**Acceptance Criteria:**
- [ ] AC1: Wizard appears automatically on first launch (no identity file detected).
- [ ] AC2: Wizard has the 5 steps from architecture §8.4: Welcome, Audio Input, Library Connection, Identity, Publish Access, Done.
- [ ] AC3: All steps after step 1 are skippable except where data is required for a chosen path.
- [ ] AC4: Skipping library + identity = "anonymous local-only install" — fully functional, just no central library access.
- [ ] AC5: On completion, writes `identity.json`, optionally `libraryConfig.json`, marks wizard complete in settings.
- [ ] AC6: Wizard can be re-run from Settings → Reset Setup (for re-imaging or testing).
- [ ] AC7: Visual design uses FreeShow's existing component library (so it doesn't look like an alien attachment).

**Technical Notes:**
- The actual audio-device picker is wired up in EP-07; here we just stub a dropdown with one fake device.
- The library URL connect button is a no-op stub until EP-13 lands; just store the URL.
- Identity defaults: `org.id = "local"`, `campus.id = "default"`, `user.isAnonymous = true` if user skips.

---

### STORY-01.6: Add the Settings tab to the host app

**Type:** feature
**Effort:** S
**Module:** WS
**Depends on:** STORY-01.4
**FR/NFR refs:** FR4.5, NFR5.3
**Architecture refs:** §4.10, §7.1

**As a** user
**I want** a "LyriCue" tab in the app's settings panel
**So that** I can change display, sync, shortcut, library, and identity settings without re-running the wizard.

**Acceptance Criteria:**
- [ ] AC1: New tab added to FreeShow's settings panel (fork mode) or to the standalone app's settings (sister mode).
- [ ] AC2: Tab has subsections matching the schemas: Display, Sync, Shortcuts, Library, Identity, Sidecar.
- [ ] AC3: Each setting is editable with appropriate controls (color pickers, number sliders, dropdowns).
- [ ] AC4: Changes persist immediately via SettingsStore.save() with debouncing.
- [ ] AC5: A "Reset to defaults" button per section.
- [ ] AC6: Many controls are stubs until their module lands (e.g., audio device picker shows "configure during wizard" until EP-07).

---

## EP-02: OutputAdapter Walking Skeleton

**Goal:** Prove the dual-mode architecture works. Build the `OutputAdapter` interface and both initial implementations (`ForkOutputAdapter` and `OwnWindowOutputAdapter`) with stubbed input data. Show a hello-world karaoke effect through both adapters end-to-end. This is the single most architecturally important epic — if it falters, we revisit ADR-16.

**FR/NFR refs:** P11, FR2 (subset), NFR1.3.

**Architecture refs:** §3.3 (process model), §4.9 (KR + OutputAdapter), §7.8 (sister-service integration), ADR-16.

### STORY-02.1: Define the OutputAdapter TypeScript interface

**Type:** infrastructure
**Effort:** S
**Module:** KR
**Depends on:** STORY-01.2
**FR/NFR refs:** P11, NFR6.2
**Architecture refs:** §4.9

**As a** developer
**I want** a strict TypeScript interface for OutputAdapter with documented contracts
**So that** the two initial implementations and any future ones (Caption injection, post-PR Caption sweep) conform to a known shape.

**Acceptance Criteria:**
- [ ] AC1: `OutputAdapter` interface in `packages/core/types/LyriCue.ts` matches architecture §4.9 exactly.
- [ ] AC2: TSDoc on every method explaining lifecycle, threading expectations, error handling expectations.
- [ ] AC3: `AdapterHealth` type defined: last-frame-delivered timestamp, frames-dropped counter, last-error.
- [ ] AC4: Mock implementation `MockOutputAdapter` in `packages/core/test-utils/` that records all calls — used in unit tests of upstream modules (SE) without needing a real adapter.
- [ ] AC5: A `SyncFrame` test-fixture module produces a sequence of frames at 60Hz that exercise the full word-progression range.

---

### STORY-02.2: Implement ForkOutputAdapter (stub renderer)

**Type:** feature
**Effort:** M
**Module:** KR
**Depends on:** STORY-02.1
**FR/NFR refs:** P11
**Architecture refs:** §4.9, §7.2

**As a** developer
**I want** a ForkOutputAdapter that mounts a `KaraokeOutput.svelte` component inside a FreeShow output BrowserWindow flagged with `karaokeMode: true`, receiving SyncFrames via FreeShow's OUTPUT IPC channel
**So that** the fork-mode rendering path is proven end-to-end.

**Acceptance Criteria:**
- [ ] AC1: Code changes to FreeShow fork are exactly the 10 touch points enumerated in architecture §7.1 — no more.
- [ ] AC2: `OUTPUT` channel routing handles new message types `LC_SYNC_FRAME` and `LC_LOAD_MAP` (renamed from architecture's `WS_*` for consistency with LyriCue identity).
- [ ] AC3: Creating an output with `karaokeMode: true` shows a new BrowserWindow that renders `KaraokeOutput.svelte` instead of FreeShow's standard `Output.svelte`.
- [ ] AC4: Renderer displays "Hello, world!" as static text; subscribes to `currentWordIndex` and `wordProgress` stores (even though no real data flows in yet).
- [ ] AC5: ForkOutputAdapter exposes `pushSyncFrame(frame)` which sends an IPC message reaching the renderer in <20 ms (measured via a round-trip test).
- [ ] AC6: When the karaoke output window is closed, the adapter cleans up the IPC listener.

**Technical Notes:**
- The 10 FreeShow touchpoints are in `src/types/Channels.ts`, `src/types/Output.ts`, `src/electron/output/OutputHelper.ts`, `src/electron/output/helpers/OutputLifecycle.ts`, `src/electron/index.ts`, `src/frontend/MainOutput.svelte`, `src/frontend/main.ts`, `src/frontend/components/settings/Settings.svelte`, `src/frontend/utils/shortcuts.ts`, plus the new directories `src/electron/lyricue/`, `src/frontend/lyricue/`, `src/types/LyriCue.ts`.
- For this story, the karaoke component is minimal — actual rendering logic comes in EP-06.

---

### STORY-02.3: Implement OwnWindowOutputAdapter (stub renderer)

**Type:** feature
**Effort:** M
**Module:** KR
**Depends on:** STORY-02.1
**FR/NFR refs:** P11
**Architecture refs:** §4.9, §7.8

**As a** developer
**I want** an OwnWindowOutputAdapter that creates a LyriCue-owned Electron BrowserWindow and renders the same `KaraokeOutput.svelte` component inside it
**So that** the sister-service-mode rendering path is proven end-to-end without depending on FreeShow at all.

**Acceptance Criteria:**
- [ ] AC1: Calling `adapter.start({ outputId, bounds })` creates a new BrowserWindow with the same visual config as FreeShow's outputs (transparent, frameless, alwaysOnTop, etc. — per `outputOptions` in architecture §4.9's reference to FreeShow's windowOptions.ts).
- [ ] AC2: The window renders the same `KaraokeOutput.svelte` from STORY-02.2 — proving the component is mode-agnostic.
- [ ] AC3: SyncFrames pushed to the adapter flow into the window via internal IPC (Electron's `webContents.send`).
- [ ] AC4: Adapter handles window close gracefully — emits `adapterClosed` event for higher-level code to react.
- [ ] AC5: Multiple OwnWindowOutputAdapter instances can run simultaneously (multi-monitor support).

---

### STORY-02.4: Wire up the walking-skeleton demo

**Type:** feature
**Effort:** M
**Module:** SE (stub), KR
**Depends on:** STORY-02.2, STORY-02.3
**FR/NFR refs:** P11
**Architecture refs:** ADR-16

**As a** stakeholder
**I want** to run `npm run demo:walking-skeleton` and see a karaoke-style word highlight running end-to-end through both adapter modes, driven by fake data
**So that** we have proof the architecture composes before investing in real implementations.

**Acceptance Criteria:**
- [ ] AC1: A demo script in `apps/{fork,sister}/scripts/demo.ts` loads a hardcoded TimingMap ("Hello world this is LyriCue working"), uses a fake SyncEngine that advances a cursor at 1 word/second, and pushes SyncFrames through the configured adapter.
- [ ] AC2: Run in fork mode: launches FreeShow fork, creates a karaoke output, sees the demo run.
- [ ] AC3: Run in sister mode: launches standalone app, creates a karaoke output via OwnWindowOutputAdapter, sees the demo run.
- [ ] AC4: Both demos show identical visual output (same component, same data) — proving the OutputAdapter abstraction works.
- [ ] AC5: Demo script is documented in README under "verify the architecture works."

---

### STORY-02.5: Adapter health monitoring + diagnostics

**Type:** feature
**Effort:** S
**Module:** KR
**Depends on:** STORY-02.2, STORY-02.3
**FR/NFR refs:** NFR2.5
**Architecture refs:** §4.9

**As a** developer debugging sync issues
**I want** each adapter to expose `AdapterHealth` (last frame timestamp, dropped-frame count, last error) reachable from the main app's Settings → Diagnostics pane
**So that** I can quickly see if frames aren't reaching the output without diving into logs.

**Acceptance Criteria:**
- [ ] AC1: `AdapterHealth` updates in real time as frames flow.
- [ ] AC2: A Diagnostics panel in Settings shows the current adapter's health.
- [ ] AC3: Dropped frames (any frame pushed when the IPC queue is full) increment a counter and log a warning.

---

## EP-03: Timing Map & Storage

**Goal:** Implement the TM module per architecture §4.3. All on-disk persistence for timing maps, arrangements, and the `.show` `meta.lyricue` pointer.

**FR/NFR refs:** FR1.7, FR11.1, FR11.2, FR11.8, NFR2.1, NFR6.1.

**Architecture refs:** §4.3, §6.1, §6.2, ADR-1, ADR-7, ADR-10.

### STORY-03.1: TimingMap schema TS types and validators

**Type:** infrastructure
**Effort:** S
**Module:** TM
**Depends on:** STORY-01.2
**FR/NFR refs:** NFR6.1
**Architecture refs:** §6.1

**As a** developer
**I want** TS types for `TimingMap`, `TimingSection`, `TimingWord`, `TimingLine` exactly matching architecture §6.1, plus a Zod (or equivalent) validator that produces typed errors on bad input
**So that** every consumer of timing maps has compile-time and runtime safety.

**Acceptance Criteria:**
- [ ] AC1: All four types exported from `packages/core/types/LyriCue.ts`.
- [ ] AC2: `validateTimingMap(unknown) → Result<TimingMap, ValidationError[]>` returns either a parsed map or an array of specific errors with JSON paths.
- [ ] AC3: Test fixtures: a valid map, a map with each kind of structural error, an empty map, a map at max scale (100+ words/section, 10 sections). All are tested.

---

### STORY-03.2: Atomic write infrastructure

**Type:** infrastructure
**Effort:** S
**Module:** TM
**Depends on:** STORY-01.2
**FR/NFR refs:** NFR2.1
**Architecture refs:** §4.3, ADR-7

**As a** developer
**I want** a `writeFileAtomic(path, content)` utility in `packages/core/fs/atomicWrite.ts`
**So that** every persisted file write is crash-safe.

**Acceptance Criteria:**
- [ ] AC1: Implementation writes to `<path>.tmp`, fsyncs, then renames to final path.
- [ ] AC2: Works on macOS, Windows, Linux.
- [ ] AC3: A simulated-crash test (kill the process mid-write via a signal in a child process) confirms no partial write is observed.
- [ ] AC4: Used by SettingsStore (STORY-01.4) — refactor that to use this utility.

---

### STORY-03.3: TimingMapStorage CRUD

**Type:** feature
**Effort:** M
**Module:** TM
**Depends on:** STORY-03.1, STORY-03.2
**FR/NFR refs:** FR1.7, NFR2.1
**Architecture refs:** §4.3

**As a** developer
**I want** `TimingMapStorage` with `load(showId)`, `save(showId, map)`, `delete(showId)`, `exists(showId)` per architecture §4.3
**So that** other modules persist and retrieve timing maps without knowing about disk layout.

**Acceptance Criteria:**
- [ ] AC1: Files written to `<userData>/lyricue/timing-maps/<showId>.timing.json` per architecture §4.3.
- [ ] AC2: `load()` validates with STORY-03.1's validator; returns `null` if file missing; throws structured error if validation fails.
- [ ] AC3: `save()` runs validation before writing; uses `writeFileAtomic` from STORY-03.2.
- [ ] AC4: `delete()` is idempotent (deleting a nonexistent file does not throw).
- [ ] AC5: Updates the corresponding `.show` file's `meta.lyricue` pointer field (per architecture §4.3); `.show` parsing is read-modify-write with atomic write.
- [ ] AC6: Unit tests cover all four methods with each edge case.

---

### STORY-03.4: Arrangement storage

**Type:** feature
**Effort:** S
**Module:** TM
**Depends on:** STORY-03.3
**FR/NFR refs:** FR9
**Architecture refs:** §4.3, §6.2

**As a** developer
**I want** arrangement persistence per architecture §6.2 — `loadArrangements(showId)`, `saveArrangements(showId, arrangements[])`
**So that** the arrangement builder (EP-18) and library import (EP-13) can store custom section sequences.

**Acceptance Criteria:**
- [ ] AC1: Files written to `<userData>/lyricue/arrangements/<showId>.arrangements.json`.
- [ ] AC2: Array of `Arrangement` per §6.2.
- [ ] AC3: Validator + atomic write + unit tests.

---

### STORY-03.5: Show-meta pointer hygiene

**Type:** feature
**Effort:** S
**Module:** TM
**Depends on:** STORY-03.3
**FR/NFR refs:** P5
**Architecture refs:** §4.3, §7.1

**As a** developer
**I want** the meta.lyricue pointer to be added/updated on every save and removed when the timing map is deleted
**So that** the host `.show` file accurately reflects which shows have timing data.

**Acceptance Criteria:**
- [ ] AC1: On `save()`, meta pointer fields `hasTimingMap: true`, `schemaVersion: '1'`, `updatedAt: ISO8601`.
- [ ] AC2: On `delete()`, the meta.lyricue pointer is removed (or set to `null`).
- [ ] AC3: Orphan cleanup: a startup task removes any `<userData>/lyricue/timing-maps/<id>.timing.json` whose show no longer exists. Logged. Runs only once per app launch.
- [ ] AC4: Unit + integration tests including the orphan-cleanup path.

---

### STORY-03.6: Schema migration framework

**Type:** infrastructure
**Effort:** S
**Module:** TM
**Depends on:** STORY-03.3
**FR/NFR refs:** NFR6.1
**Architecture refs:** ADR-10

**As a** developer
**I want** a forward-only schema migration framework so that v1 → v2 migrations land cleanly when we change the schema
**So that** old timing maps continue working through schema evolution.

**Acceptance Criteria:**
- [ ] AC1: `migrations/v1-to-v2.ts` pattern established: pure functions taking the old shape, returning the new shape.
- [ ] AC2: Loader detects schema version, applies migrations in sequence.
- [ ] AC3: A "synthetic v0" placeholder demonstrates the migration path even before a real v2 is introduced.
- [ ] AC4: After migration, the file is re-saved with the new version so subsequent loads skip the migration step.

---

## EP-04: Python Sidecar Infrastructure

**Goal:** Implement the Sidecar Controller (SC), the PyInstaller bundling pipeline, and the JSON-RPC protocol per architecture §4.2 and ADR-14. After this epic, an engineer can issue an arbitrary JSON-RPC method to the sidecar and get a structured response.

**FR/NFR refs:** P4, FR1.13, NFR2.5, NFR5.4, MC-NFR1.

**Architecture refs:** §4.2, §6.5 (RPC protocol), ADR-2, ADR-14.

### STORY-04.1: Scaffold the Python sidecar package

**Type:** infrastructure
**Effort:** S
**Module:** SL
**Depends on:** STORY-01.2
**FR/NFR refs:** P4
**Architecture refs:** §3.4

**As a** developer
**I want** the `python-sidecar/` directory containing `pyproject.toml`, a `worshipsync_sidecar` package, an empty `__main__.py` that prints `ready` and exits
**So that** subsequent stories have a Python project to build on.

**Acceptance Criteria:**
- [ ] AC1: `pyproject.toml` declares dependencies: faster-whisper, demucs, librosa, pyinstaller (dev).
- [ ] AC2: Package name is `lyricue_sidecar` (renamed from worshipsync per project rename).
- [ ] AC3: `python -m lyricue_sidecar` prints `{"method":"ready"}` to stdout and exits.
- [ ] AC4: Includes a Python 3.10+ version pin.

---

### STORY-04.2: JSON-RPC 2.0 protocol implementation in Python

**Type:** feature
**Effort:** M
**Module:** SL
**Depends on:** STORY-04.1
**FR/NFR refs:** P4
**Architecture refs:** §6.5

**As a** developer
**I want** a JSON-RPC 2.0 server in Python that reads NDJSON requests from stdin, writes responses to stdout, supports notifications (no `id`), errors with standard codes
**So that** the Electron main process can talk to the sidecar with a well-known protocol.

**Acceptance Criteria:**
- [ ] AC1: Method registry: dictionary mapping method name → handler function.
- [ ] AC2: Built-in methods: `ready` (notification on startup), `check_models`, `shutdown`.
- [ ] AC3: Errors use JSON-RPC 2.0 spec format with custom codes per architecture §6.5.
- [ ] AC4: Notifications (responses with no `id`) work — used for progress events later.
- [ ] AC5: Unit tests in Python (pytest) cover each method, malformed requests, error cases.
- [ ] AC6: Logs to stderr (which Electron captures); never to stdout (which is the protocol channel).

---

### STORY-04.3: SidecarController in Electron main

**Type:** feature
**Effort:** M
**Module:** SC
**Depends on:** STORY-04.2
**FR/NFR refs:** NFR2.5
**Architecture refs:** §4.2

**As a** developer
**I want** the `SidecarController` class per architecture §4.2 with `ensureRunning()`, `request()`, `shutdown()`, and an observable `status` property
**So that** all sidecar communication goes through one typed module.

**Acceptance Criteria:**
- [ ] AC1: TS class in `src/electron/lyricue/SidecarController.ts` matching architecture §4.2's interface.
- [ ] AC2: `ensureRunning()` spawns the bundled sidecar (via path from STORY-04.5) if no subprocess exists; resolves once the `ready` notification arrives.
- [ ] AC3: `request<TResult>(method, params, options?)` correlates by JSON-RPC `id`, returns a Promise.
- [ ] AC4: `onProgress` callback receives progress notifications during a request.
- [ ] AC5: Timeout: requests default to 30s timeout; configurable. Timeout closes the request, not the subprocess.
- [ ] AC6: Subprocess crash detection: process exit → `status = 'crashed'`, in-flight requests reject with `SIDECAR_CRASHED`, no app crash.
- [ ] AC7: `shutdown()` sends RPC shutdown method then SIGTERM if no response in 5s.
- [ ] AC8: Unit tests use a stub Python script (just bash echoing fixed JSON) — full subprocess integration covered by an integration test.

---

### STORY-04.4: Sidecar launcher path resolution

**Type:** infrastructure
**Effort:** S
**Module:** SC
**Depends on:** STORY-04.3
**FR/NFR refs:** MC-NFR1
**Architecture refs:** §4.2, §8.6

**As a** developer
**I want** `resolveSidecarPath()` that finds the bundled sidecar binary per platform (e.g., `app.getAppPath() + '/resources/sidecar/<platform>-<arch>/lyricue-sidecar'`)
**So that** `SidecarController.ensureRunning()` knows what to launch.

**Acceptance Criteria:**
- [ ] AC1: Returns the absolute path to the platform-specific binary.
- [ ] AC2: Verifies the binary exists; throws `SIDECAR_BINARY_MISSING` with a user-friendly message if not.
- [ ] AC3: Development mode (`NODE_ENV=development`): falls back to `python -m lyricue_sidecar` against the source directory.
- [ ] AC4: Unit tests for each branch (dev mode, prod mode + present, prod mode + missing).

---

### STORY-04.5: PyInstaller bundling pipeline per platform

**Type:** infrastructure
**Effort:** L
**Module:** SL
**Depends on:** STORY-04.1, STORY-01.3
**FR/NFR refs:** MC-NFR1, P9
**Architecture refs:** ADR-14, §12.2

**As a** developer
**I want** PyInstaller builds in CI producing one binary per platform/arch, included in the Electron installer as `extraResources`
**So that** end users don't need Python installed.

**Acceptance Criteria:**
- [ ] AC1: A `python-sidecar/build.sh` (or `build.py`) script runs PyInstaller with the right entry point and produces `dist/lyricue-sidecar-<platform>-<arch>/` containing the executable + all bundled deps.
- [ ] AC2: GitHub Actions matrix from STORY-01.3 invokes this per-platform; output is uploaded as an artifact, then consumed by the electron-builder step.
- [ ] AC3: electron-builder config: `extraResources: [{ from: "build/sidecar/${platform}-${arch}", to: "sidecar" }]` with `asarUnpack: ["**/sidecar/**"]`.
- [ ] AC4: Bundle size per platform documented; expected ~500–700 MB unbundled (PyTorch dominates).
- [ ] AC5: A `lyricue-sidecar --version` call (locally and from the installer) prints a version string and exits 0.
- [ ] AC6: The bundled binary is verified by running the integration test from STORY-04.3 in CI against the bundled binary, not source.

**Technical Notes:**
- The model files (Demucs, WhisperX) are **not** included in the PyInstaller bundle — they download on first use (per architecture §12.5). PyInstaller bundles only the Python runtime + libraries.

---

### STORY-04.6: Models download manager (model mirror)

**Type:** feature
**Effort:** M
**Module:** SL
**Depends on:** STORY-04.5
**FR/NFR refs:** NFR4.2, MC-NFR1
**Architecture refs:** §12.5

**As a** user starting song learning for the first time
**I want** the Demucs and WhisperX models to download automatically with a progress bar, then cache locally
**So that** I don't have to think about ML weights.

**Acceptance Criteria:**
- [ ] AC1: A model mirror URL is configurable per-install (default: Cloudflare R2 / Hugging Face fallback per §12.5).
- [ ] AC2: On first song learning request, the sidecar checks for required models; missing models are downloaded.
- [ ] AC3: Progress events flow via RPC notifications to the controller, which surfaces them to the UI.
- [ ] AC4: SHA256 checksum verified before installing into the cache.
- [ ] AC5: Cached at `<userData>/lyricue/models/<modelName>-<version>/`.
- [ ] AC6: Resumable: a partial download survives an app restart.

---

### STORY-04.7: Sidecar end-to-end smoke test

**Type:** test
**Effort:** S
**Module:** SL, SC
**Depends on:** STORY-04.5, STORY-04.6
**FR/NFR refs:** P4
**Architecture refs:** §4.1

**As a** developer
**I want** a CI smoke test: spawn the bundled sidecar, run `check_models`, run a no-op `learn_song` with a 1-second audio clip and a 3-word lyric set, verify a timing map comes back
**So that** every PR verifies the full sidecar path works end-to-end.

**Acceptance Criteria:**
- [ ] AC1: Test runs in <60s (excluding initial model download, which is cached).
- [ ] AC2: Test runs on at least one platform in CI (macOS arm64 is fastest); others run nightly.
- [ ] AC3: A failure here is a release-blocking signal.

---

# Part II — Core MVP Capability

Once the foundation is in place, these epics deepen the modules with real implementations. EP-05 through EP-09 are largely parallelizable after their entry-point story dependencies are met.

---

## EP-05: Song Learning Pipeline

**Goal:** Implement the full SL module per architecture §4.1. Audio file + lyrics → timing map JSON via Demucs → WhisperX → BPM → section assembly.

**FR/NFR refs:** FR1.1–FR1.13, FR8.4, FR8.6, FR8.9, NFR1.1.

**Architecture refs:** §4.1, §6.1.

### STORY-05.1: Audio decode and resample stage

**Type:** feature
**Effort:** S
**Module:** SL
**Depends on:** STORY-04.7
**FR/NFR refs:** FR1.1
**Architecture refs:** §4.1 step 1

**As a** developer
**I want** the sidecar to accept MP3/WAV/FLAC/OGG audio files and resample to 16kHz mono float32
**So that** downstream stages have a consistent input format.

**Acceptance Criteria:**
- [ ] AC1: Uses `librosa.load(path, sr=16000, mono=True)`.
- [ ] AC2: Validates file exists and is one of the four supported formats.
- [ ] AC3: Max file size 50MB enforced (per PRD AC1.1); over-size returns `AUDIO_DECODE_FAILED` with a specific reason.
- [ ] AC4: Rejects unparseable files with `AUDIO_DECODE_FAILED`.
- [ ] AC5: Returns duration in seconds for use in subsequent stages.

---

### STORY-05.2: Demucs vocal isolation stage

**Type:** feature
**Effort:** M
**Module:** SL
**Depends on:** STORY-05.1, STORY-04.6
**FR/NFR refs:** FR1.2
**Architecture refs:** §4.1 step 2

**As a** developer
**I want** the sidecar to run Demucs `htdemucs` on decoded audio and produce isolated vocals
**So that** alignment in the next stage has clean input.

**Acceptance Criteria:**
- [ ] AC1: Uses Demucs Python API (not subprocess) for in-process speed.
- [ ] AC2: Outputs vocals as float32 NumPy array (in memory) and optionally writes a debug WAV when `options.debug = true`.
- [ ] AC3: Apple Silicon: PyTorch MPS device used when available; falls back to CPU.
- [ ] AC4: CUDA: used when available (Linux/Windows with NVIDIA GPU); CPU fallback otherwise.
- [ ] AC5: Progress notifications emit every 1–2 seconds during processing.
- [ ] AC6: Memory: peak usage ≤ 4 GB for a 5-minute song on the smallest model.
- [ ] AC7: Failure modes: `VOCAL_ISOLATION_FAILED` (e.g., audio shorter than model's minimum length); `NO_VOCALS_DETECTED` (output RMS too low) — these get specific error codes per architecture §6.5.

---

### STORY-05.3: WhisperX forced alignment stage

**Type:** feature
**Effort:** L
**Module:** SL
**Depends on:** STORY-05.2
**FR/NFR refs:** FR1.3
**Architecture refs:** §4.1 step 3

**As a** developer
**I want** the sidecar to run WhisperX forced alignment on the isolated vocals against the provided lyrics, producing per-word `(start_ms, end_ms, confidence)` tuples
**So that** the timing map's words have accurate timestamps.

**Acceptance Criteria:**
- [ ] AC1: Uses `faster-whisper` for transcription and `whisperx.load_align_model` + `whisperx.align` for alignment.
- [ ] AC2: Forced-alignment mode: pass the known lyrics text; WhisperX matches its transcription to the known text.
- [ ] AC3: Word-level output with confidence in [0, 1].
- [ ] AC4: Unmatched words (where alignment confidence is null/very low) are flagged with `confidence: null` and `endMs - startMs = 0` placeholder.
- [ ] AC5: Language parameter respected (per `options.language`, defaults to `en`).
- [ ] AC6: Configurable model size (`tiny`/`base`/`small`/`medium`); default `small` per architecture.

---

### STORY-05.4: BPM detection stage

**Type:** feature
**Effort:** S
**Module:** SL
**Depends on:** STORY-05.1
**FR/NFR refs:** FR1.4
**Architecture refs:** §4.1 step 4

**As a** developer
**I want** the sidecar to detect BPM from the original mix (not the isolated vocals)
**So that** the timing map records the reference BPM for live tempo ratio.

**Acceptance Criteria:**
- [ ] AC1: Uses `librosa.beat.tempo` on the original mix.
- [ ] AC2: Output is the dominant BPM as an integer (rounded from float).
- [ ] AC3: Returns null if detection confidence is very low (e.g., spoken word content).
- [ ] AC4: Time signature detection is best-effort; defaults to `4/4` if uncertain.

---

### STORY-05.5: Section mapping & timing map assembly

**Type:** feature
**Effort:** M
**Module:** SL
**Depends on:** STORY-05.3, STORY-05.4
**FR/NFR refs:** FR1.5, FR1.7
**Architecture refs:** §4.1 steps 5-6, §6.1

**As a** developer
**I want** the sidecar to assemble the final `TimingMap` JSON per the `lyricue-timing-v1` schema, mapping aligned words to their slide sections from the input `lyrics[]` array
**So that** the output is immediately usable by other modules.

**Acceptance Criteria:**
- [ ] AC1: Output conforms to the schema in architecture §6.1 — passes the validator from STORY-03.1.
- [ ] AC2: Words are bucketed into sections based on input `lyrics[]` ordering (the caller has already structured lyrics by section).
- [ ] AC3: Line boundaries derived from `\n` in the input lyrics text; populated in `section.lines[]`.
- [ ] AC4: `held` flag set on words where `endMs - startMs > 800`.
- [ ] AC5: Metadata: `demucsModel`, `whisperxModel`, `schemaVersion: '1'`, `version: '1.0.0'`.
- [ ] AC6: `learnedFrom`: includes `method: 'studio'`, `filename`, `duration`, `learnedAt`.

---

### STORY-05.6: Section auto-detection (FR1.5)

**Type:** feature
**Effort:** M
**Module:** SL
**Depends on:** STORY-05.5
**FR/NFR refs:** FR1.5
**Architecture refs:** §4.1

**As a** developer
**I want** an optional heuristic that infers section boundaries (verse/chorus/bridge) from lyric repetition and audio energy contours when the caller did NOT pre-structure the lyrics
**So that** the UI can show a draft structure that the user can correct.

**Acceptance Criteria:**
- [ ] AC1: When `options.detectSections: true`, the sidecar uses lyric repetition (lines appearing 2+ times → chorus candidates) + audio energy spikes (per `librosa.feature.rms`) to propose section boundaries.
- [ ] AC2: Output includes a `proposedSections[]` array separate from `sections[]`; the caller decides whether to accept.
- [ ] AC3: Best-effort, never blocking: if detection fails, returns empty `proposedSections[]` and proceeds normally.

---

### STORY-05.7: Cancel-in-flight job support

**Type:** feature
**Effort:** S
**Module:** SL, SC
**Depends on:** STORY-05.5
**FR/NFR refs:** FR1.13
**Architecture refs:** §6.5

**As a** user
**I want** to cancel an in-progress song-learning job
**So that** I can recover from a stuck job without killing the app.

**Acceptance Criteria:**
- [ ] AC1: `cancel_job(jobId)` RPC method per architecture §6.5.
- [ ] AC2: SC's `request()` exposes an `AbortSignal` option.
- [ ] AC3: Cancellation interrupts the current stage at the next checkpoint (typically within 1–3 seconds).
- [ ] AC4: Cancelled jobs return `JOB_CANCELLED` error code.

---

### STORY-05.8: End-to-end song learning integration test

**Type:** test
**Effort:** M
**Module:** SL
**Depends on:** STORY-05.5, STORY-05.7
**FR/NFR refs:** NFR1.1
**Architecture refs:** §4.1

**As a** developer
**I want** a CI test that feeds a 30-second test song + lyrics through the full pipeline and asserts a valid timing map comes back within 60 seconds on the slowest CI runner
**So that** every PR validates the end-to-end pipeline.

**Acceptance Criteria:**
- [ ] AC1: Test data: a 30-second public-domain song clip + its lyrics committed under `python-sidecar/tests/fixtures/`.
- [ ] AC2: Test wraps the full SC.request('learn_song', ...) call.
- [ ] AC3: Asserts at minimum: response is a valid TimingMap, has ≥10 words, all word timestamps are within song bounds, BPM is present and in [40, 200].
- [ ] AC4: Total wall-clock under 90 seconds for the smallest model on the slowest CI runner.

---

## EP-06: Karaoke Renderer

**Goal:** Implement the full KR module per architecture §4.9. The hello-world stub from EP-02 is replaced with the real renderer: sweep animation, line transitions, held-note pulse, next-section preview, parallel lyrics.

**FR/NFR refs:** FR2.1–FR2.11, FR10 (partial — display only), NFR1.3, NFR3.4.

**Architecture refs:** §4.9.

### STORY-06.1: Word-sweep CSS animation engine

**Type:** feature
**Effort:** M
**Module:** KR
**Depends on:** STORY-02.4
**FR/NFR refs:** FR2.1, FR2.2, FR2.3, NFR1.3
**Architecture refs:** §4.9

**As a** congregation member
**I want** to see each word fill from left-to-right with a smooth gradient as it should be sung
**So that** I can keep tempo without thinking.

**Acceptance Criteria:**
- [ ] AC1: Each word rendered in a `<span class="word">` with `style="--progress: 0..1"`.
- [ ] AC2: CSS uses `linear-gradient` + `background-clip: text` per architecture §4.9 to produce the sweep effect.
- [ ] AC3: Sweep is 60fps smooth on a 4-core M1 Mac (measured).
- [ ] AC4: Color is configurable via `--highlight-color` CSS variable (driven by settings).
- [ ] AC5: Browser compatibility: works on Chromium (Electron's renderer); Safari/Firefox out of scope.

---

### STORY-06.2: Word state classes (sung / active / upcoming)

**Type:** feature
**Effort:** S
**Module:** KR
**Depends on:** STORY-06.1
**FR/NFR refs:** FR2.4, FR2.5
**Architecture refs:** §4.9

**As a** congregation member
**I want** past words to dim, the active word to be bright, and upcoming words to be readable but subdued
**So that** I can see where we are at a glance.

**Acceptance Criteria:**
- [ ] AC1: `.word.sung`, `.word.active`, `.word.upcoming` classes applied based on `currentWordIndex`.
- [ ] AC2: Opacity controlled by settings (`sungWordOpacity`, etc.).
- [ ] AC3: Switching active word transitions over ~100ms (no abrupt jump).

---

### STORY-06.3: Line transitions with smooth scroll

**Type:** feature
**Effort:** M
**Module:** KR
**Depends on:** STORY-06.2
**FR/NFR refs:** FR2.7
**Architecture refs:** §4.9

**As a** congregation member
**I want** lines to scroll up smoothly when the active line changes, not jump
**So that** I can track context without visual disruption.

**Acceptance Criteria:**
- [ ] AC1: When `activeLineIndex` changes, lines shift up over 250ms.
- [ ] AC2: Prior line fades to ~30% opacity (settings-configurable).
- [ ] AC3: Uses Svelte's `transition:fly` directive (or equivalent).
- [ ] AC4: Animation is interruptible if another line change occurs.

---

### STORY-06.4: Held-note pulse animation

**Type:** feature
**Effort:** S
**Module:** KR
**Depends on:** STORY-06.2
**FR/NFR refs:** FR2.6
**Architecture refs:** §4.9

**As a** congregation member
**I want** sustained notes to pulse during their hold duration
**So that** I can match the held timing instead of guessing.

**Acceptance Criteria:**
- [ ] AC1: Words with `held: true` (set during STORY-05.5) get `.word.held` class.
- [ ] AC2: CSS keyframe animation pulses the word's brightness/scale at 1.2s period while `--progress` is between 0.2 and 0.95.
- [ ] AC3: Visual styling per settings (`heldNoteAnimation: 'pulse' | 'glow' | 'static'`).

---

### STORY-06.5: Next-section preview with configurable lead time

**Type:** feature
**Effort:** M
**Module:** KR, SE (event signal)
**Depends on:** STORY-06.3
**FR/NFR refs:** FR2.8
**Architecture refs:** §4.9

**As a** congregation member
**I want** the next section to fade in below the current section before the transition
**So that** I'm not surprised when we change sections.

**Acceptance Criteria:**
- [ ] AC1: When the cursor enters the last N seconds of a section (N = `leadTimeSeconds` from settings, default 2.0), an "approaching" event fires.
- [ ] AC2: KR fades the next section's first line into view at the bottom.
- [ ] AC3: At section change, the preview becomes the active line; the transition is the same smooth scroll as STORY-06.3.

---

### STORY-06.6: Resolution-adaptive sizing

**Type:** feature
**Effort:** M
**Module:** KR
**Depends on:** STORY-06.5
**FR/NFR refs:** FR2.11, NFR3.4
**Architecture refs:** §4.9

**As a** tech operator
**I want** the karaoke output to size text appropriately for the projector's resolution and aspect ratio
**So that** I don't have to manually configure font size per venue.

**Acceptance Criteria:**
- [ ] AC1: Uses `vmin`-based sizing with clamp() bounds derived from settings.
- [ ] AC2: 16:9 (1080p, 4K), 21:9 (ultrawide), 16:10 all render legibly without text wrapping mid-word.
- [ ] AC3: When a line exceeds container width, horizontal-pan layout kicks in (smooth scroll on overflow).
- [ ] AC4: Manual override available in settings if auto-sizing is wrong for a given venue.

---

### STORY-06.7: Parallel lyrics rendering (FR10 partial)

**Type:** feature
**Effort:** M
**Module:** KR
**Depends on:** STORY-06.5
**FR/NFR refs:** FR10.3, FR10.4, FR10.8
**Architecture refs:** §4.9

**As a** congregation member in a multilingual congregation
**I want** to see a secondary language below the primary lyrics, advancing section-by-section (no word highlight on the secondary)
**So that** I can follow along in my preferred language.

**Acceptance Criteria:**
- [ ] AC1: When `parallelLyrics` is set in `LoadMapPayload`, KR renders a second stacked container.
- [ ] AC2: Primary container has word-level highlight; secondary advances on section change only.
- [ ] AC3: Auto-sizing: 60% primary font size if 2 languages, 50% if 3.
- [ ] AC4: Settings toggle to enable/disable the secondary at runtime.

---

### STORY-06.8: Rendering performance test

**Type:** test
**Effort:** S
**Module:** KR
**Depends on:** STORY-06.6
**FR/NFR refs:** NFR1.3
**Architecture refs:** §4.9

**As a** developer
**I want** an automated test that runs the renderer with a high-cadence SyncFrame stream and verifies the frame rate stays ≥30fps
**So that** performance regressions are caught.

**Acceptance Criteria:**
- [ ] AC1: Playwright test launches the karaoke output, pushes 1000 SyncFrames at 60Hz, measures actual frame delivery rate.
- [ ] AC2: Asserts ≥30fps on the slowest CI runner.
- [ ] AC3: Asserts no JS errors during the run.

---

## EP-07: Audio Input & Beat Detection

**Goal:** Implement the AI (audio input capture) and BD (beat detection) modules per architecture §4.4 and §4.5. Wires up the audio capture chain that feeds the live sync.

**FR/NFR refs:** FR3.1, FR3.2, FR3.3, FR3.4, FR3.7, FR3.8, NFR1.2, NFR1.4, NFR2.4, NFR3.3.

**Architecture refs:** §4.4, §4.5, ADR-5.

### STORY-07.1: Device enumeration UI

**Type:** feature
**Effort:** S
**Module:** AI, WS
**Depends on:** STORY-01.5
**FR/NFR refs:** FR3.1
**Architecture refs:** §4.4

**As a** tech operator
**I want** a dropdown listing all available audio input devices
**So that** I can select my sound desk line-in.

**Acceptance Criteria:**
- [ ] AC1: Uses `navigator.mediaDevices.enumerateDevices()`.
- [ ] AC2: Renders human-readable labels (requires microphone permission — request flow handled).
- [ ] AC3: Currently selected device persists in settings.
- [ ] AC4: A "Test" button captures 2 seconds and shows a level meter.
- [ ] AC5: Works on macOS, Windows, Linux (PulseAudio/PipeWire).

---

### STORY-07.2: AudioContext + MediaStream capture chain

**Type:** feature
**Effort:** M
**Module:** AI
**Depends on:** STORY-07.1
**FR/NFR refs:** FR3.1, NFR1.2, NFR3.3
**Architecture refs:** §4.4

**As a** developer
**I want** an AudioInput module that captures from the selected device at 48 kHz and exposes the AudioNode for downstream consumers (BD, VAD, STT, rehearsal recording)
**So that** all live-audio consumers share one source.

**Acceptance Criteria:**
- [ ] AC1: Captures via `getUserMedia({ audio: { deviceId } })`.
- [ ] AC2: Creates an `AudioContext({ sampleRate: 48000 })`.
- [ ] AC3: Exposes `getSourceNode(): MediaStreamAudioSourceNode` and event hooks `onDeviceLost`, `onLevelUpdate`.
- [ ] AC4: Tear-down releases the MediaStream and closes the AudioContext.
- [ ] AC5: End-to-end latency (mic to first downstream node) ≤ 30ms — measured with a test signal.

---

### STORY-07.3: Device-disconnect handling

**Type:** feature
**Effort:** S
**Module:** AI
**Depends on:** STORY-07.2
**FR/NFR refs:** NFR2.4
**Architecture refs:** §4.4

**As a** tech operator
**I want** the system to detect when my mic is unplugged and switch to timer-based mode gracefully
**So that** the projection keeps working until I fix the audio.

**Acceptance Criteria:**
- [ ] AC1: `MediaStreamTrack.onended` triggers an `audioInputLost` event on the AudioInput module.
- [ ] AC2: Higher-level code (SE, EP-09) subscribes and degrades to timer-tier within 3 seconds.
- [ ] AC3: UI surfaces a clear message ("Audio input disconnected — switched to timer mode").

---

### STORY-07.4: Meyda integration for spectral features

**Type:** feature
**Effort:** S
**Module:** BD
**Depends on:** STORY-07.2
**FR/NFR refs:** FR3.2
**Architecture refs:** §4.5, ADR-5

**As a** developer
**I want** a Meyda analyzer producing `rms`, `energy`, `spectralCentroid`, `spectralFlux` features from the live AudioContext
**So that** BD has the inputs for onset detection.

**Acceptance Criteria:**
- [ ] AC1: `Meyda.createMeydaAnalyzer` wired up with features per architecture §4.5.
- [ ] AC2: Buffer size 512 samples @ 48kHz (~11ms windows).
- [ ] AC3: Exposes feature stream as a Svelte store + raw event callbacks.

---

### STORY-07.5: Onset detection and BPM estimation

**Type:** feature
**Effort:** M
**Module:** BD
**Depends on:** STORY-07.4
**FR/NFR refs:** FR3.3, NFR1.4
**Architecture refs:** §4.5

**As a** developer
**I want** real-time BPM estimation from the live audio
**So that** SE can scale word timestamps via tempo ratio.

**Acceptance Criteria:**
- [ ] AC1: Spectral flux peaks identified with adaptive threshold (running median × 1.5).
- [ ] AC2: Autocorrelation over last 8 seconds of inter-onset intervals → dominant period → BPM.
- [ ] AC3: Exponential moving average (α=0.2) on output to reduce jitter.
- [ ] AC4: Output exposed as `liveBPM` and `beatConfidence` (in [0,1]) stores.
- [ ] AC5: Beat-detection latency ≤200ms (measured with a 60-BPM click track).

---

### STORY-07.6: Tempo ratio computation with safety clamp

**Type:** feature
**Effort:** S
**Module:** BD
**Depends on:** STORY-07.5
**FR/NFR refs:** FR3.4
**Architecture refs:** §4.5

**As a** developer
**I want** `tempoRatio(liveBPM, referenceBPM)` clamped to [0.7, 1.4]
**So that** SE never applies an implausible scaling factor (e.g., from a doubled beat detection).

**Acceptance Criteria:**
- [ ] AC1: Function in `packages/core/sync/tempo.ts` per architecture §4.5.
- [ ] AC2: Returns 1.0 when either input is null/0.
- [ ] AC3: Returns 1.0 when raw ratio is outside [0.7, 1.4] (and logs a warning).
- [ ] AC4: Unit tests cover the clamp boundaries.

---

### STORY-07.7: Tempo accuracy field test harness

**Type:** test
**Effort:** M
**Module:** BD
**Depends on:** STORY-07.6
**FR/NFR refs:** NFR1.4
**Architecture refs:** §4.5

**As a** developer
**I want** a test harness that plays a metronome at a known BPM into the audio pipeline (via loopback or a virtual audio cable) and asserts BD detects it within tolerance
**So that** tempo accuracy is provably acceptable before MVP ship.

**Acceptance Criteria:**
- [ ] AC1: Test pipeline: a known-tempo audio clip → loopback device → AudioInput → BD → assert detected BPM matches within ±2 BPM.
- [ ] AC2: Tests at 60, 80, 100, 120, 140 BPM.
- [ ] AC3: Runs locally; not required in CI (loopback setup is platform-specific).

---

## EP-08: VAD & STT Position Correction

**Goal:** Implement the VAD (voice activity detection) and ST (speech-to-text position correction) modules per architecture §4.6 and §4.7. These provide the "leader paused / leader jumped to a different section" intelligence.

**FR/NFR refs:** FR3.9, FR3.10, FR4.1–FR4.7, NFR1.5, NFR4.1.

**Architecture refs:** §4.6, §4.7, ADR-3, ADR-8.

### STORY-08.1: Energy-based VAD with Schmitt-trigger hysteresis

**Type:** feature
**Effort:** S
**Module:** VAD
**Depends on:** STORY-07.4
**FR/NFR refs:** FR3.9, FR3.10
**Architecture refs:** §4.6

**As a** congregation member
**I want** the display to hold steady when the worship leader pauses to pray, and resume when singing starts again
**So that** the slides don't advance during a quiet moment.

**Acceptance Criteria:**
- [ ] AC1: VAD module consumes `rms` from Meyda.
- [ ] AC2: Two-threshold Schmitt trigger: enter `active` when RMS > `enterThreshold` for ≥300ms; exit to `silent` when RMS < `exitThreshold` for ≥1500ms (all configurable).
- [ ] AC3: Exposes `vadState` Svelte store with values `'active' | 'silent'`.
- [ ] AC4: Default thresholds calibrated for typical sound-desk levels; documented as overridable.

---

### STORY-08.2: Whisper.cpp native addon integration

**Type:** infrastructure
**Effort:** L
**Module:** ST
**Depends on:** STORY-07.2
**FR/NFR refs:** FR4.1, NFR4.1
**Architecture refs:** §4.7, ADR-3

**As a** developer
**I want** a working Whisper.cpp via Node native addon per ADR-3
**So that** the live STT path is real and offline.

**Acceptance Criteria:**
- [ ] AC1: Add `@nicoder/whisper.node` (or current best-of-breed binding) to package.json.
- [ ] AC2: `npm run rebuild` produces working native binaries for all five platform/arch targets.
- [ ] AC3: A unit test loads the `base.en` model and transcribes a 3-second test WAV; expected text recovered with ≥80% Levenshtein similarity.
- [ ] AC4: Model file (~75 MB) downloaded on first use, cached per architecture §12.5.

---

### STORY-08.3: Rolling-window STT streaming

**Type:** feature
**Effort:** M
**Module:** ST
**Depends on:** STORY-08.2
**FR/NFR refs:** FR4.1, NFR1.5
**Architecture refs:** §4.7

**As a** developer
**I want** the live audio to be transcribed in 5-second rolling windows every 2 seconds
**So that** ST keeps up with the live performance.

**Acceptance Criteria:**
- [ ] AC1: AudioWorkletNode downsamples to 16 kHz mono float32 (Whisper.cpp's expected format).
- [ ] AC2: A ring buffer holds 5 seconds.
- [ ] AC3: Every 2 seconds, the buffer is passed to Whisper.cpp's `transcribe()` in a worker thread.
- [ ] AC4: Per-window processing time documented per platform; ≤800ms on a 4-core M1.
- [ ] AC5: Backpressure: if a window can't be processed before the next is due, drop the oldest pending (never queue indefinitely).

---

### STORY-08.4: Phrase matcher with 3-word window

**Type:** feature
**Effort:** M
**Module:** ST
**Depends on:** STORY-08.3
**FR/NFR refs:** FR4.2, FR4.3, FR4.5, FR4.6
**Architecture refs:** §4.7, ADR-8

**As a** developer
**I want** recognized text matched against the song's lyrics index using a 3-word window with fuzzy per-word matching
**So that** the system detects when the leader has jumped sections.

**Acceptance Criteria:**
- [ ] AC1: When a song is loaded, ST builds a phrase index: every 3-consecutive-word phrase in the lyrics → `(sectionId, slideIndex, charOffset)`.
- [ ] AC2: On each STT output, extract 3-word phrases and look them up.
- [ ] AC3: Match accepted only if ≥3 consecutive words match with per-word Levenshtein similarity ≥0.75.
- [ ] AC4: When a match is found at a section different from the current cursor, emit `correctPosition(toSlideIndex, toWordOffset)` event.
- [ ] AC5: For phrases appearing multiple times in the lyrics (e.g., chorus repeats), pick the smallest forward jump from the current cursor.
- [ ] AC6: Unit tests cover: exact match, fuzzy match within tolerance, no match, repeated-phrase tie-breaking.

---

### STORY-08.5: STT logging for post-service review

**Type:** feature
**Effort:** S
**Module:** ST
**Depends on:** STORY-08.4
**FR/NFR refs:** FR4.7
**Architecture refs:** §4.7

**As a** tech operator debugging sync issues
**I want** position corrections logged with timestamps, recognized text, and confidence
**So that** I can review what the system did after the service.

**Acceptance Criteria:**
- [ ] AC1: Each correction appended to `<userData>/lyricue/logs/positions-<date>.jsonl`.
- [ ] AC2: Log entry: `{ timestamp, recognized_text, from: {section, word}, to: {section, word}, confidence }`.
- [ ] AC3: Rolling retention: 30 days.

---

### STORY-08.6: STT enable/disable toggle

**Type:** feature
**Effort:** S
**Module:** ST, WS
**Depends on:** STORY-08.4
**FR/NFR refs:** FR4.1
**Architecture refs:** §4.7

**As a** tech operator
**I want** to disable STT entirely in settings
**So that** I can fall back to pure tempo-based sync if STT is producing too many false corrections.

**Acceptance Criteria:**
- [ ] AC1: `sttEnabled` setting in `LyriCueSettings.sync`.
- [ ] AC2: When disabled, ST module doesn't load the model and emits no events.
- [ ] AC3: SE handles no-STT gracefully (degrades position-correction capability, retains tempo sync).

---

## EP-09: Sync Engine Core

**Goal:** Implement the SE module per architecture §4.8. The heart of LyriCue — the requestAnimationFrame loop, cursor advance, tier transitions, position correction handling, song boundaries.

**FR/NFR refs:** FR3.5–FR3.11, FR5.1–FR5.9, FR7.3, FR7.4, NFR1.3, NFR1.6.

**Architecture refs:** §4.8, ADR-6.

### STORY-09.1: SyncEngine state model + state machine

**Type:** feature
**Effort:** M
**Module:** SE
**Depends on:** STORY-07.6, STORY-08.4
**FR/NFR refs:** FR5.4
**Architecture refs:** §4.8

**As a** developer
**I want** the `SyncEngineState` interface (per architecture §4.8) and the state-machine transitions formalized
**So that** the rAF loop has a well-defined state to operate on.

**Acceptance Criteria:**
- [ ] AC1: TS interface and Svelte stores for all state fields per architecture §4.8.
- [ ] AC2: State-machine module with explicit transitions: `Auto → Timer`, `Timer → Manual`, `* → previous tier`, song-boundary transitions.
- [ ] AC3: Each transition is a pure function: `(state, event) → state'`.
- [ ] AC4: Unit tests cover every transition.

---

### STORY-09.2: requestAnimationFrame tick loop

**Type:** feature
**Effort:** M
**Module:** SE
**Depends on:** STORY-09.1, STORY-02.4
**FR/NFR refs:** NFR1.3, NFR1.6
**Architecture refs:** §4.8, ADR-6

**As a** congregation member
**I want** the cursor to advance smoothly per the song's tempo
**So that** word highlighting tracks reality.

**Acceptance Criteria:**
- [ ] AC1: `tick(now)` function per architecture §4.8 runs on `requestAnimationFrame`.
- [ ] AC2: Computes `deltaRefMs = wallElapsed * tempoRatio` and advances `cursorRefTime`.
- [ ] AC3: Calls `lookupWord(cursorRefTime, activeTimingMap)` and updates store state.
- [ ] AC4: Pauses on `vadState === 'silent'`.
- [ ] AC5: Pauses on `tier === 'manual'`.
- [ ] AC6: Frame budget: tick body runs in <2ms on a 4-core M1.

---

### STORY-09.3: lookupWord function

**Type:** feature
**Effort:** S
**Module:** SE
**Depends on:** STORY-09.1
**FR/NFR refs:** FR2 (supporting)
**Architecture refs:** §4.8

**As a** developer
**I want** an efficient lookup from `cursorRefTime` to `(slideIndex, wordIndex, wordProgress)`
**So that** the rAF tick can call it 60 times per second without breaking the frame budget.

**Acceptance Criteria:**
- [ ] AC1: Binary-search through sections, linear within section (or precomputed index for very long songs).
- [ ] AC2: Returns `wordProgress` in [0,1] for the word the cursor is currently inside.
- [ ] AC3: Handles edge cases: cursor before song start (return null), cursor after song end (return last word with progress=1).
- [ ] AC4: Microbenchmark: <50µs per lookup on a 5-minute song.

---

### STORY-09.4: Tier transition logic

**Type:** feature
**Effort:** M
**Module:** SE
**Depends on:** STORY-09.2
**FR/NFR refs:** FR5.4, FR5.5, FR5.6, FR5.8
**Architecture refs:** §4.8

**As a** congregation member
**I want** the system to gracefully degrade to timer-based or manual mode when AI sync becomes unreliable
**So that** the slides never stop working.

**Acceptance Criteria:**
- [ ] AC1: `Auto → Timer` when `beatConfidence < 0.4` for >10 seconds (configurable).
- [ ] AC2: `Auto → Timer` on `audioInputLost` event (immediate).
- [ ] AC3: `Timer → Manual` when cursor drift from expected position exceeds threshold (TBD — operator can also force this).
- [ ] AC4: Operator can force any tier via keyboard or UI; force takes precedence over auto-degradation.
- [ ] AC5: Re-engagement: from Manual or Timer, operator can re-engage Auto, which re-establishes the song start anchor.
- [ ] AC6: Each transition published to `tier` store; UI in EP-10 displays it.

---

### STORY-09.5: Manual override handlers (next/prev section, manual mode)

**Type:** feature
**Effort:** S
**Module:** SE
**Depends on:** STORY-09.4
**FR/NFR refs:** FR5.1, FR5.3, NFR1.6
**Architecture refs:** §4.8

**As a** tech operator
**I want** keyboard shortcuts to advance/reverse sections, toggle manual mode, and re-engage sync
**So that** I can correct sync issues during a service.

**Acceptance Criteria:**
- [ ] AC1: `onNextSection()`, `onPrevSection()`, `onToggleManual()`, `onReEngageSync()` SE methods.
- [ ] AC2: Each completes its state change within 50ms (well under NFR1.6's 200ms).
- [ ] AC3: After manual intervention, position-correction events from ST are suppressed for `manualOverrideDebounceSeconds` (default 3s).

---

### STORY-09.6: Position correction animation

**Type:** feature
**Effort:** S
**Module:** SE
**Depends on:** STORY-08.4, STORY-09.5
**FR/NFR refs:** FR4.3, FR4.4
**Architecture refs:** §4.8

**As a** congregation member
**I want** position corrections to animate smoothly instead of jumping abruptly
**So that** unexpected resyncs don't look like glitches.

**Acceptance Criteria:**
- [ ] AC1: When a `correctPosition` event arrives, animate `cursorRefTime` from current to target over 300ms.
- [ ] AC2: Animation can be interrupted by another correction (snap to the new target and re-animate).
- [ ] AC3: During animation, normal tick loop continues — cursorRefTime advancement combines with the animation delta.

---

### STORY-09.7: Song boundary handling (auto-advance to next song)

**Type:** feature
**Effort:** M
**Module:** SE
**Depends on:** STORY-09.2
**FR/NFR refs:** FR3.11, FR7.3, FR7.4
**Architecture refs:** §4.8, §5.3

**As a** tech operator running a multi-song service
**I want** the system to detect when a song ends and load the next song in a "waiting for start" state
**So that** I don't have to manually click between every song.

**Acceptance Criteria:**
- [ ] AC1: When `cursorRefTime > activeTimingMap.totalDuration`, emit `songComplete` event.
- [ ] AC2: SE transitions to `waitingForStart` state — cursor frozen at song start, display shows first section, no advancement.
- [ ] AC3: VAD active in `waitingForStart` → `startSync()` engages the new song.
- [ ] AC4: Operator can also manually engage via the start-sync shortcut.
- [ ] AC5: Songs in the setlist without timing maps trigger fallback: SE.tier = 'manual', KR yields back to host renderer.

---

### STORY-09.8: End-to-end sync engine integration test

**Type:** test
**Effort:** M
**Module:** SE
**Depends on:** STORY-09.7
**FR/NFR refs:** NFR2.2, NFR2.3
**Architecture refs:** §4.8

**As a** developer
**I want** a deterministic test that runs a synthetic timing map through SE with synthetic audio and asserts cursor position is accurate at each tick
**So that** SE correctness is provable.

**Acceptance Criteria:**
- [ ] AC1: Test fixture: a 30-second synthetic timing map with 60 words.
- [ ] AC2: A `MockAudioInput` injects a constant 120 BPM beat pattern.
- [ ] AC3: After 30 seconds of simulated time, cursor is at the last word ±100ms.
- [ ] AC4: Position correction event injected mid-song → cursor jumps to target within 300ms ±50ms.
- [ ] AC5: VAD silent event → cursor freezes; VAD active resumes within 100ms.

---

## EP-10: Operator UI & Manual Override

**Goal:** Implement the operator-facing UI per architecture §4.10 — Setlist Panel, Mode Indicator, Settings tab subsections, keyboard shortcut routing, three-tier fallback UX.

**FR/NFR refs:** FR5.1–FR5.9, FR7.1, FR7.2, FR7.7, FR7.8, NFR5.2, NFR5.3.

**Architecture refs:** §4.10, §7.6.

### STORY-10.1: ModeIndicator badge component

**Type:** feature
**Effort:** S
**Module:** WS
**Depends on:** STORY-09.4
**FR/NFR refs:** FR5.7
**Architecture refs:** §4.10

**As a** tech operator
**I want** to always see which tier is active (Auto / Timer / Manual) with a color-coded badge
**So that** I'm never confused about what mode the system is in.

**Acceptance Criteria:**
- [ ] AC1: Top-right badge: "AUTO ●" green / "TIMER ●" yellow / "MANUAL ●" red.
- [ ] AC2: Click the badge to expand a popup showing the most recent tier-change reason ("Beat confidence dropped — switched to timer").
- [ ] AC3: Visible on the main app screen at all times during sync.

---

### STORY-10.2: SetlistPanel component (per architecture §4.10 sketch)

**Type:** feature
**Effort:** L
**Module:** WS
**Depends on:** STORY-09.7, STORY-10.1
**FR/NFR refs:** FR7.1, FR7.2, FR7.7, FR7.8, NFR5.2
**Architecture refs:** §4.10

**As a** tech operator
**I want** a single panel showing the setlist, audio device, mode, and start-sync button per the §4.10 design
**So that** I can run the entire service from one screen.

**Acceptance Criteria:**
- [ ] AC1: Layout matches the ASCII sketch in architecture §4.10 (Project title, mode badge, audio device picker, Start Sync button, song list with sync status icons, "Next up" label).
- [ ] AC2: ≤3 clicks to start sync (pick device, pick song, click Start Sync) — measured.
- [ ] AC3: Per-song icons: green ✓ if learned, yellow ⚠ if partial, gray — if not learned.
- [ ] AC4: Click any song in the list to jump to it (uses SE.jumpToSong()).
- [ ] AC5: Updates in real time as SE state changes.

---

### STORY-10.3: Keyboard shortcut routing

**Type:** feature
**Effort:** M
**Module:** WS
**Depends on:** STORY-09.5
**FR/NFR refs:** FR5.1, FR5.2, NFR1.6
**Architecture refs:** §7.6

**As a** tech operator
**I want** my configured keyboard shortcuts to drive SE during active sync
**So that** I can keep my eyes on the worship leader, not the screen.

**Acceptance Criteria:**
- [ ] AC1: Default shortcuts per architecture §6.5 settings: Space=start, →=next, ←=prev, Esc=manual, Enter=re-engage.
- [ ] AC2: Shortcuts configurable in Settings.
- [ ] AC3: When `syncActive === true`, SE.handleSyncShortcut() intercepts before FreeShow's existing shortcuts (per architecture §7.6 sleeve-guard pattern in fork mode).
- [ ] AC4: When `syncActive === false`, all FreeShow shortcuts work normally.
- [ ] AC5: Conflicts detected at setting-save time (e.g., trying to bind Space to two actions).

---

### STORY-10.4: Settings Display subsection

**Type:** feature
**Effort:** M
**Module:** WS
**Depends on:** STORY-01.6
**FR/NFR refs:** FR4.1–FR4.6
**Architecture refs:** §4.10

**As a** tech operator
**I want** to configure display mode, lead time, highlight color, animation type, font, and held-note behavior
**So that** the karaoke output looks right for my venue.

**Acceptance Criteria:**
- [ ] AC1: All `LyriCueSettings.display` fields exposed as controls.
- [ ] AC2: Color picker for `highlightColor`, `sungColor`, `upcomingColor` with palette + custom hex.
- [ ] AC3: Slider for `leadTimeSeconds` 0–5 in 0.5 increments.
- [ ] AC4: Dropdown for `animationType` and `heldNoteAnimation`.
- [ ] AC5: Live preview pane shows the effect of each change against test lyrics.

---

### STORY-10.5: Settings Sync subsection

**Type:** feature
**Effort:** S
**Module:** WS
**Depends on:** STORY-10.4
**FR/NFR refs:** FR3.1, FR4 (entire)
**Architecture refs:** §4.10

**As a** tech operator
**I want** to configure audio device, STT enable/disable, tempo smoothing, position-correction sensitivity
**So that** I can tune the sync engine.

**Acceptance Criteria:**
- [ ] AC1: All `LyriCueSettings.sync` fields exposed.
- [ ] AC2: Sensible defaults; "Reset" button restores them.
- [ ] AC3: STT toggle takes effect immediately (engages/disengages ST module).

---

### STORY-10.6: Settings Shortcuts subsection

**Type:** feature
**Effort:** S
**Module:** WS
**Depends on:** STORY-10.3, STORY-10.4
**FR/NFR refs:** FR5.2
**Architecture refs:** §4.10

**As a** tech operator
**I want** to rebind keyboard shortcuts
**So that** I can match my muscle memory or avoid conflicts.

**Acceptance Criteria:**
- [ ] AC1: Each shortcut shows current binding + a "Click to rebind" button.
- [ ] AC2: Conflict detection: warn if a new binding conflicts with another LyriCue shortcut.

---

### STORY-10.7: Three-tier fallback UX polish

**Type:** feature
**Effort:** M
**Module:** WS, SE
**Depends on:** STORY-10.1, STORY-09.4
**FR/NFR refs:** FR5.4, FR5.5, FR5.6, FR5.7, FR5.8
**Architecture refs:** §4.10

**As a** congregation member
**I want** the projector to always show valid lyrics, even when AI sync fails
**So that** the service flows without disruption.

**Acceptance Criteria:**
- [ ] AC1: When tier changes, KR continues rendering uninterrupted — no flicker, no blank slide.
- [ ] AC2: A small banner at the top of the operator's main screen explains tier changes for 5 seconds, then collapses to a hint icon.
- [ ] AC3: Operator can force any tier at any time via the mode badge (right-click → "Force Manual").

---

### STORY-10.8: First-launch usability test

**Type:** test
**Effort:** S
**Module:** WS
**Depends on:** STORY-10.2
**FR/NFR refs:** NFR5.2
**Architecture refs:** §4.10

**As a** product owner
**I want** to validate the ≤3-actions-to-start-sync target with a non-technical user
**So that** the operator UX claim in the PRD is real.

**Acceptance Criteria:**
- [ ] AC1: A scripted Playwright test simulates: pick device, click song, click Start Sync.
- [ ] AC2: Assertion: SE.tier becomes 'auto' within 5 seconds of the third click.
- [ ] AC3: Documented manual test plan: 2 non-technical users complete the same flow without help; record completion time.

---

## EP-11: Lyrics Sourcing & Show Creation

**Goal:** Implement the "Learn Song" wizard (LearnSongWizard) per architecture §4.10, including FreeShow lyric search integration, paste-with-auto-section-detection, and file import per FR6.

**FR/NFR refs:** FR6.1–FR6.7, FR1.6 (manual section adjustment), FR1.9 (timing preview).

**Architecture refs:** §4.10, §7.5.

### STORY-11.1: LearnSongWizard scaffold (step navigation)

**Type:** feature
**Effort:** M
**Module:** WS
**Depends on:** STORY-01.5
**FR/NFR refs:** FR1, FR6.6
**Architecture refs:** §4.10

**As a** tech operator
**I want** a 5-step wizard for learning a song: source lyrics → review sections → attach audio → progress → preview + adjust
**So that** I can learn a song without context switching.

**Acceptance Criteria:**
- [ ] AC1: 5-step modal with Back/Next/Skip nav.
- [ ] AC2: Validates each step before allowing Next.
- [ ] AC3: Cancellable at any step (with confirmation if user has entered data).
- [ ] AC4: Step state persists if the user closes the wizard mid-flow (resume offered).

---

### STORY-11.2: Step 1 — Lyric search via FreeShow

**Type:** feature
**Effort:** M
**Module:** WS
**Depends on:** STORY-11.1
**FR/NFR refs:** FR6.1
**Architecture refs:** §7.5

**As a** tech operator
**I want** to search for song lyrics online via FreeShow's existing search
**So that** I don't have to find lyrics elsewhere and paste them.

**Acceptance Criteria:**
- [ ] AC1: In fork mode: call FreeShow's `SEARCH_LYRICS` IPC.
- [ ] AC2: In sister mode: call FreeShow's REST API for the same.
- [ ] AC3: Results listed; user picks one; lyrics are loaded into the wizard's text area.

---

### STORY-11.3: Step 1 — Paste-with-auto-section-detection

**Type:** feature
**Effort:** M
**Module:** WS
**Depends on:** STORY-11.1
**FR/NFR refs:** FR6.2, FR6.4
**Architecture refs:** §7.5

**As a** tech operator
**I want** to paste raw lyrics text and have sections auto-detected
**So that** WhatsApped lyrics become structured songs quickly.

**Acceptance Criteria:**
- [ ] AC1: Paste detects markers: `[Verse 1]`, `[Chorus]`, etc.; blank-line separators; numbered patterns ("1.", "Verse 1:").
- [ ] AC2: Detection runs in a pure function in `packages/core/lyrics/parseLyrics.ts`.
- [ ] AC3: Result displayed as a structured preview the user can edit.
- [ ] AC4: Unit tests cover common formats (CCLI dump, ChordPro, OpenSong export, plain text).

---

### STORY-11.4: Step 1 — File import (.txt, .docx, .pdf)

**Type:** feature
**Effort:** M
**Module:** WS
**Depends on:** STORY-11.3
**FR/NFR refs:** FR6.3
**Architecture refs:** §7.5

**As a** tech operator
**I want** to import lyrics from common file formats
**So that** I can use whatever the worship leader sent me.

**Acceptance Criteria:**
- [ ] AC1: File picker accepts `.txt`, `.docx`, `.pdf`, `.opensong`, `.xml` (OpenLyrics), `.chordpro`.
- [ ] AC2: Each format parsed to plain text; section detection runs from STORY-11.3.
- [ ] AC3: PDF and .docx parsing via existing libraries (`pdf-parse`, `mammoth`).

---

### STORY-11.5: Step 2 — Section review and editing

**Type:** feature
**Effort:** M
**Module:** WS
**Depends on:** STORY-11.3
**FR/NFR refs:** FR6.5, FR1.6
**Architecture refs:** §4.10

**As a** tech operator
**I want** to review detected sections and correct labels before learning
**So that** sections are correct before I commit the slow ML step.

**Acceptance Criteria:**
- [ ] AC1: Each section shows a label dropdown ("Verse 1", "Verse 2", "Chorus", "Pre-Chorus", "Bridge", "Tag", "Intro", "Outro", "Other") + free-text override.
- [ ] AC2: Sections can be reordered, merged, or split.
- [ ] AC3: Final structure passed to the next step.

---

### STORY-11.6: Step 3 — Audio attachment and learn trigger

**Type:** feature
**Effort:** M
**Module:** WS, SC
**Depends on:** STORY-11.5, STORY-05.5
**FR/NFR refs:** FR1, FR1.13
**Architecture refs:** §4.10, §5.1

**As a** tech operator
**I want** to attach an audio file and start the learning pipeline with live progress
**So that** the song gets a timing map.

**Acceptance Criteria:**
- [ ] AC1: File picker accepts MP3/WAV/FLAC/OGG ≤50MB.
- [ ] AC2: Clicking "Learn" calls `SC.request('learn_song', ...)` per architecture §5.1.
- [ ] AC3: Progress notifications update a progress bar with stage labels.
- [ ] AC4: On error, a plain-language error is shown (no stack traces); song saves in "manual mode" state.
- [ ] AC5: On success, transitions to Step 5 (preview).

---

### STORY-11.7: Step 5 — Timing preview with waveform + manual word adjustment

**Type:** feature
**Effort:** L
**Module:** WS
**Depends on:** STORY-11.6
**FR/NFR refs:** FR1.9, FR1.10
**Architecture refs:** §4.10

**As a** tech operator
**I want** to play back the reference audio with word-level highlighting overlay and drag word boundaries on a waveform
**So that** I can correct alignment errors before deploying.

**Acceptance Criteria:**
- [ ] AC1: Waveform rendered from the reference audio.
- [ ] AC2: Word boundaries overlaid as draggable markers.
- [ ] AC3: Play button plays the audio with karaoke highlighting synced.
- [ ] AC4: Dragging a marker updates the word's startMs/endMs.
- [ ] AC5: "Save" persists changes via TM; "Cancel" discards.

---

## EP-12: Setlist & Continuous Playback

**Goal:** Wire SE to FreeShow Projects (per architecture §7.4) and implement the setlist-aware behaviors per FR7 — auto-advance between songs, waiting-for-start state, non-learned items passthrough.

**FR/NFR refs:** FR7.1–FR7.9.

**Architecture refs:** §4.10, §7.4, §5.3.

### STORY-12.1: Project read adapter (fork mode + sister mode)

**Type:** feature
**Effort:** M
**Module:** WS
**Depends on:** STORY-02.4
**FR/NFR refs:** FR7.1
**Architecture refs:** §7.4

**As a** developer
**I want** a `ProjectAdapter` that reads the active FreeShow project regardless of deployment mode
**So that** higher-level setlist UI is mode-agnostic.

**Acceptance Criteria:**
- [ ] AC1: Fork mode: reads from FreeShow's `projects` store.
- [ ] AC2: Sister mode: reads via FreeShow's REST `/v1/projects` API.
- [ ] AC3: Same return shape in both modes: `Project` (per FreeShow's type).
- [ ] AC4: Observable: subscribers are notified when the active project changes.

---

### STORY-12.2: Setlist sync-status badges (per song)

**Type:** feature
**Effort:** S
**Module:** WS
**Depends on:** STORY-12.1, STORY-03.3
**FR/NFR refs:** FR7.2
**Architecture refs:** §4.10

**As a** tech operator viewing the setlist
**I want** each song to show whether it has a timing map (green ✓ / yellow ⚠ / gray —)
**So that** I know what's ready for auto-sync vs. manual.

**Acceptance Criteria:**
- [ ] AC1: Derived store: each `ProjectShowRef` mapped to TM.exists(showId).
- [ ] AC2: Updates when songs are learned or imported.

---

### STORY-12.3: Auto-advance between songs

**Type:** feature
**Effort:** M
**Module:** SE, WS
**Depends on:** STORY-09.7, STORY-12.1
**FR/NFR refs:** FR7.3, FR7.4, FR7.5
**Architecture refs:** §4.8, §5.3

**As a** tech operator
**I want** the next song to auto-load when the current song ends
**So that** I don't have to click between songs.

**Acceptance Criteria:**
- [ ] AC1: When SE emits `songComplete`, WS loads the next song's timing map.
- [ ] AC2: SE enters `waitingForStart`; KR shows first section of new song.
- [ ] AC3: VAD active → SE engages new song.
- [ ] AC4: Operator can manually trigger advance via shortcut.

---

### STORY-12.4: Non-learned items pass through to host renderer

**Type:** feature
**Effort:** S
**Module:** SE, KR
**Depends on:** STORY-12.3
**FR/NFR refs:** FR7.6
**Architecture refs:** §5.3

**As a** tech operator with mixed setlist items (songs + scripture readings)
**I want** non-learned items to use FreeShow's normal manual slide control
**So that** mixing media types Just Works.

**Acceptance Criteria:**
- [ ] AC1: When the next project item has no timing map, SE transitions to manual mode for that item.
- [ ] AC2: KR yields rendering back to FreeShow's standard Output (fork mode) or hides itself (sister mode).
- [ ] AC3: Returning to a learned song re-engages the karaoke output.

---

### STORY-12.5: Jump-to-song from setlist

**Type:** feature
**Effort:** S
**Module:** WS
**Depends on:** STORY-12.2
**FR/NFR refs:** FR7.7
**Architecture refs:** §4.10

**As a** tech operator
**I want** to click any song in the setlist and jump to it
**So that** I can respond to a setlist change mid-service.

**Acceptance Criteria:**
- [ ] AC1: Click → SE.jumpToSong(showId).
- [ ] AC2: Current song state cleanly torn down; new song's timing map loaded.
- [ ] AC3: Transitions through `waitingForStart` state for the new song.

---

### STORY-12.6: "Next up" indicator

**Type:** feature
**Effort:** S
**Module:** WS
**Depends on:** STORY-12.3
**FR/NFR refs:** FR7.8
**Architecture refs:** §4.10

**As a** congregation member
**I want** to know what's coming next during the final section of the current song
**So that** I'm not surprised by transitions.

**Acceptance Criteria:**
- [ ] AC1: When SE enters the final section of a song, the karaoke output shows a "Next: <title>" hint at the bottom.
- [ ] AC2: Hint hidden during normal song sections.

---

# Part III — Multi-Tenant Infrastructure

These four epics implement the multi-tenant deployment from architecture §8 — the library, the publish/download flows, the central-vs-local model, and the hosting setup.

---

## EP-13: Library Manager (LM)

**Goal:** Implement the LM module per architecture §4.11. Catalog operations, bundle download/import/export, signature verification, provenance tracking.

**FR/NFR refs:** FR11.1–FR11.9, MC-NFR2, MC-NFR4, MC-NFR8.

**Architecture refs:** §4.11, §5.4, §5.5, §6.4.

### STORY-13.1: Catalog fetch + diff

**Type:** feature
**Effort:** M
**Module:** LM
**Depends on:** STORY-01.4
**FR/NFR refs:** FR11.3
**Architecture refs:** §4.11, §5.4

**As a** tech operator
**I want** to click "Check Library" and see what's new
**So that** I can pull updates on my schedule.

**Acceptance Criteria:**
- [ ] AC1: `LM.fetchCatalog(libraryUrl)` performs HTTPS GET against `<libraryUrl>/catalog.json`.
- [ ] AC2: Falls back to mirror URL if primary fails (network error or 5xx).
- [ ] AC3: `LM.diffCatalog(remote, local)` returns `{ added[], updated[], removed[] }`.
- [ ] AC4: Diff is based on `songId + bundleVersion`.
- [ ] AC5: Manual-trigger only — no background polling.

---

### STORY-13.2: Bundle download with progress

**Type:** feature
**Effort:** M
**Module:** LM
**Depends on:** STORY-13.1
**FR/NFR refs:** FR11.4, MC-NFR8
**Architecture refs:** §4.11

**As a** tech operator
**I want** selected bundles to download with progress feedback and integrity verification
**So that** I trust the imported data.

**Acceptance Criteria:**
- [ ] AC1: HTTPS GET to bundle URL; SHA256 computed during download.
- [ ] AC2: Mismatch with catalog's SHA256 → reject; do not import.
- [ ] AC3: Progress notifications via IPC to renderer.
- [ ] AC4: Parallel downloads supported with a configurable concurrency limit (default 3).

---

### STORY-13.3: Bundle import (unpacks + creates show + saves timing map)

**Type:** feature
**Effort:** L
**Module:** LM, TM
**Depends on:** STORY-13.2, STORY-03.3
**FR/NFR refs:** FR11.4, FR11.5
**Architecture refs:** §4.11, §5.4

**As a** tech operator
**I want** imported bundles to create a usable show in FreeShow's library plus a timing map in mine
**So that** the song is immediately playable.

**Acceptance Criteria:**
- [ ] AC1: Unzip bundle; validate manifest schema.
- [ ] AC2: If show with same `songId` doesn't exist locally: create new FreeShow show from `show.json`.
- [ ] AC3: If show exists: prompt operator — Replace, Merge (additive), Skip.
- [ ] AC4: Save timing map via TM.save() with provenance = `imported`.
- [ ] AC5: Save arrangements via TM.saveArrangements().
- [ ] AC6: Log import to audit trail.

---

### STORY-13.4: Bundle export (.wstiming → renamed .lcbundle?)

**Type:** feature
**Effort:** M
**Module:** LM, TM
**Depends on:** STORY-03.3
**FR/NFR refs:** FR11.1, FR11.8
**Architecture refs:** §4.11

**As a** tech operator
**I want** to export a learned song as a .lcbundle file
**So that** I can share it via email/WhatsApp/USB.

**Acceptance Criteria:**
- [ ] AC1: `LM.exportBundle(showId, options)` assembles ZIP per architecture §4.11.
- [ ] AC2: Includes manifest, timing.json, show.json, arrangements (if any).
- [ ] AC3: Excludes reference audio.
- [ ] AC4: Manifest SHA256 computed; signature applied if signing enabled.
- [ ] AC5: File extension `.lcbundle` (rebranded from `.wstiming` for consistency; both extensions recognized on import for backwards compatibility).

---

### STORY-13.5: Signature verification (Ed25519)

**Type:** feature
**Effort:** M
**Module:** LM
**Depends on:** STORY-13.3
**FR/NFR refs:** MC-NFR8
**Architecture refs:** §4.11, ADR-13

**As a** tech operator at a campus that trusts the central team
**I want** imported bundles to be verified against the central team's signing key
**So that** I'm not vulnerable to a tampered bundle.

**Acceptance Criteria:**
- [ ] AC1: Verify Ed25519 signature against the configured trust list.
- [ ] AC2: Unsigned bundle: warn the operator ("This bundle is not signed — import anyway?").
- [ ] AC3: Signed with unknown key: warn ("Signed by an unrecognized key — import anyway?").
- [ ] AC4: Signed with known key + tampered content (SHA256 mismatch): reject.
- [ ] AC5: All decisions logged.

---

### STORY-13.6: Publish bundle to library

**Type:** feature
**Effort:** L
**Module:** LM, WS
**Depends on:** STORY-13.4
**FR/NFR refs:** FR11.6, FR11.7
**Architecture refs:** §4.11, §5.5

**As a** central team member with credentials
**I want** to publish a learned song to the shared library
**So that** all campuses can download it.

**Acceptance Criteria:**
- [ ] AC1: `LM.publishBundle(bundle, credential)` HTTPS PUT to the publish Worker.
- [ ] AC2: Credential read from OS keychain via Electron `safeStorage`.
- [ ] AC3: Headers per architecture §5.5: `X-LC-Org`, `X-LC-Campus`, `X-LC-Credential`, `X-LC-Target`.
- [ ] AC4: Worker responds with new catalog URL; LM refreshes local catalog cache.
- [ ] AC5: Errors surfaced clearly: bad credential, file too large, server error.

---

### STORY-13.7: Provenance tracking + UI badges

**Type:** feature
**Effort:** S
**Module:** LM, TM, WS
**Depends on:** STORY-13.3
**FR/NFR refs:** FR11.5
**Architecture refs:** §4.11

**As a** tech operator
**I want** imported songs to show a badge ("Imported from library")
**So that** I know which songs are local vs. central.

**Acceptance Criteria:**
- [ ] AC1: ProvenanceRecord stored per timing map (see architecture §4.11).
- [ ] AC2: UI badge in SetlistPanel + LearnSongWizard.
- [ ] AC3: "Update available" indicator when catalog has a newer version.

---

### STORY-13.8: Fork imported song to local

**Type:** feature
**Effort:** S
**Module:** LM, TM
**Depends on:** STORY-13.7
**FR/NFR refs:** FR11.5
**Architecture refs:** §4.11

**As a** tech operator who wants to customize an imported song
**I want** to "Fork" it to a local copy that won't get overwritten by central updates
**So that** my local changes survive central re-publishes.

**Acceptance Criteria:**
- [ ] AC1: "Fork" action copies the show + timing map to new IDs.
- [ ] AC2: New copy has `provenance.source = 'local'`.
- [ ] AC3: Original copy retains imported provenance.

---

### STORY-13.9: LM end-to-end test (download → import → use)

**Type:** test
**Effort:** M
**Module:** LM
**Depends on:** STORY-13.7
**FR/NFR refs:** FR11
**Architecture refs:** §5.4

**As a** developer
**I want** an integration test that downloads a bundle from a stub catalog, imports it, and verifies SE can engage it
**So that** the full library path is verified.

**Acceptance Criteria:**
- [ ] AC1: Test sets up a local HTTP server serving a fixture catalog + bundle.
- [ ] AC2: Test runs the full flow: fetchCatalog → diff → downloadBundle → importBundle → assert TM.exists(showId) === true.
- [ ] AC3: Assert SE can load the imported timing map and emit at least one SyncFrame.

---

## EP-14: Library Hosting Setup

**Goal:** Stand up the Cloudflare R2 + Worker + GitHub mirror infrastructure per architecture §8.2 and §8.7. Includes the one-time setup script for an organization.

**FR/NFR refs:** FR11.7, MC-NFR2, MC-NFR3, MC-NFR7.

**Architecture refs:** §8.2, §8.3, §8.7, §8.8, ADR-11.

### STORY-14.1: publish-worker Cloudflare Worker

**Type:** infrastructure
**Effort:** L
**Module:** Library infra
**Depends on:** none
**FR/NFR refs:** MC-NFR2
**Architecture refs:** §8.2

**As a** library administrator
**I want** a Cloudflare Worker that validates credentials, writes bundles to R2, regenerates the catalog, and optionally mirrors to GitHub
**So that** publish writes are credentialed without exposing R2 IAM keys to client apps.

**Acceptance Criteria:**
- [ ] AC1: Worker source in `infra/publish-worker/` with `wrangler.toml`.
- [ ] AC2: PUT `/publish` endpoint: validates `X-LC-Credential` against a configurable credential list, writes to R2 at the appropriate path, returns `{ ok: true, songId, bundleUrl, catalogVersion }`.
- [ ] AC3: Per-credential rate limit (default 60 writes/hour).
- [ ] AC4: After write, regenerates `catalog.json` from R2 bucket contents.
- [ ] AC5: Append to `meta/publish-log.jsonl` (audit trail).
- [ ] AC6: ~200 LOC of TypeScript max.

---

### STORY-14.2: R2 bucket layout + IAM setup script

**Type:** infrastructure
**Effort:** M
**Module:** Library infra
**Depends on:** STORY-14.1
**FR/NFR refs:** MC-NFR3
**Architecture refs:** §8.3

**As a** library administrator
**I want** an idempotent script that creates the R2 bucket, sets the public-read policy on songs/, deploys the Worker, and prints the library URL
**So that** organization setup is one command.

**Acceptance Criteria:**
- [ ] AC1: `npx @lyricue/setup-library` (or similar) prompts for Cloudflare credentials.
- [ ] AC2: Creates R2 bucket, sets policy, deploys Worker per architecture §8.3 layout.
- [ ] AC3: Generates an initial central credential and prints it.
- [ ] AC4: Idempotent: re-running detects existing resources and updates them.
- [ ] AC5: Includes a `--dry-run` flag.

---

### STORY-14.3: GitHub mirror integration

**Type:** infrastructure
**Effort:** M
**Module:** Library infra
**Depends on:** STORY-14.1
**FR/NFR refs:** MC-NFR7
**Architecture refs:** §8.7

**As a** library administrator
**I want** an option in the Worker to mirror successful R2 writes to a GitHub repo
**So that** there's a second source of truth.

**Acceptance Criteria:**
- [ ] AC1: Worker config option `mirror.github = { repo, token }`.
- [ ] AC2: After R2 write, makes a GitHub API call to commit the bundle file.
- [ ] AC3: Commit message format: `publish(<songId>): version <version> by <campus>`.
- [ ] AC4: Mirror failure logs a warning but does not fail the publish call (R2 is authoritative).

---

### STORY-14.4: Catalog generator + signing key management

**Type:** infrastructure
**Effort:** M
**Module:** Library infra
**Depends on:** STORY-14.2
**FR/NFR refs:** MC-NFR8
**Architecture refs:** §8.3

**As a** library administrator
**I want** an admin tool to generate Ed25519 signing keypairs and publish the public key to the library
**So that** signed bundles work end-to-end.

**Acceptance Criteria:**
- [ ] AC1: `npx @lyricue/admin generate-signing-key` produces a keypair and stores it in the admin's keychain.
- [ ] AC2: Public key uploaded to `<libraryUrl>/trust.json`.
- [ ] AC3: Key rotation: a "new key" supplements the trust list; old key remains trusted during transition.

---

### STORY-14.5: Setup wizard documentation

**Type:** docs
**Effort:** S
**Module:** Library infra
**Depends on:** STORY-14.2
**FR/NFR refs:** MC-NFR3
**Architecture refs:** §8.8

**As a** new organization administrator
**I want** a walkthrough doc that gets me from "I have nothing" to "the library is live"
**So that** I can self-serve.

**Acceptance Criteria:**
- [ ] AC1: Markdown doc in `docs/library-setup.md` with step-by-step instructions.
- [ ] AC2: Includes screenshots of Cloudflare dashboard.
- [ ] AC3: Estimated time-to-complete: ≤15 minutes.

---

### STORY-14.6: Disaster recovery test

**Type:** test
**Effort:** S
**Module:** Library infra
**Depends on:** STORY-14.3
**FR/NFR refs:** MC-NFR7
**Architecture refs:** §8.7

**As a** library administrator
**I want** evidence that the GitHub mirror is usable when R2 is unreachable
**So that** I can trust the dual-source claim.

**Acceptance Criteria:**
- [ ] AC1: A test simulates R2 outage by pointing `primaryUrl` to a nonexistent host.
- [ ] AC2: Client falls back to mirror URL; download succeeds.
- [ ] AC3: UI shows the "used backup mirror" hint.

---

## EP-15: Multi-Tenant Identity & Publishing

**Goal:** Wire the first-run wizard's identity flow (§8.4), credential storage, publishing UI, and identity management settings.

**FR/NFR refs:** FR11.6, FR11.7, MC-NFR1, MC-NFR6.

**Architecture refs:** §6.3, §8.4.

### STORY-15.1: Identity persistence + retrieval

**Type:** feature
**Effort:** S
**Module:** WS
**Depends on:** STORY-01.4
**FR/NFR refs:** MC-NFR6
**Architecture refs:** §6.3

**As a** developer
**I want** `IdentityStore` per architecture §6.3 fully functional
**So that** other modules know which org/campus/user is running.

**Acceptance Criteria:**
- [ ] AC1: Identity types and store per §6.3.
- [ ] AC2: Defaults to `{ org: 'local', campus: 'default', user: { isAnonymous: true } }` if nothing is configured.
- [ ] AC3: Updates from wizard or Settings → Identity persist immediately.

---

### STORY-15.2: First-run wizard identity step (full implementation)

**Type:** feature
**Effort:** M
**Module:** WS
**Depends on:** STORY-01.5, STORY-15.1, STORY-13.1
**FR/NFR refs:** MC-NFR1
**Architecture refs:** §8.4

**As a** new user
**I want** the wizard to auto-fill organization info from the library URL and let me pick a campus
**So that** I don't have to type the same data twice.

**Acceptance Criteria:**
- [ ] AC1: If library URL provided, wizard fetches catalog and pre-fills `org.name`.
- [ ] AC2: Campus dropdown populated from catalog's `campuses[]` (if present) + "Create new campus..." option.
- [ ] AC3: Anonymous toggle: skips user-name entry; sets `user.isAnonymous = true`.
- [ ] AC4: Saves to IdentityStore on completion.

---

### STORY-15.3: Publish credential setup + secure storage

**Type:** feature
**Effort:** M
**Module:** WS
**Depends on:** STORY-15.2
**FR/NFR refs:** FR11.6
**Architecture refs:** §6.4, §8.4

**As a** central team member
**I want** to paste my publish credential during setup and have it stored securely
**So that** I can publish bundles without re-entering credentials each time.

**Acceptance Criteria:**
- [ ] AC1: Wizard step 4 has a credential input + "Test" button.
- [ ] AC2: Test makes a `GET /publish/whoami` call to the Worker (a stub endpoint that validates the credential).
- [ ] AC3: On success, credential stored via Electron `safeStorage`; only the `keyId` is stored as plaintext.
- [ ] AC4: Settings → Library → "Manage Credential" allows update/delete.

---

### STORY-15.4: Library Publish dialog

**Type:** feature
**Effort:** M
**Module:** WS, LM
**Depends on:** STORY-13.6, STORY-15.3
**FR/NFR refs:** FR11.1, FR11.6
**Architecture refs:** §4.11, §5.5

**As a** central team member
**I want** a "Publish to Library" dialog with metadata fields (tags, attribution, target central/campus)
**So that** my publish is properly tagged.

**Acceptance Criteria:**
- [ ] AC1: Dialog: title, tags (multi-select), attribution (free text), target (radio: central / campus), anonymous toggle.
- [ ] AC2: "Publish" button disabled if no credential is configured for the chosen target.
- [ ] AC3: After publish, shows the library URL + confirmation.

---

### STORY-15.5: Library Browser

**Type:** feature
**Effort:** L
**Module:** WS
**Depends on:** STORY-13.1, STORY-13.2
**FR/NFR refs:** FR11.3
**Architecture refs:** §4.10

**As a** tech operator
**I want** an in-app browser to see what's in the library and import what I want
**So that** I don't have to use a separate tool.

**Acceptance Criteria:**
- [ ] AC1: Library Browser modal/panel: list of catalog entries with filters (title, artist, tag, language).
- [ ] AC2: Each entry shows: title, artist, BPM, language, published by, last updated.
- [ ] AC3: Checkbox-multi-select + "Download Selected" button.
- [ ] AC4: Progress per-bundle; rollback any partial imports on cancel.

---

### STORY-15.6: Signing key setup (optional, opt-in)

**Type:** feature
**Effort:** M
**Module:** WS
**Depends on:** STORY-15.3
**FR/NFR refs:** MC-NFR8
**Architecture refs:** ADR-13

**As a** central team member
**I want** to generate an Ed25519 signing key during setup
**So that** my published bundles can be verified by importers.

**Acceptance Criteria:**
- [ ] AC1: Settings → Library → "Enable Signing" flow.
- [ ] AC2: Generates a fresh keypair; stores private key via `safeStorage`.
- [ ] AC3: Uploads public key to library via authenticated Worker call (with publish credential).
- [ ] AC4: All subsequent publishes are signed.

---

### STORY-15.7: Identity management UI

**Type:** feature
**Effort:** S
**Module:** WS
**Depends on:** STORY-15.1
**FR/NFR refs:** MC-NFR6
**Architecture refs:** §8.4

**As a** tech operator
**I want** Settings → Identity to let me change my display name, switch to/from anonymous mode, and switch campus
**So that** I'm not locked into wizard-time choices.

**Acceptance Criteria:**
- [ ] AC1: Settings panel exposes all `InstallIdentity` fields.
- [ ] AC2: Changing campus triggers a re-fetch of the library catalog (since campus filters may differ).

---

## EP-16: Mixed-Mode Project Sources

**Goal:** Implement the central + autonomous project sourcing per architecture §8.5 — the per-service project source picker, central project plan fetch, local override on top of central, fork to local.

**FR/NFR refs:** MC-NFR5, FR7.

**Architecture refs:** §8.5, ADR-12.

### STORY-16.1: Project plan schema + storage

**Type:** infrastructure
**Effort:** S
**Module:** LM
**Depends on:** STORY-13.1
**FR/NFR refs:** MC-NFR5
**Architecture refs:** §8.5

**As a** developer
**I want** a `ProjectPlan` type and storage that represents a published setlist
**So that** central teams can publish setlists and campuses can subscribe.

**Acceptance Criteria:**
- [ ] AC1: `ProjectPlan` TS type: `{ id, name, date?, songs: { songId, bundleVersion, arrangementId? }[] }`.
- [ ] AC2: Stored at `<libraryUrl>/projects/{central,campuses/<id>}/<id>.json` per §8.5.
- [ ] AC3: LM exposes `fetchProject(id)`, `listProjects(filter?)`.

---

### STORY-16.2: Per-service project source picker UI

**Type:** feature
**Effort:** M
**Module:** WS
**Depends on:** STORY-16.1
**FR/NFR refs:** MC-NFR5
**Architecture refs:** §8.5

**As a** tech operator
**I want** to pick "from central library" / "my local project" / "build new" before each service
**So that** I can choose the right source per occasion.

**Acceptance Criteria:**
- [ ] AC1: Mockup matches architecture §8.5's UI.
- [ ] AC2: Central projects listed with date + name; click to load.
- [ ] AC3: Local projects: FreeShow's existing Projects list.
- [ ] AC4: "Build New" launches a blank project builder.

---

### STORY-16.3: Central project plan loading

**Type:** feature
**Effort:** M
**Module:** WS, LM
**Depends on:** STORY-16.2, STORY-13.3
**FR/NFR refs:** MC-NFR5
**Architecture refs:** §8.5

**As a** tech operator loading a central plan
**I want** all required bundles to download automatically before the service
**So that** I don't have to chase missing songs.

**Acceptance Criteria:**
- [ ] AC1: Loading a central plan fetches every referenced bundle (skip if already local).
- [ ] AC2: Creates a FreeShow Project locally pointing at the show IDs.
- [ ] AC3: Project name + date pre-filled.

---

### STORY-16.4: Local edits on top of central project

**Type:** feature
**Effort:** M
**Module:** WS
**Depends on:** STORY-16.3
**FR/NFR refs:** MC-NFR5
**Architecture refs:** §8.5

**As a** tech operator who wants to replace one song in the central setlist
**I want** to edit the local copy without losing the link to the central original
**So that** future central updates are still visible.

**Acceptance Criteria:**
- [ ] AC1: Local edits produce a "diverged" badge on the project.
- [ ] AC2: "Refresh from central" overwrites local edits (with confirmation).
- [ ] AC3: "Fork" promotes the project to fully local (no link to central).

---

### STORY-16.5: Campus-published projects

**Type:** feature
**Effort:** M
**Module:** WS, LM
**Depends on:** STORY-16.1, STORY-15.4
**FR/NFR refs:** FR11.6
**Architecture refs:** §8.5

**As a** campus that occasionally hosts the regional conference
**I want** to publish a project plan to the library
**So that** other campuses can subscribe to my plan.

**Acceptance Criteria:**
- [ ] AC1: Library Publish dialog has a "Publish Project" mode in addition to "Publish Song."
- [ ] AC2: Project plan published to `projects/campuses/<id>/<id>.json`.
- [ ] AC3: Worker writes it; catalog updated; visible to other campuses on next "Check Library."

---

# Part IV — Post-MVP

These epics are outlined at the same depth (per the user's request) but represent features that ship after the MVP validates.

---

## EP-17: Rehearsal Learning Mode

**Goal:** Implement FR8 — capture live rehearsal audio, segment into songs, learn the team's actual arrangement.

**FR/NFR refs:** FR8.1–FR8.9.

**Architecture refs:** §4.1 (segment_rehearsal RPC method), §4.4 (audio capture), §4.10 (RehearsalMode component).

### STORY-17.1: Rehearsal capture UI

**Type:** feature
**Effort:** M
**Module:** WS, AI
**Depends on:** STORY-07.2
**FR/NFR refs:** FR8.1, FR8.3
**Architecture refs:** §4.10

**As a** tech operator at a rehearsal
**I want** to start a continuous recording from my selected audio input
**So that** the team can play freely without me clicking between songs.

**Acceptance Criteria:**
- [ ] AC1: Rehearsal Mode panel: Start/Stop, level meter, elapsed time.
- [ ] AC2: Captures to a WAV file at `<userData>/lyricue/rehearsals/<timestamp>.wav`.
- [ ] AC3: Writes in chunks to avoid OOM on 4-hour rehearsals.

---

### STORY-17.2: Multi-song segmentation (sidecar)

**Type:** feature
**Effort:** L
**Module:** SL
**Depends on:** STORY-05.5
**FR/NFR refs:** FR8.2, FR8.6
**Architecture refs:** §4.1

**As a** developer
**I want** the sidecar to split a long recording into per-song segments using silence + lyric matching
**So that** rehearsal mode produces per-song timing maps.

**Acceptance Criteria:**
- [ ] AC1: `segment_rehearsal` RPC method per architecture §4.1.
- [ ] AC2: Silence detection via `librosa.effects.split`.
- [ ] AC3: For each segment, lyric fingerprinting (TF-IDF over the setlist's songs) picks the best match.
- [ ] AC4: Unmatched segments flagged for manual review.

---

### STORY-17.3: Rehearsal summary screen

**Type:** feature
**Effort:** M
**Module:** WS
**Depends on:** STORY-17.2
**FR/NFR refs:** FR8.7
**Architecture refs:** §4.10

**As a** tech operator after a rehearsal
**I want** a summary showing which songs were learned, which need review
**So that** I know what's ready for Sunday.

**Acceptance Criteria:**
- [ ] AC1: Per-song status: learned (green), partial (yellow), failed (red).
- [ ] AC2: Click into any song to drill down.

---

### STORY-17.4: Rehearsal-vs-studio coexistence

**Type:** feature
**Effort:** S
**Module:** TM
**Depends on:** STORY-17.2, STORY-03.4
**FR/NFR refs:** FR8.5
**Architecture refs:** §4.3

**As a** tech operator
**I want** to keep both the studio and rehearsal timing maps for a song
**So that** I can switch depending on the service.

**Acceptance Criteria:**
- [ ] AC1: TM supports multiple timing maps per song (`<showId>.studio.timing.json` + `<showId>.rehearsal.timing.json`).
- [ ] AC2: Settings or Setlist UI lets operator pick which is active.

---

### STORY-17.5: Storage cleanup

**Type:** feature
**Effort:** S
**Module:** WS
**Depends on:** STORY-17.1
**FR/NFR refs:** FR8.8
**Architecture refs:** §4.4

**As a** tech operator
**I want** to delete rehearsal recordings I no longer need
**So that** disk fills slowly.

**Acceptance Criteria:**
- [ ] AC1: Settings → Storage → list rehearsal files with size.
- [ ] AC2: Per-file delete + "Delete all older than N days" sweep.

---

### STORY-17.6: Rehearsal review for partial songs

**Type:** feature
**Effort:** M
**Module:** WS
**Depends on:** STORY-17.3
**FR/NFR refs:** FR8.9
**Architecture refs:** §4.10

**As a** tech operator
**I want** a review pane for songs flagged as partial
**So that** I can correct alignment without re-recording.

**Acceptance Criteria:**
- [ ] AC1: Same as STORY-11.7 timing preview, but with extra controls for marking unmatched lyrics as "skipped."
- [ ] AC2: Edits persist; "approve" promotes the song from partial to learned.

---

## EP-18: Arrangement Builder

**Goal:** Implement FR9 — visual section reordering, shorthand parsing, maps to FreeShow layouts.

**FR/NFR refs:** FR9.1–FR9.9.

**Architecture refs:** §4.10 (ArrangementBuilder), §6.2 (Arrangement schema).

### STORY-18.1: Drag-and-drop section ordering

**Type:** feature
**Effort:** L
**Module:** WS
**Depends on:** STORY-03.4
**FR/NFR refs:** FR9.1–FR9.5
**Architecture refs:** §4.10

**As a** tech operator or worship leader
**I want** to drag section blocks into a custom order
**So that** Sunday's arrangement reflects the leader's intent.

**Acceptance Criteria:**
- [ ] AC1: Section blocks for each section in the timing map.
- [ ] AC2: Drag-drop reordering using a standard library (e.g., `svelte-dnd-action`).
- [ ] AC3: Section blocks can be duplicated, removed, and reordered freely.
- [ ] AC4: Save as named arrangement.

---

### STORY-18.2: Shorthand parser

**Type:** feature
**Effort:** S
**Module:** WS
**Depends on:** STORY-18.1
**FR/NFR refs:** FR9.9
**Architecture refs:** §4.10

**As a** worship leader who texts "V1 C V2 C C B C O"
**I want** the operator to paste that and get the arrangement
**So that** I don't have to explain section labels.

**Acceptance Criteria:**
- [ ] AC1: Parser handles "V1", "C", "B", "B2", "Tag", "Outro", etc.
- [ ] AC2: Unrecognized tokens flagged with a hint.

---

### STORY-18.3: Multiple named arrangements per song

**Type:** feature
**Effort:** S
**Module:** TM, WS
**Depends on:** STORY-18.1, STORY-03.4
**FR/NFR refs:** FR9.6
**Architecture refs:** §4.3

**As a** tech operator at a campus with multiple service styles
**I want** to save "Sunday Morning" and "Evening Service" arrangements per song
**So that** I can switch arrangements without re-learning.

**Acceptance Criteria:**
- [ ] AC1: Per-song arrangement list in UI.
- [ ] AC2: Active arrangement selection per project.

---

### STORY-18.4: Map arrangement to FreeShow Layout

**Type:** feature
**Effort:** M
**Module:** WS
**Depends on:** STORY-18.1
**FR/NFR refs:** FR9.7
**Architecture refs:** §7.4

**As a** developer
**I want** saved arrangements to create/update the corresponding FreeShow Layout for the show
**So that** the slide order matches the arrangement order.

**Acceptance Criteria:**
- [ ] AC1: Saving an arrangement creates a Layout in the show's `layouts` map.
- [ ] AC2: Layout's `slides` array sequenced per arrangement.
- [ ] AC3: Sister mode: writes via FreeShow's REST API.

---

### STORY-18.5: Live sync follows arrangement

**Type:** feature
**Effort:** S
**Module:** SE
**Depends on:** STORY-18.4
**FR/NFR refs:** FR9.8
**Architecture refs:** §4.8

**As a** congregation member
**I want** the sync engine to advance through sections in the arrangement order, not the recording order
**So that** the display matches what the team is doing.

**Acceptance Criteria:**
- [ ] AC1: SE uses arrangement's section sequence to determine "next section."
- [ ] AC2: When the leader sings the chorus again, SE knows the arrangement says "second chorus is coming" and matches accordingly.

---

## EP-19: Multilingual Parallel Lyrics

**Goal:** Implement FR10 — synchronized second-language display, configurable.

**FR/NFR refs:** FR10.1–FR10.8.

**Architecture refs:** §4.9 (parallel lyrics rendering), §6.1 (lyrics translation tracks).

### STORY-19.1: ParallelLyricsTrack schema

**Type:** infrastructure
**Effort:** S
**Module:** TM
**Depends on:** STORY-03.1
**FR/NFR refs:** FR10.1, FR10.2
**Architecture refs:** §6.1

**As a** developer
**I want** a `ParallelLyricsTrack` type that maps section IDs to translated text
**So that** translations attach to timing maps cleanly.

**Acceptance Criteria:**
- [ ] AC1: `ParallelLyricsTrack: { language: string; sections: { sectionId: string; text: string }[] }`.
- [ ] AC2: TimingMap extended to allow optional `parallel?: ParallelLyricsTrack[]`.

---

### STORY-19.2: Translation editor UI

**Type:** feature
**Effort:** M
**Module:** WS
**Depends on:** STORY-19.1
**FR/NFR refs:** FR10.2
**Architecture refs:** §4.10

**As a** tech operator
**I want** a per-section translation editor
**So that** I can add Zulu / Sotho / Spanish translations.

**Acceptance Criteria:**
- [ ] AC1: Side-by-side editor: original section text on left, translation textarea on right.
- [ ] AC2: Save → translation persists with the timing map.

---

### STORY-19.3: KR renders translations (covered in EP-06 STORY-06.7)

Reference to EP-06; included here for completeness.

---

### STORY-19.4: Language swap (primary ⇄ secondary)

**Type:** feature
**Effort:** S
**Module:** WS, KR
**Depends on:** STORY-19.2
**FR/NFR refs:** FR10.5
**Architecture refs:** §4.10

**As a** tech operator at a Zulu-language service
**I want** to swap which language is primary
**So that** Zulu gets the karaoke highlight.

**Acceptance Criteria:**
- [ ] AC1: Settings or per-service toggle.
- [ ] AC2: KR reflects the swap on the next render.

---

### STORY-19.5: Auto-size for 2-3 languages

**Type:** feature
**Effort:** S
**Module:** KR
**Depends on:** STORY-06.6
**FR/NFR refs:** FR10.8
**Architecture refs:** §4.9

**As a** congregation member
**I want** font sizes to auto-adjust when 2 or 3 languages are shown
**So that** nothing overflows.

**Acceptance Criteria:**
- [ ] AC1: 2 languages: primary 100%, secondary 60%.
- [ ] AC2: 3 languages: primary 100%, secondaries 50%.

---

## EP-20: Captions Word-Highlight Upstream PR

**Goal:** Per ADR-16, propose and track the small upstream PR to FreeShow that unlocks `CaptionInjectionOutputAdapter` for full-fidelity sister-service mode.

**FR/NFR refs:** P11.

**Architecture refs:** §7.8, ADR-16.

### STORY-20.1: Engage FreeShow maintainer via Discussion

**Type:** research
**Effort:** S
**Module:** Upstream
**Depends on:** none (can run in parallel with MVP work)
**FR/NFR refs:** P11
**Architecture refs:** §7.8, ADR-16

**As a** project lead
**I want** to open a GitHub Discussion in ChurchApps/.github describing the use case and proposed Captions extension
**So that** vassbo's response shapes the PR before code is written.

**Acceptance Criteria:**
- [ ] AC1: Discussion posted with clear use case (live karaoke companion service).
- [ ] AC2: Includes the proposed scope: Captions `highlightMode: 'word-sweep'`, `wordProgress` field.
- [ ] AC3: Includes the rationale (matches existing extension patterns; minimal scope).
- [ ] AC4: Response received within 30 days (active monitoring; bumping if quiet).

---

### STORY-20.2: Draft + open the PR

**Type:** feature
**Effort:** M
**Module:** Upstream
**Depends on:** STORY-20.1 (or open in parallel if Discussion is unresponsive)
**FR/NFR refs:** P11
**Architecture refs:** §7.8

**As a** project lead
**I want** a focused, ~150-LOC PR adding the Captions word-highlight feature to FreeShow
**So that** vassbo can review a minimal, value-adding change.

**Acceptance Criteria:**
- [ ] AC1: PR scope: 3–4 files, ~150 LOC.
- [ ] AC2: Includes tests + screenshots showing word-highlight rendering.
- [ ] AC3: PR description explains use case + ties to the Discussion.
- [ ] AC4: Conforms to FreeShow style (prettier, eslint, naming).

---

### STORY-20.3: CaptionInjectionOutputAdapter (post-PR)

**Type:** feature
**Effort:** M
**Module:** KR
**Depends on:** STORY-20.2 (merged)
**FR/NFR refs:** P11
**Architecture refs:** §4.9

**As a** developer
**I want** the third OutputAdapter implementation that drives FreeShow's enhanced Captions item via WebSocket
**So that** sister-service mode reaches full rendering fidelity.

**Acceptance Criteria:**
- [ ] AC1: Adapter sends WebSocket messages to FreeShow's existing API.
- [ ] AC2: Uses the new `highlightMode: 'word-sweep'` and `wordProgress` fields.
- [ ] AC3: Latency budget: ≤30ms from SE tick to FreeShow render.

---

### STORY-20.4: Fallback path if PR rejected

**Type:** docs
**Effort:** S
**Module:** Upstream
**Depends on:** STORY-20.1
**FR/NFR refs:** P11
**Architecture refs:** ADR-16

**As a** project lead
**I want** an architecture amendment documenting the fallback if vassbo rejects the PR
**So that** the team knows the path forward (rely on `OwnWindowOutputAdapter`).

**Acceptance Criteria:**
- [ ] AC1: ADR-16 amendment with the response noted.
- [ ] AC2: User-facing implication documented (the "two-app workflow" note).

---

# 6. Dependency Graph

A summary of the critical dependencies between epics:

```
EP-01 (Foundation)
   │
   ├──→ EP-02 (OutputAdapter walking skeleton) ──┬──→ EP-06 (KR)
   │                                              ├──→ EP-09 (SE)
   │                                              └──→ EP-12 (Setlist)
   │
   ├──→ EP-03 (Timing Map storage) ──────────────┬──→ EP-05 (SL)
   │                                              ├──→ EP-13 (LM)
   │                                              └──→ EP-17 (Rehearsal)
   │
   └──→ EP-04 (Python Sidecar infra) ────────────→ EP-05 (SL)

EP-05 (SL) ──────────────────────────────────────→ EP-11 (Lyrics wizard)
EP-07 (Audio + BD) ──┬──→ EP-08 (VAD + STT) ─────→ EP-09 (SE)
                     └──→ EP-09 (SE)
EP-09 (SE) ───────────────────────────────────────→ EP-10 (Operator UI)
EP-10 (Operator UI) + EP-12 (Setlist) ──────────────→ EP-16 (Mixed-mode sources)

EP-13 (LM) ──┬──→ EP-15 (Identity + Publishing)
             └──→ EP-16 (Mixed-mode sources)
EP-14 (Library hosting) ── parallel to EP-13/15 ──→ Required before EP-13 can fully integrate

EP-17–20 (Post-MVP) ── independent of each other; sequenced by team capacity
```

**Critical path for MVP:** EP-01 → EP-02 → EP-04 → EP-05 → EP-07 → EP-08 → EP-09 → EP-10. Everything else can run alongside once these clear.

---

# 7. Release Plan

This sequences epics into shippable milestones. Each milestone should produce a working, demoable build.

## Milestone M1 — "Architecture Proven" (weeks 1–3)

**Epics completed:** EP-01, EP-02
**Demo:** A LyriCue install in both fork and sister modes, showing the same hello-world karaoke effect end-to-end. No real audio, no real sync, no real lyrics — but every interface real, both adapter implementations working.
**Verification:** `/qa-analyst` pass against the walking-skeleton demo: (a) launch in fork mode and confirm karaoke effect on FreeShow output; (b) launch in sister mode and confirm karaoke effect in WorshipSync's own window; (c) first-run wizard completes a happy path and an anonymous-skip path; (d) settings tab persists changes across an app restart. QA report at `docs/qa-reports/M1-<date>.md`.
**Risk retired:** Dual-mode architecture is viable.

## Milestone M2 — "Walking Skeleton + Storage + Sidecar" (weeks 4–6)

**Epics completed:** EP-03, EP-04
**Demo:** Run a synthetic timing map through SE (still stubbed) and TM (now real). Spawn the bundled sidecar via SC. Issue a `check_models` call and get a response.
**Verification:** `/qa-analyst` pass: (a) timing map saved via the app survives an OS-level process kill mid-write (NFR2.1 — atomic write actually atomic); (b) sidecar crash mid-job surfaces a plain-language error and leaves the app usable; (c) `check_models` reports a meaningful state on a fresh install with no models yet. QA report at `docs/qa-reports/M2-<date>.md`.
**Risk retired:** Persistence and sidecar lifecycle work.

## Milestone M3 — "Song Learning Working" (weeks 7–10)

**Epics completed:** EP-05, EP-11 (partial — at least Steps 1–3)
**Demo:** Start the app, paste lyrics, attach an MP3, get a timing map back, preview it.
**Verification:** `/qa-analyst` pass: (a) learn a real song from a public-domain MP3 + lyrics end-to-end, asserting time-to-result on a 5-min song meets NFR1.1 on the test machine; (b) word-level timing accuracy against a manually-prepared ground truth meets NFR2.2 (≥85% words within ±300 ms); (c) failure paths produce plain-language errors per NFR5.4 (corrupt audio, no vocals, lyrics-don't-match-recording, cancelled mid-job). QA report at `docs/qa-reports/M3-<date>.md`.
**Risk retired:** ML pipeline produces usable timing data.

## Milestone M4 — "Live Sync Working in Demo Conditions" (weeks 11–15)

**Epics completed:** EP-06, EP-07, EP-08, EP-09
**Demo:** Load a learned song; play the reference audio through a loopback; watch the karaoke output highlight words in time. Manual overrides work. Tier transitions work.
**Verification:** `/qa-analyst` pass — the heaviest one in the project: (a) live sync session against a loopback audio source, with frame-rate measurement against NFR1.3 (≥30fps highlight); (b) manual override response time against NFR1.6 (≤200ms); (c) tier degradation paths fire correctly when beat confidence drops and when audio input disconnects; (d) STT position correction triggers when the leader is simulated singing a different section; (e) karaoke renderer behaves correctly on 1080p, 4K, and ultrawide outputs (NFR3.4). QA report at `docs/qa-reports/M4-<date>.md`.
**Risk retired:** End-to-end live sync.

## Milestone M5 — "Operator-Ready MVP" (weeks 16–20)

**Epics completed:** EP-10, EP-11 (full), EP-12
**Demo:** Run a full multi-song setlist demo. ≤3 clicks to start sync. Songs auto-advance. Manual override gracefully tested.
**Verification:** `/qa-analyst` pass simulating a full service run: (a) 3-clicks-to-start NFR5.2 measured on a clean install; (b) 4-song setlist runs from start to finish with auto-advance between songs; (c) mid-service operator interventions (jump to song 3, manual override during chorus repeat, switch to manual mode for scripture reading) all produce expected output; (d) non-technical operator usability test against NFR5.2 with at least one observer-only run by a non-developer if available. QA report at `docs/qa-reports/M5-<date>.md`.
**Risk retired:** Single-campus MVP.

## Milestone M6 — "Multi-Tenant Library Operational" (weeks 21–26)

**Epics completed:** EP-13, EP-14, EP-15, EP-16
**Demo:** Two installs (representing two campuses) sharing a library. Central team publishes a song from Install A; Install B clicks "Check Library," sees it, downloads it, plays it.
**Verification:** `/qa-analyst` pass against a real Cloudflare R2 + Worker deployment: (a) end-to-end publish-from-A → fetch-on-B flow; (b) signature verification accepts a properly-signed bundle and rejects a tampered one (ADR-13); (c) mirror failover triggers correctly when R2 is unreachable; (d) mixed-mode operation — Install B uses a central plan one service and its own plan the next without data loss; (e) bundle integrity (SHA256 mismatch) is detected on download. QA report at `docs/qa-reports/M6-<date>.md`.
**Risk retired:** Multi-campus story.

## Milestone M7 — "MVP Pilot-Ready" (weeks 27–30)

**Polish, performance, signing, packaging, deployment to first pilot campus.**

**Verification:** Full pre-launch `/qa-analyst` pass — the most rigorous of the project: (a) signed installers verified on all 5 platforms (macOS arm64/x64, Windows x64, Linux x64/arm64); (b) zero-config install on a clean OS image with no developer tools; (c) full offline operation verified by running an end-to-end service with the network firewalled (`iptables` / equivalent); (d) full regression of M1–M6 verification scenarios; (e) auto-updater verified against the release feed; (f) at least one full simulated service walkthrough against pilot-campus hardware spec (4-core CPU, 8 GB RAM, no GPU). QA report at `docs/qa-reports/M7-pre-pilot-<date>.md`. **Pilot deployment is blocked until this passes with zero critical or major defects.**

## Post-MVP

EP-17 (Rehearsal Mode) — first post-MVP increment.
EP-20 (Captions PR) — track the upstream conversation continuously; merged whenever vassbo accepts.
EP-18 (Arrangement Builder) and EP-19 (Multilingual) sequence by feedback from the pilot campus.

**Total MVP duration: ~30 weeks** with a team of 2–3 engineers. Realistic given the scope; can compress with more engineers or de-scope.

---

# 8. Phase 3 Readiness Check

Before Phase 4 (implementation) begins, verify:

| Check | Status |
|---|---|
| All 11 PRD functional requirements (FR1–FR11) have epic coverage | ✅ — see traceability per epic |
| All 6 PRD non-functional requirements (NFR1–NFR6) have epic coverage | ✅ — see DoD §4 + EP-specific NFR refs |
| All 8 multi-campus NFRs (MC-NFR1–MC-NFR8) have epic coverage | ✅ — primarily EP-13–EP-16 |
| Architecture document has no open questions | ✅ — all OQs resolved in PRD §10 and ADRs |
| Walking-skeleton epic identifies and retires the dual-mode architectural risk early | ✅ — EP-02 is positioned correctly |
| Critical path is clear and feasible | ✅ — see §6 dependency graph and §7 release plan |
| Definition of Done covers cross-platform, both deployment modes, and standard quality bars | ✅ — see §4 |
| Story estimates are realistic (no L stories that are secretly XL) | ⚠️ — to be reviewed by engineering during sprint planning |
| Team has access to required infrastructure (GitHub, Cloudflare account for library hosting, code-signing certs) | ⚠️ — to be acquired before EP-14 |
| FreeShow upstream relationship has a strategy (per ADR-16) | ✅ — see EP-20 |

**Readiness item disposition (decided 2026-05-13):**

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Engineering estimate review | ⏭️ Skipped | Claude Code is the implementer; S/M/L/XL annotations are kept as relative complexity indicators, not scheduling commitments. |
| 2 | Code-signing certificates | ⏰ Deferred to M7 | Required only at pilot deployment (Milestone M7). Project owner will acquire macOS Developer ID + Windows EV certs ~week 23–24 of the schedule. Unsigned dev builds work through M6. |
| 3 | Cloudflare account | 👤 Owner action | Project owner is creating the Cloudflare account manually, before Milestone M6 begins. No further design dependency. |
| 4 | Monorepo vs. multi-repo | ✅ Decided — single monorepo | STORY-01.1 updated to reflect the decision; remaining work is just writing the layout ADR. |
| 5 | Upstream Discussion to FreeShow | 📝 Draft prepared | Draft Discussion post produced as `_bmad-output/freeshow-upstream-discussion-draft.md` (separate artifact). Project owner decides when (or whether) to post it; the dual-adapter fallback is already designed to survive a non-response or rejection. |

**Phase 4 is ready to begin.** Claude Code can start with EP-01 STORY-01.1 (writing the monorepo ADR), then proceed through STORY-01.2 (workspace initialization) and the rest of the critical-path sequence per §7.

---

*BMAD Phase 3: Solutioning — Epics & Stories*
*Status: DRAFT*
*Author: Architect Agent*
*Date: 2026-05-13*
*Input: product-brief.md (Phase 1), PRD.md (Phase 2), architecture.md (Phase 3)*
*Next: Phase 3 Readiness Check (engineering review) → Phase 4 Implementation*
