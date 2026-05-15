# LyriCue

**AI-powered live lyric synchronization tool. Built on [FreeShow](https://freeshow.app/). Domain-neutral.**

> "Learn once, sync every time." Feed the system a song recording and lyrics → it learns word-level timing → during live performance, it highlights each word in tempo and advances lyrics predictively, adapting to the lead vocalist's actual pace.

## What This Is

LyriCue learns songs from reference recordings and delivers real-time, word-by-word karaoke-style highlighting during live performance. It is **domain-neutral**: usable for worship, karaoke, theater, live music, language-learning, school sing-alongs, conference teleprompting, or any context where lyrics must follow a lead vocalist.

Primary launch market: worship in multi-campus churches. Architecture deliberately avoids coupling to any one domain.

## Capabilities

- **Word-level karaoke highlighting** — each word sweeps in tempo, with held-note pulse and predictive next-section preview
- **AI song learning** — feed in a recording + lyrics; local Demucs + WhisperX produce word-level timing (~2–5 min per 5-min song)
- **Live tempo sync** — beat detection adapts to the lead vocalist's pace in real time
- **STT position correction** — local Whisper.cpp detects unplanned section jumps and resyncs (no internet)
- **Rehearsal learning** — capture a rehearsal once; the system splits it into per-song timing maps
- **Arrangement builder** — define section order ("V1 C V2 C C B C") without re-learning the song
- **Multilingual parallel lyrics** — synchronized second-language display, auto-sized for 2–3 languages
- **Multi-tenant library** — share learned songs across an organization (e.g., 60-campus church) via Cloudflare R2; mirrored to GitHub for disaster recovery
- **Three-tier graceful degradation** — full AI sync → timer-based → manual; system never crashes during a live performance

## Status

🚧 **Phase 4 — Implementation in progress.**

Planning artifacts produced via the [BMAD Method](https://docs.bmad-method.org/):

| Phase | Status | Artifact |
|---|---|---|
| Phase 1: Analysis | ✅ Complete | [_bmad-output/product-brief.md](_bmad-output/product-brief.md) |
| Phase 2: Planning — PRD | ✅ Complete | [_bmad-output/PRD.md](_bmad-output/PRD.md) |
| Phase 3: Solutioning — Architecture | ✅ Complete (rev. 3 + ADR-17) | [_bmad-output/architecture.md](_bmad-output/architecture.md) |
| Phase 3: Solutioning — Epics & Stories | ✅ Complete (20 epics, ~133 stories) | [_bmad-output/epics.md](_bmad-output/epics.md) |
| Phase 4: Implementation | 🚧 EP-01 in progress | — |

## Repository Layout

Single monorepo per [ADR-17](_bmad-output/architecture.md). Build-time flag `LC_DEPLOYMENT_MODE=fork|sister` selects which Electron app is packaged.

```
lyricue/
├── apps/
│   ├── fork/              # Fork-mode Electron app — vendors FreeShow as a submodule
│   └── sister/            # Sister-mode standalone Electron app — drives FreeShow via its public APIs
├── packages/
│   ├── core/              # Mode-agnostic TS modules (sync engine, audio, STT, storage, sidecar, library, settings)
│   └── ui/                # Shared Svelte components
├── python-sidecar/        # ML pipeline (Demucs + WhisperX), PyInstaller-bundled per-platform
├── infra/
│   └── publish-worker/    # Cloudflare Worker fronting R2 for library publish writes
├── docs/
└── _bmad-output/          # BMAD planning artifacts (brief, PRD, architecture, epics)
```

## Dual-Mode Deployment

Per [ADR-16](_bmad-output/architecture.md):

- **Fork mode** — LyriCue code lives inside a FreeShow fork; the operator runs one combined Electron app. Maximum rendering fidelity. Requires periodic merges from upstream FreeShow.
- **Sister-service mode** — LyriCue runs as a standalone Electron app and drives FreeShow externally via its public APIs (REST + WebSocket). Cleaner separation, lower maintenance, but rendering quality depends on whether the [Captions word-highlight extension PR](_bmad-output/freeshow-upstream-discussion-draft.md) lands upstream.

Both modes are first-class. Most code is shared via `packages/core/` and `packages/ui/`; only the `OutputAdapter` (the per-frame rendering surface) differs.

## ML Stack

All local, fully offline-capable. **No general-purpose LLMs** — only specialized audio models:

| Component | Tool | License | Purpose |
|---|---|---|---|
| Vocal isolation | Demucs (Meta) | MIT | Separate vocals from instruments |
| Forced alignment | WhisperX (faster-whisper + wav2vec2) | BSD-2 | Word-level timestamps from vocals + lyrics |
| Live beat detection | Meyda | MIT | Real-time BPM tracking |
| Live STT | Whisper.cpp via Node native addon | MIT | Position correction without internet |

See [architecture.md §2.1](_bmad-output/architecture.md) for the full offline guarantee + hardware requirements.

## Hardware Requirements

**Live performance machine:** 4-core CPU, 8 GB RAM, no GPU. Apple M1+ is a first-class target.
**Song learning machine (pre-service):** Same baseline; faster with GPU (NVIDIA or Apple Silicon).
**Network:** Not required during live performance. One-time model downloads (~875 MB) and optional library sync only.

## Development

Prerequisites:

- Node.js ≥ 20
- npm ≥ 10
- Python ≥ 3.10 (for sidecar development; bundled into the installer at release time per [ADR-14](_bmad-output/architecture.md))

```bash
# Install workspace dependencies
npm install

# Build the shared packages
npm run build:core
npm run build:ui

# Sister-mode app (no FreeShow submodule needed)
npm run dev:sister

# Fork-mode app (requires the FreeShow submodule)
npm -w @lyricue/fork run freeshow:init
npm run dev:fork

# Run all TypeScript tests
npm run test:ts

# Run Python sidecar tests
npm run test:py

# Format check + lint
npm run format:check
npm run lint

# Walking-skeleton demo (proves dual-mode end-to-end; EP-02 STORY-02.4)
npm run demo:walking-skeleton:sister
npm run demo:walking-skeleton:fork  # requires FreeShow native deps (see below)
```

## Verifying the architecture works (STORY-02.4)

The walking-skeleton demos prove that LyriCue's `OutputAdapter` abstraction (ADR-16) actually composes — same `KaraokeOutput.svelte` component, same `DemoSyncEngine`, same `DEMO_TIMING_MAP`, same SyncFrame stream — through two different rendering backends.

**Sister-mode demo** (`npm run demo:walking-skeleton:sister`):
- Launches a standalone Electron app
- Opens a karaoke output BrowserWindow (transparent + frameless + alwaysOnTop)
- Walks the demo timing map at 60fps via `DemoSyncEngine`
- Renders the karaoke sweep via `OwnWindowOutputAdapter`
- No FreeShow native deps required — runs on a fresh checkout after `npm install + npm -w @lyricue/sister run build`

**Fork-mode demo** (`npm run demo:walking-skeleton:fork`):
- Launches the FreeShow fork (`apps/fork/freeshow/`) with the LyriCue extension surface patches
- Same `DemoSyncEngine` + `DEMO_TIMING_MAP`, frames driven through `ForkOutputAdapter` and FreeShow's `OUTPUT` IPC channel
- **Prerequisite:** FreeShow's native deps (NDI SDK, Blackmagic SDK, libltc-wrapper) must be installed via FreeShow's own developer setup at <https://freeshow.app/docs>. These are vendor SDKs the LyriCue build does not (and cannot) provide. If they're not installed, this demo fails at FreeShow's `electron-builder install-app-deps` step with native-module errors — use the sister-mode demo instead for architecture verification.

The two demos consume identical `SyncFrame` streams. If the karaoke sweep effect looks visually identical in both windows, the OutputAdapter abstraction is proven sound.

## Architecture Documents

- [Product Brief](_bmad-output/product-brief.md) — vision, problem, positioning
- [PRD](_bmad-output/PRD.md) — 11 functional requirement groups, 6 NFR groups, 8 user journeys
- [Architecture](_bmad-output/architecture.md) — system decomposition, dual-mode design, ADRs, multi-tenant infrastructure
- [Epics & Stories](_bmad-output/epics.md) — 20 epics, ~133 stories, walking-skeleton release plan
- [FreeShow Upstream Discussion Draft](_bmad-output/freeshow-upstream-discussion-draft.md) — proposed Captions extension conversation

## License

GPL-3.0 — required by FreeShow's copyleft license. See [LICENSE](LICENSE).
