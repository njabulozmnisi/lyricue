# LyriCue

**AI-powered live lyric synchronization. Domain-neutral; built for live performance.**

> Learn a song once from a reference recording. During live performance, LyriCue listens to the room and highlights each word in tempo, advancing lyrics predictively at the lead vocalist's actual pace.

Primary launch market is **worship in multi-campus churches**. Architecture is deliberately domain-neutral — the same capability serves karaoke venues, theater, touring live music, sing-along educational content, conference teleprompting, and real-time accessibility captioning.

## Current state — 2026-06-19

**Locally feature-complete. Externally pending signed installers + venue hardware drills.**

| Suite | Tests | Status |
|---|---:|---|
| TypeScript (Vitest) | 879 | passing |
| Publish Worker | 21 | passing |
| Python sidecar (regular venv) | 88 + 1 skipped | passing |
| Python sidecar (ML venv) | 97 + 1 skipped | passing |
| svelte-check | 0/0 | clean |

Full status: [docs/qa-reports/production-ready-handoff-2026-06-18.md](docs/qa-reports/production-ready-handoff-2026-06-18.md).

### Release gate status

| Gate | What | Status |
|---|---|---|
| A | Local MVP | ✅ Closed 2026-06-05 |
| B | Production ML certification | Local proven; per-platform packaged smoke pending |
| **C** | **Multi-campus library publishing** | ✅ **Closed live 2026-06-18** against real Cloudflare |
| D | Signed installers + fork-mode SDKs | External: Apple Developer ID + Windows EV cert + FreeShow vendor SDKs |
| E | Hardware/live-worship drills | External: physical mic + projector + operator drills at venue |

## Capabilities

- **Word-level karaoke highlighting.** Each word sweeps in tempo, with tempo-adaptive easing (staccato → snappy, held → soft) and predictive next-section preview.
- **AI song learning.** Feed in a recording + structured lyrics; local Demucs (vocal isolation) + WhisperX (forced alignment) produce word-level timing maps. ~2–5 min per 5-min song. Fully offline.
- **Live tempo sync.** Real-time beat detection (Meyda) drives a cursor through the timing map at the singer's actual pace.
- **STT position correction.** Local Whisper-class binding detects unplanned section jumps and resyncs the cursor. No internet required.
- **Three-tier graceful degradation.** Full AI sync → timer-based → manual. Audio loss, low confidence, or a bumped mic never freezes the display. The operator always has a one-key override.
- **Multilingual lyrics.** Display lyrics in any combination of primary + parallel languages. Operator can promote a translation to primary mid-service (section-granular sweep for projected languages).
- **Rehearsal capture.** Record an entire rehearsal once; the system segments it per song and writes per-song timing-map variants.
- **Arrangement builder.** Define section order ("V1 C V2 C C B C") without re-learning the song.
- **Multi-campus library.** Cloudflare R2 + Worker fronts signed `.lcbundle` files; campuses subscribe to a central library, fallback-mirrored to GitHub for disaster recovery.
- **Crash-safe persistence.** Every persisted artifact uses atomic writes; concurrent writes serialise without data loss; failed writes leave prior state intact.

## Architecture in one paragraph

LyriCue is a TypeScript monorepo (npm workspaces) running on Electron in two modes: **sister-mode** (own BrowserWindows, current default) and **fork-mode** (embedded inside a FreeShow fork, deferred until vendor SDKs ship). Audio processing happens in TypeScript (Meyda for beat detection, custom Schmitt-trigger VAD). ML-heavy work (vocal isolation, forced alignment) runs in a Python 3.11 sidecar over JSON-RPC stdin/stdout. The **Sync Engine** is a pure-function state machine that ingests tempo/VAD events, advances a cursor, and emits per-frame envelopes consumed by an `OutputAdapter` — either an own-window karaoke renderer or a FreeShow caption-injection adapter. Persistence is all atomic-write (crash-safe). Library publishing fronts Cloudflare R2 through a Worker; bundles mirror automatically to a GitHub repo.

For the full design, read [_bmad-output/architecture.md](_bmad-output/architecture.md). For the release model, [docs/release-signoff-checklist.md](docs/release-signoff-checklist.md).

## Repo layout

```
apps/
  sister/          Electron app, sister-service mode (current default)
  fork/            Embeds inside a FreeShow fork (vendor SDKs gate fork-mode runtime)
packages/
  core/            Mode-agnostic TS: sync engine, audio, STT, storage, sidecar, library, settings
  ui/              Shared Svelte 3 components
python-sidecar/    Python 3.11 sidecar for vocal isolation, forced alignment, BPM
infra/
  publish-worker/  Cloudflare Worker fronting R2 for multi-campus library publishing
docs/              Architecture, release checklist, QA reports
_bmad-output/      BMAD planning artifacts (brief, PRD, architecture, 20 epics, ~133 stories)
```

## Running it locally

Requirements: macOS or Linux (Windows works for the app but not for ML packaging yet), Node 25+, Python 3.11.

```bash
git clone https://github.com/njabulozmnisi/lyricue.git
cd lyricue
npm install
npm run build

# Full local quality gate (TS build + tests + svelte-check + Worker + Python)
npm run verify:local

# Launch the dual-window walking-skeleton (sister mode + synthetic audio + demo song)
env -i HOME="$HOME" PWD="$PWD" PATH="/opt/homebrew/opt/node@25/bin:$PWD/node_modules/.bin:/usr/bin:/bin" \
  LC_DEPLOYMENT_MODE=sister LC_E2E_MODE=1 LC_VERBOSE=1 \
  electron apps/sister/dist-electron/main.js
```

The `env -i` wrapper is mandatory on the canonical dev machine because of a stale `NODE_PATH` from a legacy NVM install. On other machines, plain `electron …` works fine. See [AGENTS.md](AGENTS.md) §5 for full environment notes.

## ML stack

All local, fully offline-capable. **No general-purpose LLMs** — only specialised audio models:

| Component | Tool | License | Purpose |
|---|---|---|---|
| Vocal isolation | Demucs (Meta) | MIT | Separate vocals from instruments |
| Forced alignment | WhisperX (faster-whisper + wav2vec2) | BSD-2 | Word-level timestamps from vocals + lyrics |
| Live beat detection | Meyda | MIT | Real-time BPM tracking |
| Live STT (pending binding selection) | whisper-rs / faster-whisper | MIT / BSD | Position correction without internet |

See [docs/ep08-stt-binding-contract.md](docs/ep08-stt-binding-contract.md) for the STT binding contract; bindings can be swapped via a one-line construction-time injection.

## Hardware requirements

- **Live performance machine:** 4-core CPU, 8 GB RAM, no GPU required. Apple M1+ is a first-class target.
- **Song learning machine (pre-service):** Same baseline; faster with GPU.
- **Network:** Not required during live performance. Only for the one-time ~875 MB model download and optional library sync.

## Contributing

Read [AGENTS.md](AGENTS.md) for durable context — repo layout, build commands, conventions, the 11 critical design constraints, operator working style. Read [HANDOFF.md](HANDOFF.md) §0 for current state at clone time.

**Conventional commits with ticket numbers:**
```
<type>:(#<ticket>): <description>
```
Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`, `security`.

**No AI attribution in commits, PRs, or any project artifact.** Global git hooks enforce this.

## License

GPL-3.0 — required by FreeShow's copyleft license. See [LICENSE](LICENSE).

## Acknowledgements

LyriCue's fork-mode plugs into [FreeShow](https://github.com/ChurchApps/FreeShow), an open-source presentation tool by ChurchApps. Vocal isolation uses [Demucs](https://github.com/facebookresearch/demucs); forced alignment uses [WhisperX](https://github.com/m-bain/whisperX). Beat detection uses [Meyda](https://github.com/meyda/meyda). The architecture follows the [BMAD methodology](https://docs.bmad-method.org/) for AI-driven software development.
