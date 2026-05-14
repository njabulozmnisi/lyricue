# Architecture: LyriCue

**Version:** 1.0 DRAFT
**Phase:** BMAD Phase 3 — Solutioning
**Agent:** Architect Agent
**Date:** 2026-05-13
**Input Dependencies:** `product-brief.md` (Phase 1), `PRD.md` (Phase 2)
**Target Host:** FreeShow v1.6.1-beta.2 (ChurchApps/FreeShow), Electron + Svelte + TypeScript, GPL-3.0

---

## 1. Purpose & Scope

This document defines the technical architecture for LyriCue — an AI-powered live-lyric synchronization tool that delivers word-level karaoke rendering, live tempo tracking, and predictive slide advancement. LyriCue is built on top of FreeShow (https://freeshow.app/), an open-source generic presentation framework. Per ADR-16, LyriCue ships in two deployment modes from one codebase: a FreeShow fork build (max rendering fidelity) and a standalone sister-service build that drives FreeShow via its public APIs.

**Positioning:** LyriCue is **domain-neutral**. Its primary launch market is **worship in multi-campus churches** because that market is well-understood, motivated, and has a real 60-venue deployment scenario behind it. But the technology — audio sync, word-level timing, karaoke-style highlighting, multi-tenant content libraries — is generic. The same architecture serves karaoke venues, theater productions, touring music, language-learning applications, school sing-alongs, conference teleprompting, and other live-performance contexts. Architectural decisions deliberately avoid coupling to any one domain. Where worship-specific examples appear (especially in §8's multi-campus deployment), they illustrate generic capabilities. The terms "service," "campus," and "organization" appear in §8 because the launch customer is a multi-campus church; substitute "performance," "venue," and "organization" to read it generically.

The architecture is the contract between the PRD's *what* (functional requirements FR1–FR11, non-functional requirements NFR1–NFR6) and Phase 4's *how* (epics, stories, code). Every architectural decision here either satisfies a PRD requirement, manages a constraint imposed by the host system (FreeShow), or resolves a trade-off between competing forces (latency vs. accuracy, simplicity vs. extensibility, offline-first vs. ergonomics).

### 1.1 What This Document Defines

1. **System decomposition** — the modules LyriCue introduces, their responsibilities, and their boundaries.
2. **Integration architecture** — exactly where in FreeShow's codebase LyriCue hooks in, and the precise extension points used.
3. **Data architecture** — the timing map schema, sidecar file layout, runtime state model, and IPC payloads.
4. **Control flow** — the data and signal pathways from audio capture through rendering, including fallback transitions.
5. **Architecture Decision Records (ADRs)** — the rationale for each consequential choice, with alternatives considered and rejected.

### 1.2 What This Document Does Not Define

- UI visual design (deferred to UX Spec if produced; otherwise inferred during implementation against PRD acceptance criteria).
- Per-story implementation detail (produced in Phase 3 Epics & Stories).
- Test plans (produced in Phase 4 with the qa-test skill).

### 1.3 Audience

- **Engineers** implementing Phase 4 stories.
- **Reviewers** assessing whether the architecture is sound before code is written (Phase 3 Readiness Check).
- **Future contributors** — both within LyriCue and FreeShow upstream — needing to understand the integration seams.

---

## 2. Architectural Principles

These principles are the lens through which every design decision was filtered. When a trade-off arose, the principle higher in this list won.

### P1: Offline-First, Always
Every live-worship code path must function with the network disconnected. ML models are local. STT is local. Settings are local. Cloud features (community library upload) are clearly delimited as optional. This is non-negotiable — it derives directly from NFR4 and from the target deployment context (rural South African churches with unreliable connectivity).

### P2: Graceful Degradation Over Aggressive Recovery
A worship service is a real-time performance. The system **must not crash** (NFR2.1). When a subsystem fails, the architecture degrades to a simpler tier that still produces useful output rather than retrying aggressively or surfacing technical errors. Three-tier control (Full AI Sync → Timer → Manual) is a structural property, not a feature bolt-on.

### P3: Clean Boundary with FreeShow
LyriCue is a fork-first, upstream-eventually extension (OQ6). To maximize the chance of upstream acceptance and to minimize merge pain during the fork phase, LyriCue code lives in dedicated directories (`src/electron/lyricue/`, `src/frontend/lyricue/`, `src/types/LyriCue.ts`) and touches FreeShow core code only at explicitly enumerated extension points. Every cross-boundary call goes through a narrow, documented seam.

### P4: Process Isolation for Heavy Work
The ML pipeline (Demucs, WhisperX) is computationally heavy, dependency-heavy (Python + PyTorch), and has a high blast radius if it crashes. It runs in a dedicated Python subprocess spawned by the main Electron process and communicates via stdin/stdout JSON-RPC. A sidecar crash takes down song learning, not FreeShow.

### P5: Sidecar Data, Not Schema Mutation
LyriCue data (timing maps, arrangements, settings) lives in sidecar files keyed by Show ID — never inside the `.show` JSON. A user who removes LyriCue must be left with a working FreeShow installation and unbloated show files. This satisfies OQ1's resolved decision and preserves the "FreeShow first, LyriCue optional" contract.

### P6: Reactive Over Imperative for UI
FreeShow is Svelte. Svelte stores already drive the slide renderer reactively. The karaoke renderer follows the same model: a `currentWordIndex` store and a `wordProgress` store update on a `requestAnimationFrame` loop driven by the sync engine, and Svelte components react. No imperative DOM mutation; no parallel render loop.

### P7: Two Time Domains, One Conversion
Internally, all timing is expressed in **reference-track milliseconds** (i.e., as captured during song learning). The sync engine maintains a single conversion function — `liveTime(refTime, tempoRatio, calibrationOffset)` — that maps reference time to live time. Components consume the converted time; they never see tempo math directly. This isolates the tempo logic to one place and makes correction (UJ3) and STT repositioning (FR4) tractable.

### P8: Backwards-Compatible Wire Formats
The timing map schema (`lyricue-timing-v1`) is versioned from day one. Forward compatibility is via additive fields only. Breaking changes require a new schema version and a documented migration. This satisfies NFR6.1 and enables the community library (FR11) without future churn.

### P9: Single-Installer Distribution (Zero IT Burden at the Campus)
The volunteer AV operator persona cannot be asked to install Python, configure environments, or run terminal commands. The installer is a single double-clickable artifact per platform, bundling everything required for both live worship and song learning. This forces the ML sidecar to be PyInstaller-bundled in MVP (not v1.1 as originally drafted) and forces the first-run wizard to handle all configuration. Friction at the install step multiplies across 60 campuses; this principle is the cost ceiling on that friction.

### P10: Multi-Campus Mixed-Mode Equality
Every install must support "follow a central plan" and "do our own thing" with equal first-class fidelity. Neither mode is the default that the other compromises on. A campus must be able to import a central setlist for one week and use its own for the next, with no schema migration or feature gating. This shapes the data model (identity is a tag, not a permission boundary) and the UI (project source is a per-load choice).

### P11: Dual-Mode Deployment (Fork + Sister Service in Parallel)

Research into FreeShow's contribution culture (summarized in ADR-16) revealed that a 10-touchpoint upstream merge is unlikely to land in MVP timeframe. Rather than betting the project on either pure-fork or pure-sister-service, the architecture is designed to support **both deployment modes from one codebase**.

The split point is intentionally narrow: 95% of LyriCue — song learning, sync engine, library manager, settings, audio capture, all data flows — is identical across modes. Only the **OutputAdapter** at the edge differs: in fork mode it renders inside a FreeShow output window; in sister-service mode it renders in LyriCue's own window or drives FreeShow's Captions item via WebSocket.

This is a *tactical hedge*. MVP ships in fork mode for maximum rendering fidelity. In parallel, a small focused PR is proposed upstream to FreeShow proposing a minimal Captions-item extension that would unlock sister-service mode with comparable quality. If the PR lands, the architecture gracefully migrates; if it doesn't, the fork-mode build continues independently and a degraded sister-service mode (without the upstream PR) remains available as a fallback for campuses that prefer it.

The principle here is: **don't get stuck waiting on something that might or might not happen.** Build for the world you control, design for the world you might unlock.

---

## 2.1 Model Stack, Offline Guarantee & Hardware Requirements

This section consolidates three closely-related concerns: what ML actually runs in LyriCue, what guarantees we make about network independence, and what hardware the system targets. These were scattered across the principles, ADRs, and NFR sections in the original draft; centralized here so a reviewer can see the full picture at a glance.

### 2.1.1 What Runs Where — The Full Model Inventory

LyriCue uses five distinct audio-processing components. **None of them is a general-purpose LLM.** None of them talks to a cloud LLM service. All are specialized, narrow ML or DSP models that run entirely on the local machine.

| Component | Task | Type | Where it runs | Size | Origin |
|---|---|---|---|---|---|
| **Demucs** | Separate vocals from instruments | Audio source-separation neural network | Python subprocess (pre-service only) | ~300 MB model | Meta AI (MIT) |
| **WhisperX** | Forced word-level alignment of vocals to known lyrics | Whisper transcription + wav2vec2 alignment | Python subprocess (pre-service only) | ~500 MB–1.5 GB depending on model size | m-bain/WhisperX (BSD-2) |
| **Whisper.cpp** | Live speech recognition for position correction | Speech recognition model (Whisper architecture, C++ port) | Electron renderer process (Node native addon, live) | ~75 MB (`base.en`) | ggerganov/whisper.cpp (MIT) |
| **Meyda** | Spectral features for beat detection | Classical DSP (no ML) | Electron renderer process (live) | ~100 KB library | meyda.io (MIT) |
| **VAD** | Active singing vs. silence | Energy threshold (no ML) | Electron renderer process (live) | Negligible | In-house |

### 2.1.2 No General-Purpose LLM — Explicit Statement

For the avoidance of doubt: LyriCue uses **zero general-purpose Large Language Models** of any kind. Specifically excluded:

- No OpenAI / GPT API calls.
- No Anthropic / Claude API calls.
- No Google Gemini, Cohere, Mistral, or any other cloud LLM service.
- No local LLM runtime — no Ollama, no LM Studio, no llama.cpp, no LocalAI, no `transformers` chat models in the Python sidecar.

The audio ML stack listed in §2.1.1 is the **entire** ML stack. The closest-named tool we use, **Whisper.cpp**, is a speech-recognition runtime; it shares a directory structure and naming convention with llama.cpp but is unrelated — different model, different task, no text generation.

Tasks where an LLM *might* plausibly help (e.g., guessing whether a section is a verse or chorus from its lyrics) are handled by simpler heuristics or deferred to the human operator. This is a deliberate scope decision; the marginal value of LLM-assisted features does not justify the dependency, latency, and (for cloud LLMs) the offline-first principle violation.

### 2.1.3 Offline Guarantee

This is a hardened statement of P1, with an exhaustive list of every potential network call in LyriCue and the conditions under which each fires.

**During live worship, the network usage of LyriCue is exactly zero.** Audio capture, beat detection, VAD, STT, sync engine, and the karaoke renderer all run in-process with no outbound connections.

**Outside live worship, network use is restricted to these explicitly enumerated cases:**

| Surface | When it fires | What it talks to | User-visible? |
|---|---|---|---|
| First-run model download | First time the user starts live sync with STT enabled | Whisper.cpp model mirror (configurable; defaults to a Cloudflare R2 bucket) | Yes — explicit progress bar |
| First-run Demucs/WhisperX model download | First time a song-learning job runs | Demucs/Whisper model mirrors (Hugging Face by default) | Yes — explicit progress bar |
| Library catalog poll | Operator clicks "Check for updates" | Cloudflare R2 bucket (the church's configured library URL) | Yes — manual trigger only (per the manual-pull-only decision) |
| Library bundle download | Operator clicks "Download" on a library entry | Same R2 bucket | Yes — manual trigger |
| Library bundle publish | Operator clicks "Publish" with a write credential configured | Cloudflare Worker (library write endpoint) | Yes — manual trigger |
| Auto-updater (FreeShow's existing electron-updater) | App startup, configurable | FreeShow's release server | Yes — disable-able |

**All other code paths are network-free.** The complete absence of background telemetry, usage analytics, crash reporting, or "phone home" behavior is a deliberate design decision and is verified in Phase 4 testing (a test runs the app with `iptables` blocking all outbound traffic except localhost and confirms full live-sync functionality).

### 2.1.4 Hardware Requirements

Two distinct hardware profiles, because **live worship** (Sunday machine) is dramatically lighter than **song learning** (pre-service machine). Many campuses will use the same machine for both, but the requirements are listed separately so a campus with limited hardware can choose to do song learning on a different machine (e.g., the AV lead's home laptop) and only run live worship on the projection-room computer.

#### Live Worship Machine

| Component | Minimum | Recommended |
|---|---|---|
| CPU | 4-core x64 or arm64 (Intel i5 8th-gen, Ryzen 5 2000-series, Apple M1, or equivalent) | 6-core, post-2020 |
| RAM | 8 GB | 16 GB |
| GPU | Not required | Not required |
| Disk | 2 GB free | 5 GB free |
| OS | Windows 10+, macOS 12+, Ubuntu 22.04+ (or any modern glibc Linux) | Same |
| Audio input | Any system audio device — mic, USB interface, sound desk line-in | Sound desk line-in (cleanest signal) |
| Network | None during worship | None during worship |
| Display | 1080p projector or TV | 1080p+ |

Total runtime overhead vs. baseline FreeShow: ~300–500 MB RAM, ~5% CPU during active sync. Whisper.cpp `base.en` with Metal/SSE acceleration is the single biggest consumer.

#### Song Learning Machine

| Component | Minimum (CPU-only) | Recommended | With GPU |
|---|---|---|---|
| CPU | 4-core | 8-core | 4-core (GPU does the work) |
| RAM | 8 GB | 16 GB | 16 GB |
| GPU | None — CPU fine | None | NVIDIA 6+ GB VRAM, OR Apple Silicon (M1/M2/M3/M4 — Metal acceleration via PyTorch MPS) |
| Disk | 5 GB | 10 GB | 10 GB |
| Time per 5-min song | ~4–5 min | ~2–3 min | ~30–90 sec |

Apple Silicon (M1+) deserves a specific note: PyTorch's MPS backend gives near-GPU performance on the integrated Apple GPU, and Whisper.cpp has native Metal support compiled in by default. An M1 MacBook Pro processes a 5-minute song in ~2 minutes end-to-end — within the "Recommended" column above, no discrete GPU required. The architecture treats M1+ Macs as a first-class platform, not a degraded one.

#### What Is Not Required

For both machine profiles:

- **No CUDA / NVIDIA drivers** unless the user happens to have an NVIDIA GPU and wants the speedup (it's a free win, not a requirement).
- **No Docker** — the Python sidecar is a PyInstaller-bundled executable, not a container.
- **No separate Python installation** — Python is bundled inside the sidecar executable.
- **No Ollama, LM Studio, llama.cpp, or any LLM runtime.**
- **No internet during worship.** Internet is needed only for one-time model downloads (~875 MB total: 300 MB Demucs + 500 MB WhisperX + 75 MB Whisper.cpp) and for optional library sync.

### 2.1.5 PyInstaller Bundling — MVP Requirement

The original draft scoped PyInstaller bundling to v1.1 as a polish item. With the 60-campus zero-config install requirement (P9), this moves into MVP. The architectural implications:

- The Python sidecar is built per-platform-per-arch using PyInstaller and shipped as an extra resource inside the Electron app. Build matrix: macOS arm64, macOS x86_64, Windows x86_64, Linux x86_64, Linux arm64. (Linux arm64 supports Raspberry Pi 4/5 and similar — useful for cheap dedicated worship machines.)
- electron-builder's `extraResources` configuration includes the platform-specific sidecar binary.
- App installer size grows from ~200 MB to ~700–900 MB depending on platform. This is acceptable: it's a one-time download per campus, downloadable on any network, and well under the size of typical macOS/Windows app installers in 2026.
- The Sidecar Controller (SC, §4.2) no longer attempts to resolve `python3` on the user's PATH; instead it launches the bundled sidecar executable from `app.getAppPath() + '/resources/sidecar/'`. The "Python not found" error path is removed.

This change is fully reflected in ADR-2 (amended) and ADR-14 (new).

---

## 3. System Overview

### 3.1 Context Diagram

```
                  ┌─────────────────────────────────────────┐
                  │           FreeShow Application          │
                  │     (Electron main + renderer)          │
                  │                                         │
                  │  ┌────────────────────────────────────┐ │
                  │  │  FreeShow Core (unchanged)         │ │
                  │  │  - Show data (.show files)         │ │
                  │  │  - Output BrowserWindows           │ │
                  │  │  - Settings store                  │ │
                  │  │  - Projects (setlists)             │ │
                  │  └────────────────────────────────────┘ │
                  │             ▲          ▲                │
                  │             │ extends  │ extends        │
                  │  ┌──────────┴──────────┴───────────┐    │
                  │  │  LyriCue Modules            │    │
                  │  │  (clean-boundary integration)   │    │
                  │  └─┬────────────┬────────────┬────┘    │
                  │    │            │            │          │
                  │    ▼            ▼            ▼          │
                  │  Sync       Karaoke      Settings &     │
                  │  Engine     Renderer     UI Panels      │
                  │  (JS)       (Svelte)     (Svelte)       │
                  │    │            ▲                       │
                  └────┼────────────┼───────────────────────┘
                       │ IPC        │ IPC
                       │ JSON-RPC   │ OUTPUT channel
                       ▼            │
              ┌────────────────┐    │
              │ Python Sidecar │    │
              │ (child_process)│    │
              │                │    │
              │ - Demucs       │    │
              │ - WhisperX     │    │
              │ - Librosa      │    │
              └────────────────┘    │
                                    ▼
                  ┌─────────────────────────────────┐
                  │   Karaoke Output BrowserWindow  │
                  │   (new output type)             │
                  └─────────────────────────────────┘

External I/O:
  Audio In  ──→ Sync Engine (mic / line-in via Web Audio API)
  Audio In  ──→ Whisper.cpp STT (parallel tap)
  Audio File ──→ Python Sidecar (song learning input)
  .show files  ↔ FreeShow Core
  .timing.json ↔ LyriCue Storage (sidecar to .show)
```

### 3.2 Module Inventory

LyriCue introduces ten functional modules. Each maps to one or more PRD functional requirements (FR1–FR11). The two-letter prefix identifies the module in all subsequent diagrams and code references.

| Code | Module | Process | Primary FRs | Responsibility (one-liner) |
|---|---|---|---|---|
| **SL** | Song Learning Pipeline | Python sidecar + Electron main | FR1, FR8 | Audio + lyrics → word-level timing map |
| **SC** | Sidecar Controller | Electron main | FR1 | Spawn / manage / message the Python subprocess |
| **TM** | Timing Map Storage | Electron main | FR1.7, FR11.8 | Read/write/version `.timing.json` sidecar files |
| **AI** | Audio Input Capture | Electron renderer (main window) | FR3.1 | Enumerate devices; capture live audio stream |
| **BD** | Beat & Tempo Detection | Electron renderer (Web Audio + Meyda) | FR3.2, FR3.3, FR3.4 | Live BPM estimation; tempo ratio computation |
| **VAD** | Voice Activity Detection | Electron renderer | FR3.9, FR3.10 | Detect singing vs. silence/speech |
| **ST** | STT Position Correction | Electron renderer (Whisper.cpp addon) | FR4 | Background STT; fuzzy match; reposition cursor |
| **SE** | Sync Engine (Core) | Electron renderer | FR3, FR5 | Maintain playback cursor; apply tempo; fire word events; manage tier transitions |
| **KR** | Karaoke Renderer | Electron renderer (output window) | FR2, FR10 | Render lyrics with word-level highlighting |
| **WS** | LyriCue UI Shell | Electron renderer (main window) | FR5.7, FR6, FR7, FR8, FR9 | Settings panel, setlist control panel, learn-song wizard, arrangement builder, rehearsal mode UI |
| **LM** | Library Manager (multi-campus distribution) | Electron main + renderer | FR11, multi-campus distribution | Catalog poll, bundle download/import, bundle publish, signature verification, central-vs-local provenance |

Two cross-cutting concerns are not modules but design properties:

- **Channels** — a single new IPC channel `LYRICUE` registered alongside FreeShow's existing channels (`OUTPUT`, `MAIN`, etc.), with a typed message enum (`WSMain`, `WSOutput`).
- **State** — Svelte stores in `src/frontend/lyricue/stores.ts` for sync state, current word, current section, control tier, and UI state.

### 3.3 Process Model

LyriCue runs across three processes:

| Process | Provided By | What Runs Here |
|---|---|---|
| **Electron main** | FreeShow | Sidecar Controller (SC), Timing Map Storage (TM), IPC routing, child_process management |
| **Electron renderer (main window)** | FreeShow | UI Shell (WS), Audio Input Capture (AI), Beat Detection (BD), VAD, STT (ST), Sync Engine (SE) |
| **Electron renderer (karaoke output)** | FreeShow | Karaoke Renderer (KR) only |
| **Python subprocess (spawned on demand)** | LyriCue | Song Learning Pipeline (SL) — Demucs + WhisperX + Librosa |

The sync engine **must live in the main window renderer**, not the output renderer. Reason: it owns the per-frame cursor advance and arbitrates between audio sources, VAD, STT, and operator input. It pushes per-frame word state to the karaoke output via the OUTPUT IPC channel (existing FreeShow infrastructure). The output window is a dumb renderer.

The Python sidecar is **on-demand**: spawned when a user starts song learning or rehearsal mode, killed when the operation completes. It is not a persistent process. Rationale: ML models consume hundreds of MB of RAM; keeping the sidecar resident during live worship adds memory pressure for zero benefit (song learning is not done live).

#### Deployment Mode and Output Adapter

Per P11 (dual-mode deployment), the process diagram above shows the **fork-mode** topology where LyriCue code runs inside FreeShow's process tree. In **sister-service mode**, LyriCue runs as a separate Electron application that communicates with FreeShow via FreeShow's existing external APIs (REST, WebSocket, Companion). The Python sidecar and renderer processes still belong to LyriCue; the difference is that FreeShow becomes an external process LyriCue drives, rather than the host LyriCue runs inside.

The single point of architectural divergence is the **OutputAdapter** — the interface that the Sync Engine (SE) pushes per-frame state through to reach the projector. Three implementations exist, selected at runtime by configuration:

| Adapter | Mode | How output reaches the projector |
|---|---|---|
| `ForkOutputAdapter` | Fork (Option A) | KR renders inside a FreeShow output BrowserWindow; SyncFrames sent via FreeShow's OUTPUT IPC channel |
| `OwnWindowOutputAdapter` | Sister service, no upstream PR (Option B fallback) | KR renders inside a LyriCue-owned Electron BrowserWindow projected directly; FreeShow is unused for output |
| `CaptionInjectionOutputAdapter` | Sister service, upstream PR landed (Option C target) | Per-frame word state is sent to FreeShow's Captions item via WebSocket; FreeShow renders the words; an extension flag enables per-word highlighting |

Every other module is mode-agnostic. This isolation is the central reason the dual-mode strategy is feasible — see ADR-16 for the full rationale.

### 3.4 Build & Distribution

LyriCue is a fork of FreeShow (per OQ6). Build pipeline is FreeShow's existing Vite + Electron-builder setup, unchanged. LyriCue code is colocated in the source tree:

```
freeshow/  (fork)
├── src/
│   ├── electron/
│   │   ├── (existing FreeShow main-process code)
│   │   └── lyricue/         ← NEW
│   │       ├── SidecarController.ts
│   │       ├── TimingMapStorage.ts
│   │       ├── ipc.ts
│   │       └── index.ts
│   ├── frontend/
│   │   ├── (existing FreeShow renderer code)
│   │   └── lyricue/         ← NEW
│   │       ├── components/
│   │       │   ├── KaraokeOutput.svelte
│   │       │   ├── LearnSongWizard.svelte
│   │       │   ├── ArrangementBuilder.svelte
│   │       │   ├── SetlistPanel.svelte
│   │       │   ├── SettingsTab.svelte
│   │       │   └── ModeIndicator.svelte
│   │       ├── engine/
│   │       │   ├── SyncEngine.ts
│   │       │   ├── BeatDetection.ts
│   │       │   ├── VAD.ts
│   │       │   ├── STTAdapter.ts
│   │       │   └── tempo.ts
│   │       ├── stores.ts
│   │       └── index.ts
│   └── types/
│       ├── (existing FreeShow types)
│       └── LyriCue.ts       ← NEW
└── python-sidecar/              ← NEW (separate dist artifact)
    ├── lyricue_sidecar/
    │   ├── __main__.py
    │   ├── pipeline.py
    │   ├── demucs_step.py
    │   ├── whisperx_step.py
    │   └── rpc.py
    ├── pyproject.toml
    └── requirements.txt
```

MVP distributes the Python sidecar as a system-Python requirement (Python 3.10+, pip-installable). v1.1+ bundles via PyInstaller (per OQ3).

---

## 4. Component Design

This section gives a detailed design for each of the ten modules. For each module: responsibility, public interface, internal structure, key implementation notes, and PRD requirement traceability.

### 4.1 SL — Song Learning Pipeline

**Responsibility:** Given an audio file (MP3/WAV/FLAC/OGG) and the song's lyrics (already structured into sections in the FreeShow `.show` file), produce a word-level timing map JSON conforming to schema `lyricue-timing-v1`.

**Process boundary:** Runs entirely inside the Python subprocess. The subprocess is spawned by SC (Sidecar Controller); SL has no direct knowledge of FreeShow.

**Pipeline stages:**

```
Audio File ──┐
             ▼
        [1. Decode]  ── librosa.load (resample to 16 kHz mono for downstream)
             │
             ▼
       [2. Demucs vocal isolation]  ── htdemucs model; output isolated vocal WAV
             │
             ▼
       [3. WhisperX alignment]  ── faster-whisper transcribe + wav2vec2 align
             │                       against provided lyrics text (forced alignment mode)
             ▼
       [4. BPM detection]  ── librosa.beat.tempo on the original mix (not vocals)
             │
             ▼
       [5. Section mapping]  ── map aligned words to slide groups from input
             │                   (FR1.5 auto-detect heuristic + FR1.6 manual override path)
             ▼
       [6. Timing map assembly]  ── emit JSON to stdout per JSON-RPC protocol
```

**Inputs (JSON-RPC `learn_song` request):**
```json
{
  "method": "learn_song",
  "params": {
    "jobId": "uuid",
    "audioPath": "/abs/path/to/audio.mp3",
    "lyrics": [
      { "sectionId": "verse1", "label": "Verse 1", "slideIndex": 0, "text": "..." },
      { "sectionId": "chorus", "label": "Chorus",  "slideIndex": 1, "text": "..." }
    ],
    "options": {
      "demucsModel": "htdemucs",
      "whisperxModel": "small",
      "language": "en"
    }
  }
}
```

**Progress events (JSON-RPC notifications, FR1.8):**
```json
{ "method": "progress", "params": { "jobId": "uuid", "stage": "isolating", "percent": 35 } }
{ "method": "progress", "params": { "jobId": "uuid", "stage": "aligning",  "percent": 60 } }
{ "method": "progress", "params": { "jobId": "uuid", "stage": "detecting", "percent": 90 } }
```

**Output (JSON-RPC `learn_song` response):** Conforms to `lyricue-timing-v1` schema (Section 6.1).

**Failure modes & handling (FR1.13, NFR2.5):**

| Failure | Handling |
|---|---|
| Audio decode error | RPC error response with code `AUDIO_DECODE_FAILED`. SC logs, surfaces to UI. Song remains usable in manual mode. |
| Demucs CUDA OOM (if GPU available) | Retry on CPU. If still fails, error `VOCAL_ISOLATION_FAILED`. |
| WhisperX no-vocal-detected | Error `NO_VOCALS_DETECTED`. Common cause: instrumental track or extremely poor recording quality. |
| WhisperX alignment confidence too low | Emit map with `confidence` field on each word; UI may surface a warning but ship the map. |
| Subprocess crash mid-job | SC detects via process exit code; UI surfaces "Song learning crashed — try again or use manual mode". |
| Lyrics drift (recording has different words than provided lyrics) | WhisperX aligns as best it can; unmatched words flagged in output with `confidence: null`. UI shows them as needing review (FR8.9). |

**Rehearsal mode (FR8):** Same pipeline. The rehearsal mode UI captures audio from the live input device into a temp WAV (via the audio capture module AI), then passes the file path to `learn_song`. Multi-song segmentation (FR8.6) is a pre-stage: a `segment_rehearsal` RPC method that uses silence detection (`librosa.effects.split` with energy threshold) to split the recording, then matches each segment to a song via lyric fingerprinting (TF-IDF over the lyrics for each song in the setlist; pick highest match per segment).

**PRD traceability:** FR1.1, FR1.2, FR1.3, FR1.4, FR1.5, FR1.6 (manual override happens in UI, not the pipeline — but the pipeline's output must support boundary editing), FR1.7, FR1.8, FR1.13, FR8.4, FR8.6, FR8.9.

### 4.2 SC — Sidecar Controller

**Responsibility:** Lifecycle and messaging layer for the Python sidecar subprocess. The only module in LyriCue that calls `child_process.spawn`.

**Location:** `src/electron/lyricue/SidecarController.ts`

**Public interface:**

```typescript
export class SidecarController {
  // Spawns the subprocess if not already running.
  // Throws if Python is not available, with a structured error code.
  async ensureRunning(): Promise<void>

  // Sends a JSON-RPC request, returns a promise for the response.
  // Emits progress events via the optional onProgress callback.
  async request<TResult>(
    method: string,
    params: object,
    options?: { onProgress?: (p: ProgressEvent) => void; timeoutMs?: number }
  ): Promise<TResult>

  // Kills the subprocess. Called on app shutdown or after a job completes if no other job is queued.
  async shutdown(): Promise<void>

  // Observable status for UI.
  readonly status: 'idle' | 'starting' | 'running' | 'crashed'
}
```

**Wire protocol:** Newline-delimited JSON-RPC 2.0 over the subprocess's stdin (Electron → Python) and stdout (Python → Electron). Stderr is captured and forwarded to FreeShow's logging via the LOG channel for diagnosis.

Why JSON-RPC 2.0 specifically:
- Standardized request/response correlation via `id`.
- Standardized error format with `code` + `message` + optional `data`.
- Notifications (no `id`) are the natural fit for progress events (one request, many notifications, one response).
- Mature implementations in both ecosystems.

**Python availability check (NFR5.4, MVP requirement per OQ3):**

On `ensureRunning()`, if no subprocess exists:
1. Resolve the Python interpreter: settings override → `python3` on PATH → `python` on PATH.
2. Spawn with `--version` to check ≥3.10. If fail, throw `PYTHON_NOT_FOUND` or `PYTHON_VERSION_TOO_OLD`.
3. Spawn the sidecar with `-m lyricue_sidecar`. Wait for `{"method": "ready"}` notification within 30 seconds. If not received, throw `SIDECAR_FAILED_TO_START`.
4. Verify model files are present (Demucs + WhisperX) by issuing a `check_models` RPC. If missing, surface to UI with installation instructions.

The UI surfaces these failures in plain language (NFR5.4) with copy like "Python 3.10 or later is required for song learning. [Setup guide]".

**Concurrency:** One subprocess. One active job at a time. Queueing of multiple `learn_song` requests is handled in the controller, not the subprocess. Rationale: ML jobs are CPU-bound and parallel jobs would each slow the other down, so serial execution gives better wall-clock total time and avoids GPU memory contention.

**PRD traceability:** FR1 (entire pipeline), NFR2.5 (crash recovery), NFR5.4 (plain-language errors).

### 4.3 TM — Timing Map Storage

**Responsibility:** Persist, load, version, export, and import timing map sidecar files. Single source of truth for everything timing-map-shaped on disk.

**Location:** `src/electron/lyricue/TimingMapStorage.ts`

**Storage layout:** Inside FreeShow's user data directory (`app.getPath('userData')`):

```
<userData>/
├── shows/                          (existing FreeShow)
│   ├── <showName>.show
│   └── ...
└── lyricue/                    ← NEW
    ├── timing-maps/
    │   └── <showId>.timing.json
    ├── arrangements/
    │   └── <showId>.arrangements.json
    ├── rehearsals/                 (transient; user can clear — FR8.8)
    │   └── <recordingId>.wav
    └── settings.json               (LyriCue-specific settings)
```

**Why `<showId>` not `<showName>`:** Show names can be renamed by the user; show IDs are stable. The `.show` file already keys data by ID internally, so matching this convention.

**Pointer in `.show`:** TM writes a lightweight pointer into the Show's `meta` field on first save:

```typescript
show.meta.lyricue = {
  hasTimingMap: true,
  schemaVersion: '1',
  updatedAt: '2026-05-13T14:00:00Z'
}
```

This pointer is the only modification LyriCue makes to FreeShow's `.show` files. It is fully optional — FreeShow ignores unknown `meta` fields, and stripping `lyricue` from `meta` does not break the show.

**Public interface:**

```typescript
export class TimingMapStorage {
  async load(showId: string): Promise<TimingMap | null>
  async save(showId: string, map: TimingMap): Promise<void>
  async delete(showId: string): Promise<void>
  async exists(showId: string): Promise<boolean>

  async export(showId: string, destPath: string): Promise<void>  // FR11.1 — .wstiming bundle
  async import(srcPath: string): Promise<{ showId: string; map: TimingMap }>  // FR11.2

  async loadArrangements(showId: string): Promise<Arrangement[]>
  async saveArrangements(showId: string, arrangements: Arrangement[]): Promise<void>
}
```

**Write strategy:** Write-to-temp + atomic rename. Prevents corruption if the process dies mid-write (an unacceptable failure during live worship per NFR2.1).

```typescript
async save(showId, map) {
  const finalPath = this.pathFor(showId)
  const tempPath = `${finalPath}.tmp`
  await fs.writeFile(tempPath, JSON.stringify(map, null, 2))
  await fs.rename(tempPath, finalPath)  // atomic on POSIX, near-atomic on Windows
}
```

**Schema versioning:** Every file includes `"$schema": "lyricue-timing-v1"`. On load, TM inspects the schema; if it's a known older version, migrate forward; if unknown, refuse to load and surface an error. Migrations are pure functions in `src/electron/lyricue/migrations/`.

**Export bundle (`.wstiming` file, FR11.1, FR11.8):** A ZIP archive containing:
```
manifest.json     (metadata: schema version, song title, artist, BPM, language, anon optional)
timing.json       (the timing map; NOT the source audio)
lyrics.txt        (the lyrics as text — for matching against importer's show)
```

ZIP because (a) extensible, (b) compresses well for the small JSON payloads, (c) widely toolable. Filename convention: `<sanitized-title>-<bpm>bpm.wstiming`. The audio file is **never** included — distribution rights for the source recording belong to the user, not to us.

**PRD traceability:** FR1.7, FR11.1, FR11.2, FR11.8, FR11.9 (version field in manifest), NFR2.1 (atomic writes), NFR6.1 (versioned schema).

### 4.4 AI — Audio Input Capture

**Responsibility:** Enumerate available system audio input devices, present them to the operator, capture a continuous PCM stream from the selected device, and distribute it to consumers (BD, VAD, STT, and rehearsal recording).

**Location:** `src/frontend/lyricue/engine/AudioInput.ts` + small Svelte device-picker component.

**Why renderer not main:** Web Audio API + MediaStream are renderer-process capabilities in Electron. Going through main would require IPC for every PCM frame — needless latency and overhead.

**Capture chain:**

```
navigator.mediaDevices.enumerateDevices()  → list of audioinput devices
       │
       ▼
navigator.mediaDevices.getUserMedia({ audio: { deviceId } })
       │
       ▼
AudioContext (sampleRate: 48000)
       │
       ▼
MediaStreamAudioSourceNode
       │
       ├──→ AnalyserNode               (→ BD: beat detection)
       ├──→ AudioWorkletNode (VAD)     (→ VAD: voice activity)
       └──→ ScriptProcessorNode/Worklet (→ STT: 16kHz PCM chunks to Whisper.cpp)
                                       (→ Rehearsal record: float32 → WAV)
```

**Device enumeration UX:** Operator picks a device from a dropdown in the Setlist Panel before starting sync. Last-used device persists in LyriCue settings (FR3.1). Device labels require microphone permission — request once at first launch.

**Sample rate negotiation:** Web Audio API will resample to the AudioContext's rate. We use 48 kHz internally (matches most sound desks) and downsample to 16 kHz only for the STT branch (whisper.cpp expects 16 kHz).

**Handling device disconnect (NFR2.4):** Listen for `MediaStreamTrack.onended`. On fire: emit `audioInputLost` event, sync engine transitions to Timer tier within 3 seconds, UI surfaces "Audio input disconnected — switched to timer mode".

**PRD traceability:** FR3.1, NFR2.4, NFR3.3.

### 4.5 BD — Beat & Tempo Detection

**Responsibility:** From the live audio stream, produce a continuously updated estimate of the live BPM. Compute a tempo ratio against the reference BPM. Emit beat events.

**Location:** `src/frontend/lyricue/engine/BeatDetection.ts`

**Library:** Meyda (selected over Essentia.js — see ADR-5). Specifically `Meyda.createMeydaAnalyzer` with features `["rms", "energy", "spectralCentroid", "spectralFlux"]`.

**Two-stage tempo estimation:**

1. **Onset detection** — spectral flux peaks identify candidate beats. Threshold is adaptive (running median of recent flux values × 1.5).
2. **Tempo estimation** — autocorrelation over the inter-onset intervals (IOIs) of the last ~8 seconds. Pick the dominant period; convert to BPM. Smooth with an exponential moving average (α=0.2) to avoid jitter (NFR1.4: ≤200ms detection latency; we accept 1–2 second BPM smoothing window).

**Tempo ratio (FR3.4):**

```typescript
function tempoRatio(liveBPM: number, referenceBPM: number): number {
  if (!liveBPM || !referenceBPM) return 1.0
  const raw = liveBPM / referenceBPM
  return clamp(raw, 0.7, 1.4)  // reject implausible ratios as detection error
}
```

Hard clamping rejects edge cases (e.g., a snare hit doubling the detected BPM). Outside the clamp range, the engine treats the ratio as `1.0` and logs a warning.

**Beat events vs. continuous time:** The sync engine consumes the smoothed BPM ratio, not individual beat events, for its time math (see SE in §4.8). Beat events are exposed only for diagnostics and post-MVP click track features.

**Confidence signal (used by SE for tier transition, FR5.5):** BD emits a `confidence` score in [0,1] based on the variance of recent IOIs (low variance = consistent tempo = high confidence). Confidence below 0.4 for >10 seconds triggers degradation from AI Sync to Timer.

**PRD traceability:** FR3.2, FR3.3, FR3.4, FR3.7, FR3.8, FR5.5.

### 4.6 VAD — Voice Activity Detection

**Responsibility:** Determine in real time whether the live audio contains singing/music (engage sync) or silence/speech (hold display).

**Location:** `src/frontend/lyricue/engine/VAD.ts`

**Approach:** Energy-based VAD with two thresholds (Schmitt-trigger style to prevent flicker):

- RMS above `enterThreshold` for ≥300 ms → state = `active`.
- RMS below `exitThreshold` for ≥1500 ms → state = `silent`.

Default thresholds calibrated against typical sound-desk line levels; adjustable in settings. The longer silence window is intentional — worship music often has soft passages; we want to hold display through them, not transition to silent mode.

**Distinguishing speech from singing:** Energy-only VAD cannot reliably do this. For MVP we accept a simpler heuristic: if STT (ST) recognizes coherent words that do **not** match any line in the current song's lyrics, we treat that as speech and hold. (See ST in §4.7.) This is good enough for the "leader pauses to pray" case (UJ2 step 8).

**PRD traceability:** FR3.9, FR3.10.

### 4.7 ST — STT Position Correction

**Responsibility:** Run a local STT model on the live audio in the background, fuzzy-match recognized phrases against the song lyrics, and reposition the sync cursor when a clear mismatch is detected (UJ2 step 7, UJ3 unwanted-section case).

**Location:** `src/frontend/lyricue/engine/STTAdapter.ts`

**STT engine:** Whisper.cpp via Node.js native addon (per OQ4 resolution). Model: `base.en` (~75 MB) for English worship. Multilingual support (post-MVP) uses `base` (multilingual) at ~75 MB.

**Why native addon, not WebAssembly:** Whisper.cpp has both options. Native addon is meaningfully faster (no WASM overhead on CPU-bound matrix math) and Electron supports native modules cleanly. The size cost is per-platform addon binaries, which Electron-builder already handles for FreeShow's other native deps.

**Streaming architecture:**

```
Audio Worklet (16 kHz PCM) ──→ ring buffer (5 seconds) ──→ Whisper.cpp transcribe()
                                                          ↓
                                                    recognized text chunks
                                                          ↓
                                                    Phrase Matcher  ←── song lyrics index
                                                          ↓
                                                    PositionCorrection event
                                                          ↓
                                                          SE
```

Whisper.cpp is called every ~2 seconds with the 5-second rolling window. The 3-second overlap accommodates phrase boundaries.

**Phrase matcher:** For each song, pre-build an index keyed by all 3-word phrases in the lyrics, mapping each to `(sectionId, slideIndex, charOffset)`. On each STT result, extract 3-word phrases, look up in the index. A match requires:
- ≥3 consecutive words match (FR4.6 — debouncing against single-word matches)
- Match confidence (Levenshtein-based) ≥ 0.75 per word

When a match is found at a section different from the current cursor section, emit a `correctPosition(toSlideIndex, toWordOffset)` event to SE.

**Why fuzzy on the matching side:** Whisper.cpp is not perfect on sung audio. Allowing edit distance on individual words (e.g., "you're" → "your") avoids false negatives while the 3-word consecutive requirement prevents false positives.

**Repeats handling (FR4.5):** A phrase like "How great is our God" likely appears in the chorus 3+ times. The matcher returns all matches and SE picks the one with the smallest forward jump from the current cursor (i.e., assume the leader is going forward to the next chorus instance, not back to the first).

**Logging (FR4.7):** Every position correction is logged (timestamp, from→to, recognized text, confidence) to `<userData>/lyricue/logs/positions-<date>.jsonl` for post-service review and tuning. Retention: 30 days, rolling.

**Performance budget:** Whisper.cpp `base.en` on 5-second audio on a 4-core CPU is ~300–800 ms wall-clock. Running every 2 seconds gives headroom. If we ever fall behind (queue depth >2), drop the oldest pending request to avoid drift.

**PRD traceability:** FR4 (all sub-requirements), NFR1.5 (≤1 second latency — met with 2 second cadence + processing time).

### 4.8 SE — Sync Engine (Core)

**Responsibility:** The brain. Owns the playback cursor. Consumes inputs from BD, VAD, ST, and operator (keyboard/UI). Produces a stream of per-frame `(currentSlideIndex, currentWordIndex, wordProgress)` state. Manages tier transitions (Auto / Timer / Manual).

**Location:** `src/frontend/lyricue/engine/SyncEngine.ts`

**Internal state:**

```typescript
interface SyncEngineState {
  tier: 'auto' | 'timer' | 'manual'
  songStartTime: number | null            // wall-clock time when sync engaged for this song
  cursorRefTime: number                   // current position in reference-track ms
  tempoRatio: number                      // live BPM / reference BPM
  beatConfidence: number                  // from BD
  vadState: 'active' | 'silent'           // from VAD
  currentSlideIndex: number
  currentWordIndex: number
  wordProgress: number                    // 0..1 within the current word's duration
  lastManualInterventionAt: number | null // for debounce
  positionCorrectionPendingMs: number | null
}
```

**Per-frame update (driven by `requestAnimationFrame` for smooth highlight; target ≥30 fps per NFR1.3):**

```typescript
function tick(now: number) {
  if (state.tier === 'manual') {
    // no auto-advance
    requestAnimationFrame(tick)
    return
  }

  // VAD gate (FR3.9)
  if (state.vadState === 'silent') {
    requestAnimationFrame(tick)
    return  // hold display
  }

  // Compute new reference-track time
  const wallElapsed = now - state.lastTickWallTime
  const deltaRefMs = wallElapsed * (state.tier === 'auto' ? state.tempoRatio : 1.0)
  state.cursorRefTime += deltaRefMs

  // Lookup word at cursorRefTime in the active timing map
  const { slideIndex, wordIndex, progress } = lookupWord(state.cursorRefTime, activeTimingMap)
  updateStores(slideIndex, wordIndex, progress)

  // Tier transition checks (debounced)
  if (state.tier === 'auto' && state.beatConfidence < 0.4) {
    state.lowConfidenceDuration += wallElapsed
    if (state.lowConfidenceDuration > 10_000) degradeToTimer()
  } else {
    state.lowConfidenceDuration = 0
  }

  state.lastTickWallTime = now
  requestAnimationFrame(tick)
}
```

**Position correction (from ST, FR4.3):**

```typescript
function applyPositionCorrection(toSlideIndex: number, toWordOffset: number) {
  // Animate the cursor jump over 300 ms (FR4.4 — smooth, not glitchy)
  const targetRefTime = timingMapLookup(toSlideIndex, toWordOffset).startMs
  const startRefTime = state.cursorRefTime
  animate(targetRefTime, startRefTime, 300, (interpolated) => {
    state.cursorRefTime = interpolated
  })
}
```

**Manual override (FR3.6 start, FR5.1 next/prev/manual-toggle, FR3.4 start-sync):**

```typescript
function onNextSection() {
  const next = findNextSlideStart(state.cursorRefTime, activeTimingMap)
  state.cursorRefTime = next.startMs
  state.lastManualInterventionAt = performance.now()
  // FR5.3: sync engine pauses re-engagement for `manualOverrideDebounceSeconds` (default 3s)
}
```

After a manual intervention, position corrections from ST are suppressed for the debounce window. Beat tracking continues to update tempo ratio in the background — the cursor just freezes its position-correction acceptance.

**Tier transitions (FR5.4–5.6):**

```
       ┌──────────┐        ┌──────────┐        ┌──────────┐
       │   AUTO   │ ─────► │  TIMER   │ ─────► │  MANUAL  │
       └──────────┘        └──────────┘        └──────────┘
            ▲                   │   ▲                 │
            │                   │   │                 │
            └───────────────────┘   └─────────────────┘

Auto → Timer:    beatConfidence < 0.4 for >10s        (FR5.5)
                 OR audio input lost                  (NFR2.4)
                 OR user forces it                    (FR5.8)

Timer → Manual:  cursor drift exceeds threshold       (FR5.6)
                 OR user forces it                    (FR5.8)

Any → previous tier:  user re-engages explicitly       (FR3.6, FR5.8)
```

The current tier is published to a Svelte store consumed by the Mode Indicator UI (FR5.7, always visible per AC3.5).

**Song boundary handling (FR3.11, FR7.3):**

When `cursorRefTime` exceeds the final word's `endMs` of the active map, the engine:
1. Emits `songComplete` event.
2. Loads the next song's timing map from the active Project.
3. Enters `waitingForStart` state — display shows the first section of the next song, no advancement until VAD goes active (FR7.4).
4. On VAD active, calls `startSync()` to engage on the new song.

**Time domain conversion (P7):** All internal state uses **reference-track time**. The conversion to wall-clock is encapsulated in `tick()`. Components downstream (KR) consume `currentWordIndex` and `wordProgress` — they never see milliseconds.

**PRD traceability:** FR3 (entire), FR4.3, FR4.4, FR4.6, FR5 (entire), FR7.3, FR7.4, NFR1.3, NFR1.6.

### 4.9 KR — Karaoke Renderer

**Responsibility:** Render the current slide with word-level highlighting. Lives in the karaoke output BrowserWindow.

**Location:** `src/frontend/lyricue/components/KaraokeOutput.svelte` (the top-level component for the karaoke output window) + child components.

**Rendering model:** A Svelte component subscribed to:
- `activeTimingMap` store (the song currently displayed)
- `currentSlideIndex`, `currentWordIndex`, `wordProgress` stores (updated per-frame by SE)
- `karaokeStyle` store (color, font, lead time, sweep type — from settings, FR4.3–4.4)
- `parallelLyrics` store (post-MVP / FR10 — secondary language)

**DOM structure for a slide:**

```svelte
{#each currentSlide.lines as line, lineIndex}
  <div class="line" class:active={lineIndex === activeLineIndex}>
    {#each line.words as word, wordIndex}
      <span
        class="word"
        class:sung={isPastWord(wordIndex, currentWordIndex)}
        class:active={wordIndex === currentWordIndex}
        class:upcoming={wordIndex > currentWordIndex}
        style="--progress: {wordIndex === currentWordIndex ? wordProgress : (wordIndex < currentWordIndex ? 1 : 0)}"
      >{word.text}</span>
    {/each}
  </div>
{/each}
{#if nextSectionPreview}
  <div class="next-section-preview">{nextSectionPreview.firstLine}</div>
{/if}
```

**Sweep animation (FR2.3):**

```css
.word {
  background: linear-gradient(
    to right,
    var(--highlight-color) calc(var(--progress) * 100%),
    var(--unsung-color) calc(var(--progress) * 100%)
  );
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
}
```

The CSS custom property `--progress` is updated 30+ times per second by the engine; the browser handles the visual sweep via GPU compositing. No per-frame JS DOM manipulation — Svelte updates the inline style, CSS does the rest. This is essential for the 30 fps target (NFR1.3).

**Held-note pulse (FR2.6):**

Detect held notes during timing map assembly: any word with `endMs - startMs > 800ms` gets a `held: true` flag in the timing map. KR adds a `held` class to that word; CSS plays a 1.2s `pulse` animation while progress is between 0.2 and 0.95.

**Line transitions (FR2.7):** When the current line index changes, the new line slides up from below with a 250 ms transform, the previous line fades to 30% opacity. Pure Svelte transitions (`transition:fly`).

**Section transitions with lead time (FR2.8):** SE emits a `sectionApproaching(nextSection, msUntilStart)` event when the cursor enters the last `leadTimeSeconds` of a section. KR begins fading the next section's first line into view at the bottom over that lead window, so it's already visible when the section transition triggers.

**Resolution adaptation (FR2.11):** The output container uses `vmin`-based font sizes with a min/max clamp, plus FreeShow's existing autosize logic (where applicable). The renderer detects ultrawide aspect ratios and switches to a horizontal-pan layout if line length exceeds container width.

**Parallel lyrics (FR10):** Optional second-language track. When enabled, KR renders two stacked containers:
- Primary: word-level highlighting as above.
- Secondary: full-section advance only (FR10.4 — no word-level on the translation), font size auto-scaled (FR10.8 — 60% of primary if 2 languages, 50% if 3).

**Mounting in the Karaoke Output window:** See §7.2 for how the new output type is registered with FreeShow's output system (fork mode), and §7.8 for the sister-service mode variants.

#### OutputAdapter Interface

To support dual-mode deployment (P11) without forking KR into separate implementations, the rendering output path is abstracted behind an `OutputAdapter` interface. SE pushes SyncFrames through the adapter; the adapter decides how those frames reach the projector.

```typescript
// src/types/LyriCue.ts (continued)
export interface OutputAdapter {
  readonly mode: 'fork' | 'own-window' | 'caption-injection'

  // Lifecycle — start/stop the rendering surface
  start(opts: { outputId: string; bounds?: Rect }): Promise<void>
  stop(): Promise<void>

  // Per-frame state push (called by SE at ~60 Hz)
  pushSyncFrame(frame: SyncFrame): void

  // Active song change
  loadTimingMap(map: TimingMap, arrangement?: Arrangement, parallel?: ParallelLyricsTrack[]): void

  // Diagnostics
  readonly health: AdapterHealth   // last-frame-delivered timestamp, error counters
}
```

The three implementations:

**1. `ForkOutputAdapter`** — KR is mounted as a Svelte component inside a FreeShow `BrowserWindow` flagged with `karaokeMode: true`. SyncFrames travel over FreeShow's existing OUTPUT IPC channel as `WS_SYNC_FRAME` messages. This is the current §4.9 design. **Best rendering fidelity** — full DOM control, smooth CSS sweep, line transitions, parallel-lyric rendering, everything.

**2. `OwnWindowOutputAdapter`** — KR is mounted in a `BrowserWindow` that LyriCue owns (not FreeShow). The window is positioned on the projector screen by the operator. SyncFrames travel via Electron's built-in IPC inside LyriCue's process tree. **Same rendering fidelity as fork mode** — KR is unchanged. The cost is operator-facing: they now have two apps to manage (LyriCue + FreeShow), and FreeShow is used only for non-karaoke content (announcements, scripture, video). For a service that's "all karaoke songs," FreeShow can be skipped entirely on the projector. For a mixed service, the operator alt-tabs or runs FreeShow on a different output.

**3. `CaptionInjectionOutputAdapter`** — LyriCue sends per-frame text updates to FreeShow's **Captions item** via FreeShow's WebSocket API. FreeShow's renderer displays the text. **Two sub-variants:**

  - *Without the upstream PR*: each frame replaces the visible text. Effect is word-by-word swap, not smooth sweep. Acceptable but visually degraded.
  - *With the upstream PR* (the small Captions-extension PR proposed in parallel, per ADR-16): the Captions item gains an optional `highlightMode: 'word-sweep'` parameter and a per-word progress field. LyriCue drives both. FreeShow renders the sweep using the same CSS technique as the fork-mode KR but inside FreeShow's existing renderer. **Near-fork-mode fidelity, zero in-tree footprint for LyriCue.**

#### Adapter Selection

Selected by `LyriCueSettings.deployment.mode`. Initial value set during first-run wizard based on what FreeShow installation is detected:

```
If a FreeShow installation is found locally:
  → Detect FreeShow version
  → If FreeShow ≥ {version-with-extension-PR} AND extension is supported:
      Recommend CaptionInjectionOutputAdapter (best of both worlds)
  → Else if running as fork build:
      Use ForkOutputAdapter
  → Else (running as sister service against unpatched FreeShow):
      Recommend OwnWindowOutputAdapter or degraded CaptionInjectionOutputAdapter
Operator can override the recommendation in settings at any time.
```

#### Fidelity Trade-off Summary

| Feature | ForkOutputAdapter | OwnWindowOutputAdapter | CaptionInjection (with PR) | CaptionInjection (without PR) |
|---|---|---|---|---|
| Smooth word sweep | Yes | Yes | Yes | No (word swap) |
| Line transitions | Yes | Yes | Yes | Limited |
| Held-note pulse | Yes | Yes | Yes | No |
| Parallel lyrics | Yes | Yes | Limited | No |
| Next-section preview | Yes | Yes | Yes | Yes |
| FreeShow update friction | High (merge work) | None | None | None |
| Operator UX | Single app | Two apps | One-ish app (WS drives FS) | One-ish app (WS drives FS) |
| Output goes through | FreeShow's projector pipeline | LyriCue's window | FreeShow's projector pipeline | FreeShow's projector pipeline |

**PRD traceability:** FR2 (entire), FR10 (entire), NFR1.3, NFR3.4. The dual-adapter design satisfies NFR3.2 (FreeShow compatibility across versions) by isolating version-sensitive integration to one swappable component.

### 4.10 WS — LyriCue UI Shell

**Responsibility:** All operator-facing UI in the main FreeShow window. This is a collection of Svelte components, not a single panel.

**Location:** `src/frontend/lyricue/components/`

**Components:**

| Component | Purpose | FR refs |
|---|---|---|
| `SettingsTab.svelte` | New tab in FreeShow's settings panel. Display mode, lead time, highlight color, audio device, shortcut config. | FR4, NFR5.3 |
| `LearnSongWizard.svelte` | Multi-step modal for FR1. Step 1: lyrics source (search / paste / import). Step 2: review sections. Step 3: attach audio. Step 4: progress. Step 5: timing preview + adjust. | FR1, FR5, FR6 |
| `SetlistPanel.svelte` | Live operator control panel. Setlist with sync status icons. Start Sync button. Audio device picker. Mode indicator. Per-song quick actions. | FR7 |
| `ArrangementBuilder.svelte` | Drag-and-drop section reordering. Shorthand input field. Multiple named arrangements per song. | FR9 |
| `RehearsalMode.svelte` | Rehearsal capture UI. Start/stop recording. Post-recording segmentation results. Per-song success indicators. | FR8 |
| `TimingPreview.svelte` | Waveform-style timeline showing word boundaries. Click-to-play. Drag handles on word boundaries (FR1.10). | FR1.9, FR1.10 |
| `ModeIndicator.svelte` | Always-visible badge showing current tier (Auto/Timer/Manual). Color-coded. | FR5.7, AC3.5 |
| `CommunityLibrary.svelte` | Browser for shared timing maps (optional/online). | FR11 |

These components hook into FreeShow at well-defined points (see §7).

**Setlist Panel — primary live operator UI:** This is the most important piece of operator-facing UI. It needs to satisfy the NFR5.2 target of "≤3 operator actions to start sync." Layout:

```
┌────────────────────────────────────────────────────────────┐
│  LyriCue  ▸ Sunday Morning             [Mode: AUTO ●]  │
├────────────────────────────────────────────────────────────┤
│  Audio Input: [Sound Desk Line In  ▼ ]   [Start Sync]      │
├────────────────────────────────────────────────────────────┤
│  Setlist:                                                  │
│    1. ✅ Way Maker          ████████░░  72 BPM     [▶ Now] │
│    2. ✅ Good Good Father   ░░░░░░░░░░  68 BPM             │
│    3. ✅ Build My Life      ░░░░░░░░░░  71 BPM             │
│    4. ⚠️ Great Are You Lord ░░░░░░░░░░  (partial)         │
├────────────────────────────────────────────────────────────┤
│  Next: Good Good Father                                    │
└────────────────────────────────────────────────────────────┘
```

3 actions to start: (1) pick audio source, (2) click first song, (3) click Start Sync. Subsequent songs are automatic (FR7.5).

**PRD traceability:** FR1.8, FR4.1–4.6, FR5.7, FR6, FR7, FR8, FR9, FR11.3, NFR5.2, NFR5.3.

### 4.11 LM — Library Manager (Multi-Campus Distribution)

**Responsibility:** Synchronize song bundles, arrangements, and project plans between this LyriCue install and the church's shared library. Handles catalog polling, bundle download/import, optional publish, signature verification, and provenance tracking (was this map made locally or imported from the central library).

**Location:** `src/electron/lyricue/LibraryManager.ts` + UI components in `src/frontend/lyricue/components/Library*.svelte`.

**Process boundary:** Network I/O happens in the main process (avoids renderer CORS noise and centralizes credential handling); UI in the renderer talks to it via IPC.

**Public interface:**

```typescript
export class LibraryManager {
  // Catalog operations
  async fetchCatalog(libraryUrl: string): Promise<Catalog>
  async diffCatalog(remote: Catalog, local: LocalLibraryState): Promise<CatalogDiff>

  // Bundle operations
  async downloadBundle(catalog: Catalog, songEntry: CatalogEntry): Promise<SongBundle>
  async importBundle(bundle: SongBundle): Promise<{ showId: string; timingMap: TimingMap }>
  async exportBundle(showId: string, options: ExportOptions): Promise<SongBundle>

  // Project (setlist) operations
  async fetchProject(libraryUrl: string, projectId: string): Promise<ProjectPlan>
  async listProjects(libraryUrl: string, filter?: ProjectFilter): Promise<ProjectSummary[]>

  // Publish (write — requires credential)
  async publishBundle(bundle: SongBundle, credential: PublishCredential): Promise<PublishResult>
  async publishProject(plan: ProjectPlan, credential: PublishCredential): Promise<PublishResult>

  // Signature & provenance
  verifySignature(bundle: SongBundle, trustedKeys: TrustedKey[]): VerificationResult
}
```

**Catalog format:** A single JSON file at `<libraryUrl>/catalog.json`. This is the only file that needs to be re-fetched to know what's new. The catalog contains URLs (relative or absolute) for individual bundles, so the LyriCue app can fetch bundles selectively.

```typescript
interface Catalog {
  $schema: 'lyricue-catalog-v1'
  orgId: string                       // "hillside-church"
  orgName: string                     // human-readable
  generatedAt: string                 // ISO-8601, by the publish worker
  songs: CatalogEntry[]
  projects: ProjectSummary[]
  campuses?: CampusSummary[]          // optional roster
}

interface CatalogEntry {
  songId: string                      // "way-maker-2024-001"
  title: string
  artist?: string
  bundleUrl: string                   // absolute or relative to catalog URL
  version: string                     // semver, bumps on re-learn
  publishedBy: { campus: string; user?: string; isCentral: boolean }
  publishedAt: string
  language: string
  bpm: number
  sizeBytes: number
  sha256: string                      // bundle integrity check
  signature?: string                  // optional Ed25519 signature
  tags?: string[]                     // "advent", "communion", etc.
}
```

**Bundle download flow (manual-pull-only — operator-triggered, per the sync mode decision):**

```
[1] Operator clicks "Check Library" in LibraryBrowser.svelte
        │
        ▼
[2] LM.fetchCatalog(libraryUrl) → HTTPS GET
        │
        ▼
[3] LM.diffCatalog(remote, local) → list of new/updated entries
        │
        ▼
[4] UI shows list; operator selects what to download
        │
        ▼
[5] For each selected: LM.downloadBundle()
        │
        ▼
[6] Verify SHA256; verify signature (if present and configured)
        │
        ▼
[7] LM.importBundle() → write into TM (TimingMapStorage)
        │
        ▼
[8] UI confirms; operator can preview each before activating
```

**No background sync.** Per the operator-controlled-pull decision, the app never polls automatically. The operator owns when the library is consulted. Rationale: predictability during rehearsal and live worship is more important than freshness.

**Bundle format (`.wstiming` — extended from the original definition in §4.3):**

A ZIP archive with the following layout:

```
bundle.wstiming
├── manifest.json          ← metadata + signature
├── timing.json            ← TimingMap (lyricue-timing-v1)
├── show.json              ← FreeShow Show with lyrics + slide structure
├── arrangements/          ← optional, can be 0+ files
│   ├── default.json
│   └── sunday-morning.json
└── README.md              ← human-readable summary; optional
```

The bundle is everything a campus needs to use this song on Sunday, **except** the source recording (licensing — never included). On import, LM creates the FreeShow Show from `show.json` (or links to an existing show if the operator chooses to merge into one they already have), saves the timing map via TM, and saves arrangements.

**Manifest schema:**

```typescript
interface BundleManifest {
  $schema: 'lyricue-bundle-v1'
  songId: string
  title: string
  artist?: string
  language: string
  bpm: number
  bundleVersion: string                 // semver of this bundle
  timingMapSchemaVersion: '1'
  publishedAt: string
  publishedBy: {
    orgId: string
    campusId: string
    userName?: string                   // anonymous if absent
    isCentral: boolean
  }
  sha256: string                        // of the other archive contents
  signature?: {                         // optional Ed25519
    algorithm: 'ed25519'
    keyId: string                       // identifies the signing key in the org's trust list
    value: string                       // base64
  }
  attribution?: string                  // free-text credits (lyricist, original learner)
  notes?: string
}
```

**Publish flow:**

```
[1] Operator selects a learned song in the WS UI; clicks "Publish to Library"
        │
        ▼
[2] LibraryPublishDialog.svelte gathers metadata: tags, attribution, notes,
    "anonymous?" toggle, "central?" toggle (latter requires central credential)
        │
        ▼
[3] LM.exportBundle() — assembles ZIP from TM + show data
        │
        ▼
[4] If signing key configured: sign manifest with Ed25519
        │
        ▼
[5] LM.publishBundle() — HTTPS PUT to Cloudflare Worker endpoint
        │  with X-WS-Org, X-WS-Campus, X-WS-Credential headers
        ▼
[6] Worker validates credential, writes to R2, regenerates catalog.json
        │
        ▼
[7] LM receives confirmation; UI shows "Published"
        │
        ▼
[8] Other campuses see the new bundle on their next "Check Library" click
```

**Provenance & local-vs-central state:**

Each timing map and arrangement on disk records its origin:

```typescript
interface ProvenanceRecord {
  source: 'local' | 'imported'
  importedFrom?: {
    libraryUrl: string
    songId: string
    bundleVersion: string
    importedAt: string
  }
  modifiedLocally: boolean              // true if the operator edited after import
}
```

This unlocks several UI affordances:

- The Setlist Panel can show a "imported" badge next to imported songs.
- An "update available" indicator appears when the catalog shows a newer version of an imported song.
- "Re-import" overwrites local edits with the latest central version (with confirmation).
- "Fork" copies the imported song to a fresh local entry, breaking the link (useful when a campus wants to diverge without losing the central version).

**Signature verification (optional, opt-in for the church):**

Some churches will want cryptographic provenance to prevent a malicious bundle being injected if the library URL is hijacked. The Ed25519 signature scheme:

- The central team generates an Ed25519 keypair once, stores the public key in a known location (the catalog itself, or a separate `trust.json` in the bucket).
- Every bundle published by the central team is signed with the private key.
- LyriCue installs verify signatures against the trusted public key list before importing.
- Unsigned bundles or bundles signed with an unknown key trigger a warning ("This bundle is not signed by your church's central team — import anyway?"). Operator confirms or rejects.

This is fully opt-in. A small church with one campus can skip it entirely. For a 60-campus organization, it's strongly recommended and the first-run wizard prompts to configure it if a library URL is set.

**Failure modes:**

| Failure | Handling |
|---|---|
| Library URL unreachable (offline, DNS, etc.) | UI shows "Library unavailable — using local songs only." Live worship continues normally. |
| Catalog malformed | Surface error; cache the last-known-good catalog and continue with it. |
| Bundle SHA256 mismatch | Reject the bundle; surface error; do not import. |
| Bundle signature invalid (when verification is enabled) | Reject; surface error with details (unknown key vs. tampered). |
| Publish credential rejected by worker | Surface clear error; ensure credential is not logged. |
| R2 / Cloudflare outage | Operator falls back to the configured GitHub mirror (see §8). |

**PRD traceability:** FR11.1, FR11.2, FR11.3, FR11.4, FR11.5, FR11.6, FR11.7 (with the Cloudflare R2 + Worker interpretation of "lightweight API"), FR11.8 (peer-to-peer file sharing still works — bundles can be exported to disk and shared via WhatsApp/email), FR11.9 (`bundleVersion` field).

---

## 5. Data Flows

This section traces the three most critical data paths end-to-end. Each shows exactly which modules touch which data, in what order, across which process boundaries.

### 5.1 Song Learning Flow (FR1)

```
[1] User picks audio file in LearnSongWizard.svelte
              │
              ▼
[2] WS → IPC(LYRICUE, LEARN_SONG_START, { showId, audioPath, lyricsBySections })
              │
              ▼ (Electron main process)
[3] SC.ensureRunning()
       └─ spawn child_process('python', ['-m', 'lyricue_sidecar'])  if needed
              │
              ▼
[4] SC.request('learn_song', { jobId, audioPath, lyrics, options })
              │  stdin (JSON-RPC)
              ▼
[5] Python sidecar:
       Decode audio → Demucs → WhisperX → BPM → Section map → Timing map
       Emits progress notifications on stdout every ~2s
              │
              ▼ (notifications)
[6] SC.onProgress → IPC(LYRICUE, LEARN_SONG_PROGRESS, { jobId, stage, percent })
              │
              ▼ (renderer)
[7] WS updates LearnSongWizard progress bar
              │
              ▼ (final response from Python)
[8] SC receives { jobId, result: TimingMap }
              │
              ▼
[9] TM.save(showId, timingMap)
       └─ write <userData>/lyricue/timing-maps/<showId>.timing.json (atomic)
       └─ update show.meta.lyricue pointer
              │
              ▼
[10] IPC(LYRICUE, LEARN_SONG_COMPLETE, { showId, durationMs })
              │
              ▼
[11] WS transitions to TimingPreview.svelte for FR1.9 review
```

### 5.2 Live Sync Flow (FR2 + FR3 + FR4)

```
                  ┌──── Audio Input Stream (48kHz PCM, AudioContext) ────┐
                  │                                                       │
                  ▼                                                       ▼
        ┌───────────────────┐                                ┌──────────────────────┐
        │  BD: Meyda        │                                │  STT: Whisper.cpp     │
        │  (per ~30 Hz)     │                                │  (rolling 5s window) │
        │                   │                                │                      │
        │  → liveBPM        │                                │  → recognized words  │
        │  → beatConfidence │                                │                      │
        └───────────────────┘                                └──────────────────────┘
                  │                                                       │
                  │                                                       ▼
                  │                                              ┌────────────────────┐
                  │                                              │  Phrase Matcher    │
                  │                                              │  (3-word index)    │
                  │                                              │                    │
                  │                                              │  → correctPosition │
                  │                                              │       (debounced)  │
                  │                                              └────────────────────┘
                  │                                                       │
                  ▼                                                       │
        ┌─────────────────────────────────────────────────────────────────▼─────────┐
        │  SE: Sync Engine                                                          │
        │                                                                           │
        │  - requestAnimationFrame loop                                             │
        │  - tempoRatio = liveBPM / refBPM (clamped)                                │
        │  - cursorRefTime += deltaWall * tempoRatio (gated by VAD)                 │
        │  - lookupWord(cursorRefTime, activeTimingMap) → (slideIdx, wordIdx, prog) │
        │  - on tier transition: emit tierChanged                                   │
        │  - on position correction: animate cursor jump (300ms)                    │
        │                                                                           │
        │  → Svelte stores: currentSlideIndex, currentWordIndex, wordProgress       │
        └──────────────────────────────────┬────────────────────────────────────────┘
                                           │
                                           ▼
            ┌──────────────────────────────────────────────────────────┐
            │  IPC(OUTPUT, "WS_SYNC_FRAME", { slideIdx, wordIdx, prog })│
            │  (FreeShow's existing OUTPUT channel,                     │
            │   throttled to 60 Hz via requestAnimationFrame)           │
            └──────────────────────────────────────────────────────────┘
                                           │
                                           ▼
                       ┌──────────────────────────────────┐
                       │  KR: Karaoke Renderer            │
                       │  (output BrowserWindow)          │
                       │                                  │
                       │  Updates --progress CSS var      │
                       │  CSS does the visual sweep       │
                       └──────────────────────────────────┘
                                           │
                                           ▼
                                     Projector / TV
```

VAD lives between AI and SE conceptually but is omitted from this diagram for clarity. It runs on the AudioContext output and emits state changes to SE.

### 5.3 Setlist Transition Flow (FR7)

```
[1] SE detects cursorRefTime ≥ activeMap.totalDuration
              │
              ▼
[2] SE: state.songComplete = true; emit "songComplete" event
              │
              ▼
[3] WS (SetlistPanel) listens; calls SE.loadNextSong()
              │
              ├─ if next song has timing map:
              │      TM.load(nextShowId) → activeTimingMap store
              │      KR receives new map via OUTPUT IPC
              │      SE.state = "waitingForStart"   (FR7.3, FR7.4)
              │      KR displays first section, no highlighting
              │      VAD active → SE.startSync()    (FR6.4 / UJ6 step 7)
              │
              └─ if next song has no timing map (e.g., scripture reading):
                     SE.tier = "manual"
                     KR yields back to FreeShow's normal slide renderer
                     (FR7.6 — non-learned items pass through)
```

### 5.4 Library Sync Flow (Multi-Campus, Manual Pull)

```
[1] Operator clicks "Check Library" in LibraryBrowser.svelte
              │
              ▼
[2] IPC(LYRICUE, LIBRARY_FETCH_CATALOG, { libraryUrl })
              │
              ▼ (main process)
[3] LM.fetchCatalog → HTTPS GET <libraryUrl>/catalog.json
              │
              ▼
[4] LM.diffCatalog(remote, local) → CatalogDiff
              │
              ▼
[5] IPC reply with diff; UI renders list of new + updated entries
              │
              │  (operator browses, ticks checkboxes, clicks "Download")
              ▼
[6] IPC(LYRICUE, LIBRARY_DOWNLOAD_BUNDLE, { entries[] })
              │
              ▼ (parallel for each entry)
[7] LM.downloadBundle → HTTPS GET <entry.bundleUrl> (with primary/mirror failover)
              │
              ▼
[8] Verify SHA256 → verify signature (if configured)
              │
              ▼
[9] LM.importBundle:
        - Unzip
        - If show.json's songId doesn't exist locally: create FreeShow show
        - If it exists: prompt operator (replace / merge / skip)
        - TM.save(showId, timingMap) with provenance.source = 'imported'
        - TM.saveArrangements(showId, arrangements[])
              │
              ▼
[10] IPC progress notifications throughout; final IPC completion event
              │
              ▼
[11] UI updates the Setlist Panel: imported songs show "from library" badge
              │
              ▼
[12] Songs are immediately usable for the next service
        (no further network access needed — they live on disk)
```

For project (setlist) sync, the same pattern applies but at the Project level: operator picks a published central project ("2026-05-17 Central"), LM downloads the project plan JSON, and any referenced songs not yet in the local library are downloaded as a batch.

### 5.5 Publish Flow (Central Team or Campus with Credentials)

```
[1] Operator views a learned song; clicks "Publish to Library"
              │
              ▼
[2] LibraryPublishDialog.svelte gathers metadata, attribution, target (central/campus)
              │
              ▼
[3] IPC(LYRICUE, LIBRARY_PUBLISH_BUNDLE, { showId, target, metadata })
              │
              ▼ (main process)
[4] LM.exportBundle:
        - Read TM data
        - Read FreeShow show
        - Assemble ZIP (timing + show + arrangements + manifest)
        - Compute SHA256
        - Sign manifest if signing key is configured
              │
              ▼
[5] LM.publishBundle:
        HTTPS PUT to Cloudflare Worker endpoint with credential
        Body: the ZIP bundle
        Headers: X-WS-Org, X-WS-Campus, X-WS-Credential, X-WS-Target
              │
              ▼
[6] Worker validates credential, writes bundle to R2,
    rebuilds catalog.json with the new entry,
    optionally mirrors to GitHub
              │
              ▼
[7] IPC reply with success + URL; UI shows confirmation
              │
              ▼
[8] Other campuses see this on their next manual "Check Library"
```

---

## 6. Data Model & Contracts

This section defines every persisted format and every IPC payload. These are the wire contracts that bound module interactions.

### 6.1 Timing Map Schema (`lyricue-timing-v1`)

```typescript
// src/types/LyriCue.ts

export interface TimingMap {
  $schema: 'lyricue-timing-v1'
  showId: string                          // FK to FreeShow Show.id
  learnedFrom: {
    method: 'studio' | 'rehearsal' | 'imported'
    filename?: string                     // for studio/rehearsal
    duration: number                      // seconds, the source audio length
    learnedAt: string                     // ISO-8601
    source?: string                       // for imported: e.g., "community library v1.2"
  }
  bpm: number
  timeSignature?: string                  // "4/4", "3/4", "6/8", etc. — optional
  language: string                        // BCP-47, e.g. "en", "zu-ZA"
  sections: TimingSection[]
  metadata: {
    demucsModel?: string
    whisperxModel?: string
    schemaVersion: '1'
    version: string                       // semver of THIS timing map (for re-learn versioning, FR11.9)
  }
}

export interface TimingSection {
  id: string                              // stable section ID (e.g., "verse1")
  type: 'verse' | 'chorus' | 'bridge' | 'pre-chorus' | 'tag' | 'intro' | 'outro' | 'other'
  label: string                           // human-readable, e.g., "Verse 1"
  slideIndex: number                      // index into the FreeShow slide layout
  startMs: number                         // reference-track time
  endMs: number
  words: TimingWord[]
  lines: TimingLine[]                     // line boundaries within the section
}

export interface TimingWord {
  text: string
  startMs: number
  endMs: number
  confidence: number | null               // null = unaligned (review needed)
  lineIndex: number                       // which line within the section
  held?: boolean                          // derived: endMs - startMs > 800
}

export interface TimingLine {
  startMs: number
  endMs: number
  wordStartIndex: number                  // index into section.words
  wordEndIndex: number                    // exclusive
}
```

### 6.2 Arrangement Schema (FR9)

```typescript
export interface Arrangement {
  id: string
  name: string                            // "Sunday Morning", "Evening Service"
  showId: string
  isDefault: boolean
  sequence: ArrangementStep[]
  createdAt: string
  updatedAt: string
}

export interface ArrangementStep {
  sectionId: string                       // references TimingMap.sections[].id
  // duplicates allowed: chorus may appear 3+ times in sequence
}
```

Stored at `<userData>/lyricue/arrangements/<showId>.arrangements.json` as an array of `Arrangement`.

### 6.3 Identity Schema (Multi-Campus)

Every install holds an identity triple. None of these are credentials — they are tags used for attribution and provenance. Credentials, when needed for publishing, are stored separately and never logged.

```typescript
export interface InstallIdentity {
  $schema: 'lyricue-identity-v1'
  org: {
    id: string                          // "hillside-church" — must match the library's orgId
    name: string                        // "Hillside Church" — display
  }
  campus: {
    id: string                          // "pretoria-north"
    name: string                        // "Pretoria North"
  }
  user?: {
    id?: string                         // optional stable ID; auto-generated if user creates account
    displayName?: string                // "Thabo" or null for fully anonymous
    isAnonymous: boolean
  }
  // Set during first-run wizard; rarely changes after.
  // Stored at <userData>/lyricue/identity.json
}
```

The `user` field is optional throughout. A campus can run fully anonymously and the library will record publications as `{ campus: "pretoria-north", user: null }`. Anonymity is a first-class mode, not a degraded one — there is no feature that requires a named user.

### 6.4 Library Configuration Schema

```typescript
export interface LibraryConfig {
  $schema: 'lyricue-library-config-v1'
  enabled: boolean
  primaryUrl: string | null             // e.g., "https://library.hillside.church"
  mirrorUrl: string | null              // e.g., "https://raw.githubusercontent.com/hillside/lyricue-library/main"
  publishCredential?: {                 // present only on installs that publish
    type: 'cloudflare-worker-token' | 's3-iam' | 'github-pat'
    keyId?: string                      // public identifier; safe to display
    secretRef: string                   // OS keychain reference; never the raw secret
  }
  signing?: {
    enabled: boolean
    privateKeyRef?: string              // OS keychain reference
    publicKeyId?: string                // distributed in catalog
  }
  trustedPublicKeys: TrustedKey[]       // for verifying imports
  catalogCacheTtlSeconds: number        // default 0 — purely manual pull
}

export interface TrustedKey {
  keyId: string
  publicKey: string                     // base64 Ed25519
  label: string                         // "Central team key, generated 2026-01-15"
  addedAt: string
}
```

Credential storage uses the OS keychain via Electron's `safeStorage` API (which uses macOS Keychain, Windows DPAPI, libsecret on Linux). Secrets are never written to plaintext settings files; only the keychain reference handle is stored.

### 6.5 LyriCue Settings Schema

```typescript
export interface LyriCueSettings {
  $schema: 'lyricue-settings-v1'
  display: {
    mode: 'karaoke' | 'section' | 'traditional'
    leadTimeSeconds: number               // 0.0–5.0
    highlightColor: string                // hex, e.g. "#FFCC00"
    sungColor: string
    upcomingColor: string
    animationType: 'sweep' | 'glow' | 'bold'
    sungWordOpacity: number               // 0.0–1.0
    fontSize: number                      // base; clamps via vmin
    fontFamily: string
    heldNoteAnimation: 'pulse' | 'glow' | 'static'
    parallelLyricsEnabled: boolean
    parallelLyricsLanguage?: string
  }
  sync: {
    audioInputDeviceId: string | null
    tempoSmoothingWindowMs: number        // default 2000
    minBeatConfidence: number             // default 0.4
    confidenceFailoverSeconds: number     // default 10
    sttEnabled: boolean
    positionCorrectionMinWords: number    // default 3 (FR4.6)
    manualOverrideDebounceSeconds: number // default 3
    vadEnterThreshold: number             // RMS
    vadExitThreshold: number              // RMS
    vadEnterMs: number                    // default 300
    vadExitMs: number                     // default 1500
  }
  shortcuts: {
    startSync: string                     // KeyboardEvent.code
    nextSection: string
    prevSection: string
    toggleManual: string
    reEngageSync: string
  }
  sidecar: {
    pythonPath: string | null             // null → auto-detect
    demucsModel: 'htdemucs' | 'htdemucs_ft' | 'mdx_extra'
    whisperxModel: 'tiny' | 'base' | 'small' | 'medium'
  }
  community: {
    libraryEnabled: boolean               // off by default; explicit opt-in
    submitAnonymously: boolean
  }
}
```

### 6.4 IPC Channels & Message Types

**New top-level channel:**

```typescript
// Added to src/types/Channels.ts
export const LYRICUE = 'LYRICUE'
```

**Message enum (renderer ↔ main):**

```typescript
// src/types/LyriCue.ts (continued)

export enum WSMain {
  // Sidecar lifecycle
  CHECK_PYTHON              = 'CHECK_PYTHON',
  SIDECAR_STATUS            = 'SIDECAR_STATUS',

  // Song learning
  LEARN_SONG_START          = 'LEARN_SONG_START',
  LEARN_SONG_PROGRESS       = 'LEARN_SONG_PROGRESS',
  LEARN_SONG_COMPLETE       = 'LEARN_SONG_COMPLETE',
  LEARN_SONG_ERROR          = 'LEARN_SONG_ERROR',
  LEARN_SONG_CANCEL         = 'LEARN_SONG_CANCEL',

  // Rehearsal mode
  REHEARSAL_START           = 'REHEARSAL_START',
  REHEARSAL_STOP            = 'REHEARSAL_STOP',
  REHEARSAL_SEGMENT         = 'REHEARSAL_SEGMENT',   // → multi-song split

  // Timing map storage
  TIMING_MAP_LOAD           = 'TIMING_MAP_LOAD',
  TIMING_MAP_SAVE           = 'TIMING_MAP_SAVE',
  TIMING_MAP_DELETE         = 'TIMING_MAP_DELETE',
  TIMING_MAP_EXPORT         = 'TIMING_MAP_EXPORT',   // .wstiming
  TIMING_MAP_IMPORT         = 'TIMING_MAP_IMPORT',

  // Arrangements
  ARRANGEMENTS_LOAD         = 'ARRANGEMENTS_LOAD',
  ARRANGEMENTS_SAVE         = 'ARRANGEMENTS_SAVE',

  // Settings
  SETTINGS_LOAD             = 'SETTINGS_LOAD',
  SETTINGS_SAVE             = 'SETTINGS_SAVE',

  // Community / multi-campus library
  LIBRARY_FETCH_CATALOG     = 'LIBRARY_FETCH_CATALOG',
  LIBRARY_DIFF_CATALOG      = 'LIBRARY_DIFF_CATALOG',
  LIBRARY_DOWNLOAD_BUNDLE   = 'LIBRARY_DOWNLOAD_BUNDLE',
  LIBRARY_IMPORT_BUNDLE     = 'LIBRARY_IMPORT_BUNDLE',
  LIBRARY_PUBLISH_BUNDLE    = 'LIBRARY_PUBLISH_BUNDLE',
  LIBRARY_PUBLISH_PROJECT   = 'LIBRARY_PUBLISH_PROJECT',
  LIBRARY_FETCH_PROJECT     = 'LIBRARY_FETCH_PROJECT',
  LIBRARY_LIST_PROJECTS     = 'LIBRARY_LIST_PROJECTS',
  LIBRARY_VERIFY_SIGNATURE  = 'LIBRARY_VERIFY_SIGNATURE',
  LIBRARY_CONFIG_LOAD       = 'LIBRARY_CONFIG_LOAD',
  LIBRARY_CONFIG_SAVE       = 'LIBRARY_CONFIG_SAVE',

  // Identity
  IDENTITY_LOAD             = 'IDENTITY_LOAD',
  IDENTITY_SAVE             = 'IDENTITY_SAVE',
}
```

**Per-frame sync data (renderer main → renderer output, via FreeShow's OUTPUT channel):**

```typescript
// Sent on the OUTPUT channel as { channel: WS_SYNC_FRAME, data: SyncFrame }
export const WS_SYNC_FRAME = 'WS_SYNC_FRAME'

export interface SyncFrame {
  outputId: string                  // which karaoke output window
  slideIndex: number
  wordIndex: number
  wordProgress: number              // 0..1
  tier: 'auto' | 'timer' | 'manual'
  vad: 'active' | 'silent'
}

// Sent when the active song changes
export const WS_LOAD_MAP = 'WS_LOAD_MAP'

export interface LoadMapPayload {
  outputId: string
  showId: string
  timingMap: TimingMap
  arrangement: Arrangement | null   // null = use timing map's native order
  parallelLyrics?: ParallelLyricsTrack[]  // FR10
}
```

**Throttling:** SE emits SyncFrame at most once per `requestAnimationFrame` (~60 Hz). FreeShow's IPC is fast enough for this volume; if profiling reveals a bottleneck post-implementation, fall back to 30 Hz emission with interpolation in the renderer.

### 6.5 JSON-RPC Protocol (Electron ↔ Python sidecar)

Full method index:

| Method | Direction | Purpose |
|---|---|---|
| `ready` | Python → Electron (notification) | Sidecar startup complete |
| `check_models` | Electron → Python | Verify Demucs + WhisperX models present |
| `learn_song` | Electron → Python | Run pipeline on one audio file |
| `segment_rehearsal` | Electron → Python | Split multi-song recording |
| `progress` | Python → Electron (notification) | Stage + percent update |
| `cancel_job` | Electron → Python | Abort in-progress job |
| `shutdown` | Electron → Python | Clean exit |

Errors use JSON-RPC 2.0 standard error format with custom codes in the [-32099, -32000] reserved range:

```
-32001  PYTHON_VERSION_TOO_OLD
-32002  MISSING_DEPENDENCY
-32010  AUDIO_DECODE_FAILED
-32011  VOCAL_ISOLATION_FAILED
-32012  ALIGNMENT_FAILED
-32013  NO_VOCALS_DETECTED
-32020  REHEARSAL_SEGMENTATION_FAILED
```

---

## 7. FreeShow Integration Architecture

This section names every file in FreeShow's existing codebase that LyriCue touches, what it changes, and why each touch is the minimum-invasive option.

### 7.1 Files Touched in FreeShow Core

| FreeShow file | Change type | Why |
|---|---|---|
| `src/types/Channels.ts` | Add one line: `export const LYRICUE = 'LYRICUE'` | Required to register new IPC channel |
| `src/types/Settings.ts` | Add `lyricue?: LyriCueSettings` to SyncedSettings | Settings persistence (or store separately — see §7.3) |
| `src/types/Output.ts` | Add `karaokeMode?: boolean` and `karaokeShowId?: string` to Output interface | Tag an output window as Karaoke type |
| `src/electron/output/OutputHelper.ts` | Register output-type handler for `karaokeMode === true` | Route create/destroy through existing factory |
| `src/electron/output/helpers/OutputLifecycle.ts` | Branch on `karaokeMode` to load the karaoke entry HTML/component | New rendering target |
| `src/electron/index.ts` | One-line bootstrap call to `LyriCue.init(ipcMain)` | Register IPC handlers at startup |
| `src/frontend/MainOutput.svelte` | Branch on `outputs[id].karaokeMode` → render `<KaraokeOutput />` instead of `<Output />` | Mount our renderer inside the output window |
| `src/frontend/main.ts` | One-line bootstrap call to `lyricue.init()` | Register Svelte stores and message routing |
| `src/frontend/components/settings/Settings.svelte` | Add a new tab item "LyriCue" pointing to our `SettingsTab.svelte` | New settings category |
| `src/frontend/utils/shortcuts.ts` | Register LyriCue shortcuts via a hook (the shortcut handler reads from settings); during live sync, consume Space/Arrow keys when sync engine is active | Operator controls |

That's **ten** core-file touches, all narrow. Every other code addition lives inside `src/electron/lyricue/`, `src/frontend/lyricue/`, or `src/types/LyriCue.ts` — directories that don't exist in FreeShow today, so they can't conflict with upstream changes.

### 7.2 The Karaoke Output Window

The most architecturally significant integration. Walking through the create flow:

1. **Operator action:** Settings UI lets operator add a new output and select type "Karaoke" (in addition to FreeShow's existing Standard / Stage / NDI types).
2. **Output config persisted:** `{ id, name, bounds, screen, karaokeMode: true, karaokeShowId: null }`.
3. **OutputHelper.createOutput()** is called. The existing `createOutputWindow()` produces a `BrowserWindow` with `outputOptions` (transparent, always-on-top, frameless). No change needed.
4. **OutputLifecycle.loadWindowContent()** loads `public/index.html` and sends the STARTUP message: `{ type: "output", outputId, karaokeMode: true }`. We extend the STARTUP payload with `karaokeMode`.
5. **In the renderer**, `MainOutput.svelte` branches on `outputs[outputId].karaokeMode`:
   ```svelte
   {#if $outputs[outputId]?.karaokeMode}
     <KaraokeOutput {outputId} />
   {:else if $outputs[outputId]?.stageOutput}
     <StageLayout {outputId} />
   {:else}
     <Output {outputId} />
   {/if}
   ```
6. **KaraokeOutput** subscribes to the SyncFrame stream on the OUTPUT channel (already wired by FreeShow), discriminates by `outputId`, and renders.

**Why not a plugin system:** FreeShow has no plugin system today, and proposing one as part of LyriCue would expand scope dramatically. The fork-then-upstream path (per OQ6) means we can simply add code; FreeShow's existing output-type plurality (standard/stage/NDI) gives us the seam we need.

### 7.3 Settings Persistence Decision

Two options for LyriCue settings:

A. **Store inside FreeShow's SyncedSettings** — extend the existing settings schema. Pros: one settings file, follows FreeShow conventions. Cons: bloats FreeShow's settings, mixes concerns, harder to clean up if user removes LyriCue.

B. **Store separately at `<userData>/lyricue/settings.json`.** Pros: clean separation, removable. Cons: two settings stores.

**Decision: B.** Aligns with Principle P5 (sidecar data, not schema mutation) and the OQ1 resolution applied consistently. The SettingsTab UI calls IPC `WSMain.SETTINGS_LOAD` / `SETTINGS_SAVE`; the main process reads/writes `<userData>/lyricue/settings.json`.

### 7.4 Project / Setlist Integration

FreeShow Projects are already ordered lists of show references (`Project.shows: ProjectShowRef[]`). LyriCue reads the active project directly from FreeShow's `projects` store. No mutation of FreeShow's project format.

To overlay sync status on the Setlist Panel, we map each `ProjectShowRef.id` → `TimingMapStorage.exists(showId)`. The result is a derived Svelte store consumed by the Setlist Panel UI.

### 7.5 Lyrics Sourcing Integration (FR6)

FreeShow already has `GET_LYRICS` and `SEARCH_LYRICS` IPC messages (`src/types/IPC/Main.ts:122-123`). The Learn Song Wizard's Step 1 ("source lyrics") calls these directly — no new lyric-fetching infrastructure needed. We add:
- Section auto-detection (regex against `[Verse]`, `[Chorus]`, etc.) — pure utility in `src/frontend/lyricue/lyrics/parseLyrics.ts`.
- A review screen (`LyricsReviewStep.svelte`) for the operator to confirm sections before learning.

FreeShow's `.txt`/`.docx`/`.pdf` import (for FR6.3) leverages the host's existing import infrastructure where present; for formats FreeShow doesn't already handle, we add parsers under `src/frontend/lyricue/lyrics/parsers/`.

### 7.6 Keyboard Shortcuts (FR5.1)

FreeShow handles shortcuts in `src/frontend/utils/shortcuts.ts`. Two registration patterns:

- **Modal-style (Ctrl+L for Learn Song):** Add an entry to `ctrlKeys` in shortcuts.ts that calls `activePopup.set("lyricue_learn_song")`.
- **Live-sync shortcuts (Space, arrows, Escape during active sync):** These conflict with FreeShow's existing shortcuts. The SyncEngine subscribes to a `syncActive` store; when true, it intercepts these keys at a higher priority and consumes them; FreeShow's handler falls through to its existing behavior when sync is inactive. Implementation: a guard inserted near the top of `shortcuts.ts`'s `keydown()` function:

```typescript
if (get(syncActive) && handleSyncShortcut(e)) {
  e.preventDefault()
  return
}
// ... existing handler continues
```

The `handleSyncShortcut` function lives in LyriCue code, returning true if the key was consumed. This is the only behavioral change to FreeShow's shortcut handler.

### 7.7 What FreeShow Files We Don't Touch

For completeness, the major FreeShow systems LyriCue **does not** modify:

- `src/types/Show.ts` — the Show data model. (We add to `meta` only, which Show.ts already permits as freeform.)
- `src/types/Projects.ts` — Projects are read-only from LyriCue's perspective.
- `src/frontend/components/output/Output.svelte` — the standard slide renderer is unchanged; the Karaoke Output is a parallel renderer.
- `src/frontend/components/slide/Textbox.svelte` — text rendering for standard slides is unchanged.
- `src/electron/data/save.ts` — show save logic is unchanged.
- `src/electron/IPC/responsesMain.ts` — existing IPC handlers are unchanged; we add new ones via our own `init(ipcMain)` call.

### 7.8 Sister-Service Integration (Dual-Mode Alternative Path)

The integration described in §7.1–§7.7 is the **fork-mode** integration — LyriCue code lives inside FreeShow's process tree. Per P11 and ADR-16, the architecture also supports **sister-service mode** where LyriCue runs as a separate Electron application driving FreeShow externally.

#### Sister-Service Integration Surface

In sister-service mode, the in-tree changes to FreeShow shrink dramatically:

| Fork-mode touchpoint | Sister-service equivalent |
|---|---|
| 10 FreeShow files modified (Channels.ts, Output.ts, MainOutput.svelte, etc.) | 0 files modified for OwnWindowOutputAdapter; 1 file modified for CaptionInjectionOutputAdapter-with-PR |
| New IPC channel LYRICUE | Not needed; we use FreeShow's existing WebSocket API |
| New output type karaokeMode | Not needed; we own our window OR drive existing Captions item |
| Settings panel inside FreeShow | Inside LyriCue's own UI |
| Keyboard shortcuts inside FreeShow's handler | Inside LyriCue's own window |
| Read FreeShow projects | Via FreeShow's REST API (`/v1/projects`) instead of file-system stores |

#### FreeShow's Existing External API Surface (What We Drive)

FreeShow exposes several network APIs intended for external integration (the same APIs that Caption.ninja, Companion, and Stream Deck plugins use). Per the research, vassbo treats these as a public contract for integrations.

| API | Purpose for LyriCue | Stability |
|---|---|---|
| REST API on configurable port | Read shows, projects, output state | Stable (Companion uses it) |
| WebSocket on same port | Drive output state, update Captions item, observe state changes | Stable |
| Companion protocol | Bidirectional control surface | Stable |

LyriCue's `FreeShowClient` module wraps these — same shape as a typical SDK — and is the only place in our codebase that knows about FreeShow's API. If FreeShow changes the API contract, only this module needs updating.

#### The Proposed Upstream PR (Captions Word-Highlight Extension)

To enable `CaptionInjectionOutputAdapter` at full fidelity, we propose a small upstream PR to FreeShow's Captions item:

**Scope:** Add an optional `highlightMode: 'word-sweep' | 'none'` setting to the Captions item, and an optional `wordProgress: number` field on per-word caption updates. When `highlightMode === 'word-sweep'`, the renderer wraps each word in a `<span>` and applies the same CSS sweep technique as our fork-mode KR.

**Estimated size:** 3–4 files, ~150 LOC. Sits within `src/frontend/components/output/layers/Captions.svelte` and the type definitions for the Captions item.

**Why it might land:** It matches the precedent in the research — small, focused, extends an existing FreeShow concept (the Captions item), adds value visible to any user driving Captions via Caption.ninja or similar. PR #3144 (TheFlugeler's continuous scroll, 4 files / 160 LOC, merged <24h) is the strongest precedent for this size and shape.

**Why it might not land:** Vassbo might prefer routing this through a different mechanism (Action-driven, or a new dedicated Karaoke item type). The PR includes a brief design discussion section to surface the design choice early.

**What we do if rejected:** Fall back to `OwnWindowOutputAdapter` (own window) for full fidelity, accepting the two-app operator workflow. `CaptionInjectionOutputAdapter` without the extension is still functional but degraded (word-swap, not sweep) — acceptable for campuses that prefer one-app simplicity over visual polish.

#### Mode Selection in the Installer

The installer ships in two flavors during the period when both modes are supported:

- **`lyricue-fork-<platform>.<ext>`** — a FreeShow fork build with LyriCue bundled. Operators get a single combined app. Larger installer (~700–900 MB).
- **`lyricue-sister-<platform>.<ext>`** — a standalone LyriCue app. Smaller (~600–700 MB; FreeShow is downloaded/installed separately). On first launch, prompts for the URL of the local FreeShow instance.

A single repository builds both; the difference is a build flag (`WS_DEPLOYMENT_MODE=fork|sister`) that selects the default OutputAdapter and the FreeShow integration shim. Most code is shared.

---

## 8. Distribution & Multi-Tenant Architecture

This section defines the architecture for the multi-tenant deployment scenario: how the application is packaged and installed, how multiple tenants share song bundles via a central library, how mixed-mode (centralized + autonomous) operation is supported on the same install, and how the central library is hosted and operated.

**Domain note:** This section uses "campus" and "central team" throughout because the launch customer is a multi-campus church with one central worship-planning team. The architecture is fully domain-neutral — substitute "venue" / "production house" / "school district office" / "regional headquarters" for "campus," and "headquarters" / "central programming team" / "show producer" for "central team." The patterns (one-org-many-locations, shared content library, federated publishing, optional centralized planning) are common across:

- **Karaoke chains** — one corporate library, dozens of venues
- **Theater touring companies** — one production headquarters, multiple regional teams
- **School districts** — district-wide content library, per-school customization
- **Live music venues with brand affiliation** — venue group sharing performance content
- **Houses of worship** (the launch case) — denominational HQ + local congregations

In every case the technology is the same; only the labels change.

### 8.1 Deployment Topology

```
┌────────────────────────────────────────────────────────────────────┐
│                  Central Team (1 or 2 people)                       │
│                                                                     │
│   - Runs LyriCue with publish credential configured             │
│   - Learns canonical songs from studio recordings                   │
│   - Publishes weekly setlist plans                                  │
│   - Manages signing key (if signed bundles enabled)                 │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTPS PUT
                           │ (X-WS-Credential)
                           ▼
              ┌────────────────────────────┐
              │  Cloudflare Worker          │
              │  (publish-worker)           │
              │                             │
              │  - Validates credential     │
              │  - Writes bundle to R2      │
              │  - Rebuilds catalog.json    │
              │  - Optionally mirrors to    │
              │    GitHub                   │
              └─────────────┬───────────────┘
                            │
                            ▼
              ┌────────────────────────────┐
              │  Cloudflare R2 Bucket       │
              │  (lyricue-library)      │
              │                             │
              │  - Public-read              │
              │  - Stores all bundles       │
              │  - Stores catalog.json      │
              │  - Stores project plans     │
              └─────────────┬───────────────┘
                            │
              ┌─────────────┴────────────────┐
              │                              │
              │   GitHub Mirror (fallback)   │
              │   (read-only mirror of R2)   │
              │                              │
              └─────────────┬────────────────┘
                            │
                            │ HTTPS GET (public, anonymous)
                            ▼
   ┌────────────────────────────────────────────────────────────────┐
   │                                                                │
   │   60 Campus Installs (volunteer AV operators)                  │
   │                                                                │
   │   - Each install has org + campus identity                     │
   │   - Polls library on operator click ("Check for updates")      │
   │   - Downloads selected bundles                                 │
   │   - Optionally publishes its own bundles (with credentials)    │
   │                                                                │
   └────────────────────────────────────────────────────────────────┘
```

### 8.2 Library Hosting: Cloudflare R2 + Cloudflare Worker

**Why R2:** Unlimited free egress at any scale. 10 GB free storage covers the library for years (estimated 60-campus library size at year 5: ~50 GB worst case, ~$0.60/month). Single-vendor risk is acknowledged and mitigated by the GitHub mirror (see §8.7).

**Why a Cloudflare Worker on top:** The Worker provides three things R2 alone doesn't:

1. **Credentialed writes** — operators submit bundles via the Worker, which validates a credential and writes to R2 on their behalf. R2 IAM credentials never leave the central team.
2. **Catalog regeneration** — after a write, the Worker rebuilds `catalog.json` from the current bucket contents (or appends, depending on size). This keeps the catalog consistent without requiring publishers to manage it manually.
3. **Optional GitHub mirroring** — on successful R2 write, the Worker can also commit the bundle to a GitHub repository via the GitHub API, providing the disaster-recovery mirror automatically.

The Worker is small: roughly 200 lines of TypeScript. It is deployed once during initial library setup and rarely changes thereafter. Source lives in `infra/publish-worker/` in the LyriCue repository so the church can review/audit/redeploy it on their own.

**Cost projection (Cloudflare):**

| Year | Library size | Estimated cost |
|---|---|---|
| 1 (60 campuses, ~500 songs) | ~5 GB | $0 |
| 3 (~1500 songs) | ~15 GB | ~$0.15/mo |
| 5 (200 campuses, ~3000 songs) | ~50 GB | ~$0.60/mo |
| 10 (1000 campuses, ~10000 songs) | ~500 GB | ~$7/mo |

Worker requests are vastly within the free tier (100k/day) — even with 1000 campuses polling daily and publishing weekly, we use roughly 100/day.

### 8.3 R2 Bucket Layout

```
lyricue-library/                  (R2 bucket)
├── catalog.json                     (master index, regenerated by Worker)
├── trust.json                       (optional: org's trusted signing public keys)
├── songs/
│   ├── <songId>/
│   │   └── <version>.wstiming       (immutable; new version = new file)
│   └── ...
├── projects/
│   ├── central/
│   │   └── <date>-<slug>.project.json
│   └── campuses/
│       └── <campusId>/
│           └── <date>-<slug>.project.json
└── meta/
    ├── campuses.json                (roster — optional)
    └── publish-log.jsonl            (append-only audit trail)
```

The structure is deliberately simple — no hierarchical mutex, no complex versioning database. Versions are encoded in filenames (`<version>.wstiming`); old versions stay accessible forever (immutable). The catalog tells clients which version is current.

### 8.4 Identity Setup — First-Run Wizard

When a volunteer AV operator launches LyriCue for the first time, the wizard runs:

```
Welcome to LyriCue
─────────────────────────────────────────────────────────
Step 1: Audio Input
  Choose the audio device you'll use during worship.
  [Sound Desk Line-In  ▼ ]   [Test]
                                                     [Next]

Step 2: Library Connection (Optional)
  If your organization has a shared song library,
  paste the URL here:
  [ https://library.hillside.church           ]
  [Connect]   [Skip — set up later]
                                                     [Next]

Step 3: Identity
  Detected: Hillside Church
  Which campus?
  [Pretoria North  ▼ ]   [Create new campus...]

  Your name (optional, for attribution):
  [ Thabo                           ]
  [☑] Show my name when I publish songs
  [☐] Stay anonymous
                                                     [Next]

Step 4: Publish Access (Optional)
  Most operators don't need this. Skip unless your
  IT lead gave you a publish credential.
  [ Paste credential here          ]
  [Test]   [Skip]
                                                     [Next]

Step 5: Done
  You're ready to use LyriCue.
  Open Settings later if you need to change any of this.
                                                   [Finish]
```

For the typical volunteer, steps 2 and 4 are quick. The whole wizard is under a minute. The default path (no library credential, anonymous user) leaves the install in a fully functional state — they can use LyriCue immediately with locally-learned songs only.

### 8.5 Mixed-Mode Project Sources

Every service in LyriCue ultimately runs from a **Project** (a setlist). A project can come from one of three sources, and the operator picks per-service:

```
Setlist Source
─────────────────────────────────────────────────────
  ● From central library:  2026-05-17 — Sunday Morning
  ○ My local project:      [pick from dropdown ▼ ]
  ○ Build a new one
─────────────────────────────────────────────────────
                                            [Continue]
```

**From central library:** LM fetches the central project plan. LyriCue downloads any bundles referenced in the plan that aren't already local. The Setlist Panel shows the central plan with central-version badges next to each song.

**My local project:** Standard FreeShow Project, opened as today. Bundles can be from any source (locally learned, imported from library, hand-built). No central plan involvement.

**Build a new one:** Combines elements — start from blank, drag in any local or library song. After saving, the project can optionally be published as either a "central plan" (requires central credential) or a campus-scoped plan (visible to that campus only, or to the org if marked public).

This is **mixed-mode equality**: neither path is the "real" mode. A campus can use central plans every Sunday or never; the architecture doesn't favor either.

### 8.6 Installer Strategy

#### Per-Platform Artifacts

| Platform | Installer | Architecture | Approx Size |
|---|---|---|---|
| macOS arm64 (M1+) | `.dmg`, signed + notarized | arm64 | ~700 MB |
| macOS x86_64 (Intel) | `.dmg`, signed + notarized | x86_64 | ~720 MB |
| Windows x86_64 | `.exe` (NSIS) or `.msi`, code-signed | x86_64 | ~800 MB |
| Linux x86_64 | `.AppImage` + `.deb` | x86_64 | ~780 MB |
| Linux arm64 | `.AppImage` + `.deb` | arm64 | ~780 MB |

All produced by electron-builder via existing FreeShow build configuration, extended with:

1. **`extraResources`** entry pointing to the platform-specific PyInstaller-bundled sidecar.
2. **`asarUnpack`** for the sidecar (sidecar binaries can't run from inside an asar archive — they need to be on the filesystem).
3. **Code signing certificates** — macOS Developer ID for notarization, Windows EV code-signing cert. Signing prevents OS-level "this app is from an unidentified developer" warnings that would scare volunteer operators.

#### Build Pipeline

```
GitHub Actions matrix (5 platform jobs):
  1. Build Python sidecar via PyInstaller for target platform/arch
     output: sidecar binary in build/sidecar/<platform>-<arch>/
  2. Run electron-builder for target platform/arch
     - Bundles FreeShow + LyriCue TS code
     - Includes sidecar binary as extraResources
     - Signs with platform code-signing cert
  3. Upload installer to GitHub Releases as a release artifact
  4. Optionally: notify the church's IT lead via webhook
```

The church installs by downloading the appropriate installer from the church's GitHub Releases page (or a mirror). Auto-update is handled by `electron-updater` (FreeShow's existing mechanism) — pointed at the church's release feed rather than upstream FreeShow's.

#### What This Saves the Church

- **No Python installation** at any campus. The bundled sidecar is self-contained.
- **No model download** as a separate manual step — first-run model fetch is built into the wizard and gates only the features that need it.
- **No terminal commands.** Ever.
- **No `pip install`, no `npm install`, no `apt install`.** A volunteer can install LyriCue the same way they install any other macOS or Windows app.

### 8.7 The GitHub Mirror — Disaster Recovery

R2 is reliable but it's a single vendor. The GitHub mirror gives the church a second source the same data lives in, in a format anyone can audit.

**Mirror mechanism:** The publish Worker, after a successful R2 write, makes a GitHub API call (`PUT /repos/{org}/lyricue-library/contents/{path}`) to commit the same bundle to a public GitHub repository. The commit message follows a structured format so the history is human-readable: `publish(way-maker): version 2024-001 by pretoria-north`.

**Fallback behavior in the client:** LM is configured with `primaryUrl` (R2) and optional `mirrorUrl` (GitHub raw). On any HTTP failure from the primary, LM falls through to the mirror automatically and surfaces a UI hint ("Library is unreachable — used backup mirror"). The operator can then either ignore (everything still works) or investigate.

**What the mirror does not do:**
- Does not accept writes from clients (GitHub PAT for the central team is the only write path, and it's tied to the Worker).
- Does not handle catalog regeneration on its own — it's a passive mirror.

### 8.8 Setup Burden (One Time, Per Church)

Initial library setup happens once per organization. The repository ships a setup script:

```bash
# Run by the church's IT lead, once, on any machine with Node + a Cloudflare account
$ npx @lyricue/setup-library
> Cloudflare account email: it@hillside.church
> Org ID (will be in URLs): hillside-church
> Org name: Hillside Church
> Create R2 bucket [Y/n]: Y
  → Created bucket: lyricue-library
> Deploy publish-worker [Y/n]: Y
  → Deployed: https://lyricue-publish.hillside.workers.dev
> Generate central signing key [Y/n]: Y
  → Saved private key to: ~/lyricue-central-signing.key
  → Public key published to library trust.json
> Generate central publish credential [Y/n]: Y
  → Saved credential to: ~/lyricue-central-credential.txt
> Create GitHub mirror repo [Y/n]: Y
  → Created: github.com/hillside/lyricue-library
> Setup complete!
> Library URL for campus installers: https://lyricue-library.hillside.church
```

Estimated time end-to-end: under 15 minutes assuming a Cloudflare account already exists. The script is idempotent — re-running it updates the Worker without destroying data.

### 8.9 Operational Notes

| Concern | Approach |
|---|---|
| **Backups** | R2 is durable (99.999999999%) and the GitHub mirror is the secondary. For a third copy, the IT lead can run `wrangler r2 object get --recursive` quarterly and archive. |
| **Audit log** | The publish Worker appends every write to `meta/publish-log.jsonl` (append-only). Tells the central team what was published, by whom, when. |
| **Revoking a credential** | Edit the Worker's credential list and re-deploy (under 1 minute). Old credentials stop working immediately. |
| **Removing a song** | Edit `catalog.json` directly (Cloudflare dashboard or via Worker admin endpoint) to remove the entry. Old bundle files remain in the bucket — harmless, since they're no longer indexed. |
| **Recovering from a bad publish** | Bundles are immutable per-version. To "undo," publish a new version with the fix and update `catalog.json` to point to it. Old version remains downloadable for any campus that already imported it. |
| **Updating the publish-worker** | `wrangler deploy` from the worker repo. No campus impact. |

### 8.10 Why Not a Traditional Backend

I considered (and rejected) a more traditional architecture: a Node.js server on a VM with a Postgres database holding catalog + signed-URL generation. Rejected because:

- **Maintenance burden** — that server has to be patched, monitored, backed up. The church doesn't have full-time SRE staff.
- **Cost** — even a $5/mo VM is more expensive than R2 + Worker at our scale, and that's before adding the DB.
- **Reliability** — Cloudflare's edge is more reliable than anything the church can self-host without significant investment.
- **Scaling** — R2 + Worker scales effortlessly from 60 to 6000 campuses without architectural change.

The Static-Files-Plus-Tiny-Worker pattern is well-suited to read-heavy, append-mostly, low-concurrency workloads — which is exactly the shape of a church song library.

---

## 9. Architecture Decision Records (ADRs)

ADRs document the *why* behind decisions that have non-obvious trade-offs. Each ADR lists the context, the options considered, the decision, and the consequences accepted.

### ADR-1: Sidecar JSON for Timing Maps (not embedded in `.show`)

**Status:** Accepted (also recorded as resolution to OQ1 in PRD §10).

**Context:** Timing maps contain ~50–500 words per song × per-word `(startMs, endMs, confidence)` × additional structural data. A 5-minute song's timing map is typically 30–80 KB JSON. FreeShow's `.show` files are JSON; embedding timing maps would significantly bloat them.

**Options:**

A. Embed timing map in `Show.meta.lyricue`.
B. Sidecar file `<showId>.timing.json` in a dedicated LyriCue subdirectory, with a pointer in `Show.meta`.
C. Single combined index file `<userData>/lyricue/all-timing-maps.json`.

**Decision:** B.

**Rationale:**
- A bloats `.show` files for every show, even shows the user never learned. Backup, sync, and version-control tools see large diffs.
- C creates a single point of failure (one corrupted index = all maps lost) and concurrency hazards (two save operations racing on one file).
- B isolates each map per show, preserves `.show` backwards compatibility (removing LyriCue leaves a slightly-extra-meta-field-but-otherwise-valid `.show`), and matches FreeShow's existing per-show file conventions.

**Consequences accepted:**
- Two files per learned song (`.show` + `.timing.json`); slightly more file-system noise.
- Need to keep them in sync (orphaned `.timing.json` files after show deletion). Mitigated: TM listens for show-delete events and cleans up.

### ADR-2: Python Subprocess for ML (not native Node addon or WebAssembly)

**Status:** Accepted (resolution to OQ3 in PRD). **Amended 2026-05-13** to require PyInstaller bundling in MVP (see ADR-14) rather than v1.1.

**Context:** Demucs and WhisperX are mature in Python, backed by PyTorch. Porting to Node-native or WASM is not feasible in MVP timeline.

**Options:**

A. Spawn Python subprocess; JSON-RPC over stdin/stdout.
B. Spawn Python subprocess; local HTTP server inside Python.
C. WebAssembly ports of underlying models (not viable for Demucs in 2026).
D. Cloud API (violates P1 offline-first).

**Decision:** A.

**Rationale:**
- A is simpler than B (no ports, no HTTP server lifecycle, no auth) and equivalent in performance for our message volumes.
- A's failure modes are crisper: subprocess crash = pipe closes = controller observes immediately.
- C is the long-term direction (NFR6.3 hints at it) but is post-MVP.
- D fails P1 and adds operating cost to a free tool.

**Consequences accepted:**
- The Python sidecar must be PyInstaller-bundled in MVP (see ADR-14) — system Python is not assumed. This was originally scoped to v1.1 in the PRD's OQ3 resolution but the multi-campus zero-config install requirement (P9) brings it forward.
- All cross-language data crosses a JSON boundary (some serialization cost; acceptable for the data volumes involved — timing maps are 30–80 KB).
- Per-platform-per-architecture build matrix (5 targets: macOS arm64/x86_64, Windows x86_64, Linux x86_64/arm64) — added to CI.

### ADR-3: Whisper.cpp via Native Addon for Live STT

**Status:** Accepted (resolution to OQ4 in PRD).

**Context:** PRD originally specified Web Speech API; investigation showed it requires internet (violates P1).

**Options:**

A. Web Speech API. Rejected — requires internet.
B. WhisperX in the Python sidecar, run in streaming mode alongside the learning pipeline.
C. Whisper.cpp via Node.js native addon.
D. Whisper.cpp via WebAssembly in the renderer.

**Decision:** C.

**Rationale:**
- C runs in-process with the renderer; no IPC for the audio stream. Lowest latency.
- B requires the Python sidecar to be running during live worship, contradicting "on-demand" sidecar model and adding a process-management burden during the most uptime-sensitive code path.
- D works but is meaningfully slower than C on CPU-bound matrix math; FreeShow already builds native modules via electron-builder so we already have the infrastructure.

**Consequences accepted:**
- Per-platform addon binaries (Windows x64/arm64, macOS x64/arm64, Linux x64/arm64). Electron-builder handles this.
- Native addon size adds ~5–10 MB per platform to the distribution. Whisper model adds another ~75 MB (downloaded on first use, not bundled).

### ADR-4: Karaoke Output as New Output Type (not modification of existing renderer)

**Status:** Accepted (resolution to OQ2 in PRD).

**Context:** FreeShow's Output component (`Output.svelte`) is mature and handles backgrounds, overlays, transitions, audio, timers, and more. Modifying it to support per-word highlighting risks breaking unrelated FreeShow functionality.

**Options:**

A. Modify `Output.svelte` to support a `karaoke` mode.
B. Create a parallel `KaraokeOutput.svelte`, mounted instead of `Output.svelte` when `outputs[id].karaokeMode === true`.
C. CSS-only overlay on top of the existing Output.

**Decision:** B.

**Rationale:**
- B is the minimally-invasive option. The existing Output renderer is untouched. LyriCue's renderer is self-contained.
- A increases the test surface of FreeShow's core renderer and the risk of upstream merge conflicts during the fork phase.
- C cannot achieve word-level highlighting because the existing renderer doesn't expose per-word DOM nodes.

**Consequences accepted:**
- Two renderers to maintain (FreeShow's standard + LyriCue's karaoke). This is intentional: we get the "operator can fall back to standard FreeShow output" property for free, which directly supports graceful degradation (P2).

### ADR-5: Meyda over Essentia.js for Beat Detection

**Status:** Accepted.

**Context:** Both libraries provide real-time audio feature extraction in the browser/Electron.

**Options:**

A. Meyda.
B. Essentia.js (WebAssembly port of Essentia).
C. Roll our own using AudioContext + AnalyserNode + custom FFT.

**Decision:** A.

**Rationale:**
- Meyda is smaller (~100 KB vs. ~10 MB for Essentia.js's WASM), is pure JS, and has lower setup overhead.
- Essentia.js has more features, but our needs (onset detection + autocorrelation tempo) are within Meyda's scope.
- C is unnecessary work; Meyda gives us spectral flux, RMS, and a clean Web Audio integration out of the box.

**Consequences accepted:**
- If beat tracking quality is insufficient in field testing, we can swap Meyda for Essentia.js or a custom DSP without changing the BD module's external interface (`liveBPM`, `tempoRatio`, `confidence`).

### ADR-6: requestAnimationFrame for the Sync Loop (not setInterval, not Web Worker)

**Status:** Accepted.

**Context:** The sync engine updates per-frame state at ~30+ Hz to drive smooth karaoke highlighting.

**Options:**

A. `requestAnimationFrame` on the main renderer thread.
B. `setInterval(tick, 16)` on the main thread.
C. Web Worker with `setInterval`, posting to main thread per tick.

**Decision:** A.

**Rationale:**
- A naturally syncs to display refresh, won't tick when the window is hidden (which is fine for the karaoke output but the **main window** could be hidden during live worship — we explicitly handle this by keeping the sync engine in the **main window**, which the operator keeps focused; alternatively, an OffscreenCanvas hack in a worker is possible but unnecessary for MVP).
- B can drift over time and produce missed frames.
- C adds IPC overhead per tick and complicates the audio analysis pipeline (Web Audio API needs to be in the same thread as the analyzer).

**Consequences accepted:**
- The sync engine pauses if the main window is fully minimized/hidden. The operator must keep the main window visible during worship; this matches existing FreeShow operator workflow (they need the control panel anyway).

### ADR-7: Atomic Write for Timing Map Saves

**Status:** Accepted.

**Context:** A power loss or crash mid-save could corrupt a timing map.

**Decision:** Write-to-temp + rename. Standard atomic-write pattern.

**Rationale:** Cheap, reliable, satisfies NFR2.1.

**Consequences accepted:** None significant; temp file is briefly present on disk.

### ADR-8: 3-Word Phrase Window for STT Position Correction

**Status:** Accepted (resolves design space for FR4.6).

**Context:** Whisper.cpp will return some misrecognized words. Single-word matching produces frequent false-positive jumps; longer windows reduce false positives but increase false negatives and latency.

**Options:**

A. 2-word window.
B. 3-word window (PRD-suggested default).
C. 5-word window.
D. Confidence-weighted variable window.

**Decision:** B, configurable via `positionCorrectionMinWords`.

**Rationale:**
- Empirically (per Whisper.cpp benchmarks), 3-word phrases give ~98% specificity on worship lyrics in 2-second audio windows.
- 5-word would push position-correction latency past the NFR1.5 budget (1 second) given STT latency.
- D is a v1.1 enhancement; for MVP, configurable static window is simpler and adequate.

**Consequences accepted:**
- Brief lyric overlaps between sections (e.g., a 3-word phrase that appears in both verse 1 and verse 2) may produce a "wrong section" correction. Mitigated by SE's "smallest forward jump" tie-break heuristic (§4.7).

### ADR-9: GPL-3.0 Licensing

**Status:** Accepted (resolution to OQ5).

**Context:** FreeShow is GPL-3.0 (copyleft). All ML deps are MIT/BSD (permissive).

**Decision:** LyriCue ships GPL-3.0.

**Rationale:** Required by FreeShow's copyleft license — derivative works must inherit GPL-3.0. The MIT/BSD deps are GPL-3.0-compatible (permissive licenses can be aggregated into copyleft works).

**Consequences accepted:**
- Anyone redistributing LyriCue must do so under GPL-3.0.
- Commercial forks possible but must remain open source.
- The non-English wav2vec2 models (CC-BY-NC) are excluded from MVP; we use only MIT-licensed alignment models initially.

### ADR-10: Forward-Only Schema Migration

**Status:** Accepted.

**Context:** Timing map schema (`lyricue-timing-v1`) will evolve. Old files must keep working as we evolve.

**Decision:** Schema version in every file. Loader detects version and applies forward-only migrations (`v1 → v2 → v3 ...`). No backward migration. Breaking changes always bump major schema version.

**Rationale:**
- One-way migration is simpler than two-way; the common case is "user opens old file, we silently upgrade."
- Backward migration is needed only if a user downgrades the app — a rare path that we don't optimize for in MVP.

**Consequences accepted:**
- Once a user opens a timing map with a newer LyriCue version, the file is upgraded on next save; the older LyriCue version cannot read it.
- Documented in the user-facing release notes.

### ADR-11: Cloudflare R2 + Worker for the Multi-Campus Song Library

**Status:** Accepted (replaces and supersedes the original FR11 "peer-to-peer-with-optional-community-library" framing for the multi-campus 60-campus deployment).

**Context:** The 60-campus deployment requires a central library that scales to hundreds of campuses, doesn't impose ongoing cost on the church, requires no IT staff to operate, and remains fully usable offline once songs are downloaded.

**Options:**

A. Self-hosted server (Node + Postgres on a VM).
B. AWS S3 + CloudFront.
C. Cloudflare R2 + optional Cloudflare Worker for writes/catalog.
D. Firebase Storage.
E. Supabase Storage.
F. GitHub repository (raw file URLs).
G. Backblaze B2 via Cloudflare CDN (Bandwidth Alliance, free egress).

**Decision:** C, with F as a fallback mirror.

**Rationale (with the research that informed it):**

| Option | Free egress at scale? | Free storage | Auto-pause? | Verdict |
|---|---|---|---|---|
| A. Self-hosted | N/A | N/A | N/A | Maintenance burden + cost; rejected (see §8.10) |
| B. S3 + CloudFront | No (~$0.09/GB) | Limited | No | Functional but ongoing cost grows with campuses |
| **C. Cloudflare R2 + Worker** | **Yes, unlimited** | **10 GB free, $0.015/GB beyond** | No | **Best fit** |
| D. Firebase Storage | 10 GiB/mo only | 5 GB free | No | Caps egress; Google has retired free tiers before |
| E. Supabase Storage | 5 GB/mo only | 1 GB free | **Yes, after 7 days idle** | **Disqualifier** — a paused library breaks Sundays |
| F. GitHub Pages/raw | 100 GB/mo soft limit | Unlimited (within 1 GB recommended) | No | Excellent fallback mirror; weak as primary (`git push` workflow not for volunteers) |
| G. B2 + Cloudflare | Unlimited via CDN | 10 GB free | No | Solid alternative; equivalent to C if the church already has Backblaze |

R2's unlimited free egress is the killer feature for this workload: every other option creates an egress meter that scales with church size. R2 lets the cost ceiling stay at $0 for years and at single-dollar monthly even at 10× current scale.

**Consequences accepted:**
- Single-vendor dependency on Cloudflare for the primary library. Mitigated by the GitHub mirror (ADR amendment below).
- Requires a Cloudflare account to set up (free signup, no credit card needed until usage exceeds free tier).
- The publish Worker adds ~200 lines of TypeScript to maintain; offset by the operational simplicity vs. running a real backend.

**ADR amendment for GitHub mirror:** The same bundles are mirrored to a public GitHub repository, written automatically by the publish Worker via the GitHub API. LyriCue clients use the GitHub raw URL as a fallback when R2 is unreachable. This makes the church's library multi-source from day one and provides disaster recovery without adding operational complexity.

### ADR-12: Mixed-Mode Project Sources (Centralized + Autonomous on the Same Install)

**Status:** Accepted (derived from the multi-campus "Mixed by intent" requirement).

**Context:** The 60 campuses include some that follow a central plan every Sunday, some that plan independently, and many that mix the two (central for big services, local for midweek). The architecture must support all three patterns on the same install without feature gating.

**Options:**

A. Two separate modes selected at install time ("hub" install vs. "spoke" install).
B. Single install supporting both via a per-service "project source" picker (central / local / new).
C. Master/replica with central as the source of truth and local edits as overrides on top.

**Decision:** B.

**Rationale:**
- A creates artificial install-time choice that locks the campus in. Real churches mix modes regularly (a campus might host the regional conference once a year).
- C imposes a hierarchy (central is "truth") that doesn't match the federated nature of multi-campus churches where each campus has real autonomy.
- B treats Projects as portable artifacts that can come from any source, with provenance tagged but not gating use.

**Consequences accepted:**
- Slightly more UI complexity (the per-service "source" picker).
- Provenance tracking is required (which is good for audit anyway).
- Local edits to imported projects produce divergence that the operator must explicitly choose to reconcile, fork, or discard.

### ADR-13: Optional Ed25519 Signing of Library Bundles

**Status:** Accepted (opt-in feature, default off).

**Context:** A library URL is publicly readable, which is fine for the workload, but means a bundle could in principle be injected if an attacker compromised the R2 bucket or the GitHub mirror. For a 60-campus church, ensuring "this came from our central team" matters more than for a single-church user.

**Options:**

A. No signing; trust the URL.
B. Mandatory signing of all bundles.
C. Optional signing, enabled per-org.
D. TLS + bucket ACLs only (already in place).

**Decision:** C.

**Rationale:**
- A is fine for a single church or low-stakes setup; risky for 60 campuses where a malicious central bundle could disrupt every Sunday service.
- B is overkill for small churches that don't need it and adds setup friction.
- C lets small deployments skip it entirely and large deployments enable it during setup. The setup script offers it as a Y/n prompt.
- D is necessary baseline (TLS is non-negotiable) but doesn't address bucket compromise.

**Consequences accepted:**
- Two more files to manage (private signing key on the central team's machine, trust.json in the bucket).
- Unsigned bundles on a signing-enabled install produce a warning, not a rejection (an operator can override).
- Key rotation is manual — the setup script supports adding a new key while keeping the old one trusted during a transition period.

### ADR-14: PyInstaller-Bundled Sidecar in MVP

**Status:** Accepted (amends ADR-2; brings forward from v1.1 to MVP).

**Context:** Original ADR-2 assumed system Python 3.10+ at MVP and bundled sidecar at v1.1. The 60-campus zero-config install requirement (P9) makes Python-install friction unacceptable in MVP.

**Decision:** Ship a PyInstaller-bundled sidecar binary per platform/arch as part of the MVP installer.

**Trade-offs accepted:**

| Cost | Mitigation |
|---|---|
| App installer grows from ~200 MB to ~700–900 MB | One-time download; acceptable in 2026 |
| Build matrix grows (5 targets × Electron + 5 × PyInstaller) | CI handles; cached layers |
| Bundle size includes PyTorch (~500 MB compressed) | Use `torch-lightweight` build flags; could swap to ONNX Runtime in v2.0 |
| Slower initial bundle build in CI | One-time cost per release; acceptable |
| Slight startup-time hit when first launching the sidecar (PyInstaller cold start ~1–2s) | Lazy-spawn on first learn job; not on app startup |

**Alternative considered:** Ship a tiny downloader/installer for the sidecar that fetches Python + deps on first launch. Rejected because:
- It just defers the friction, doesn't remove it (still needs internet + ~800 MB download).
- It creates a partial-install failure mode (Electron app present, sidecar missing).
- A bundled installer is dumber, more reliable, and matches user expectations for desktop apps.

### ADR-15: Operator-Triggered Library Sync (No Background Polling)

**Status:** Accepted (derived from the manual-pull-only sync mode decision).

**Context:** The library client could poll the catalog on a schedule, push notifications of new content, or auto-download relevant updates. Or it could only fetch when the operator explicitly asks.

**Decision:** Manual pull only. The library is consulted only when the operator clicks "Check for updates" or "Download" or "Publish."

**Rationale:**
- Predictability during rehearsal and live worship beats freshness. An auto-update mid-rehearsal that changes a timing map you were about to use is worse than missing the update.
- No background sync simplifies the threat model (network calls happen only at operator-attributed moments).
- It matches the operator's existing mental model (they already manually "load" a setlist; this is one more step in the same pattern).

**Consequences accepted:**
- Operators must remember to check for updates. The UI mitigates this by showing the time-since-last-check prominently and a one-click "Check Library" button.
- The catalog's `updatedAt` is shown in the UI so the operator knows the cache age.
- A campus could miss a central-team update if they don't check. This is preferable to surprise updates breaking a service.

### ADR-16: Dual-Mode Deployment (Fork + Sister Service in Parallel)

**Status:** Accepted (most significant architectural decision; supersedes the implicit single-mode assumption in earlier ADRs).

**Context:** The original architecture (rev. 1) assumed LyriCue would ship as a FreeShow fork in MVP and seek upstream merge in v1.1+ (per ADR-9 / OQ6). Deep research into FreeShow's contribution culture (summarized below) showed this assumption was optimistic.

**Research summary** (full report in the planning conversation, key facts):
- FreeShow is effectively a single-maintainer project (Kristoffer Vassbø, vassbo). 98% self-merge rate.
- No published governance, no CONTRIBUTING.md, no CLA, no PR template, no CI on PRs.
- Outside contributors do land substantial features — but **only when extending existing FreeShow concepts**. Big multi-concern PRs get partially merged or rejected.
- Vassbo's stated philosophy on novel integrations is *"compose from existing primitives, don't add new subsystems"*. He routed a live-translation request to "use the existing Caption item + Caption.ninja via the Website item" — Caption.ninja being a standalone external companion service.
- **Zero existing FreeShow issues** request word-level lyric sync, karaoke, or auto-advance. We're not riding latent demand.
- No plugin/extension system exists or is on the roadmap.

**Conclusion from research:** A 10-touchpoint upstream merge of LyriCue in MVP timeframe is unlikely (assessed as **low** probability within 12 months). The biggest single risk is the Python sidecar + ML runtime distribution footprint, which is a release-engineering decision only vassbo can make and which permanently changes FreeShow's installer profile.

**The decision:** Don't bet the project on either pure-fork or pure-sister-service. Build for both modes from one codebase via the `OutputAdapter` abstraction (§4.9). Ship MVP in fork mode; in parallel, propose a small upstream PR (Captions word-highlight extension); if it lands, sister-service mode becomes a first-class deployment option; if it doesn't, sister-service mode is still available with a degraded `OwnWindowOutputAdapter` for churches that prefer it.

**Options considered:**

A. **Pure fork only.** LyriCue is a permanent FreeShow fork.
   - Pros: Maximum rendering fidelity. One codebase, one mental model.
   - Cons: Perpetual merge maintenance (~100–200 hours over 3 years). No upstream path. Reinvents FreeShow's distribution.

B. **Pure sister service only.** LyriCue runs alongside an unmodified FreeShow.
   - Pros: Zero in-tree changes. Independent release cadence. Clean separation.
   - Cons: Cannot drive FreeShow's renderer at per-pixel fidelity without an upstream PR. Either accept degraded rendering or own the projector output ourselves (two apps).

C. **Pure sister service + planned upstream PR.** Build for sister service; bet on the PR landing for full fidelity.
   - Pros: Smallest fork-maintenance surface. Clear upstream story.
   - Cons: Project is idle on full fidelity until the PR lands; bet on a single PR's success.

D. **Dual-mode from day one** *(the decision)*. Build OutputAdapter abstraction; ship fork mode in MVP; parallel-track an upstream PR for the sister-service-with-fidelity path.
   - Pros: MVP ships at max fidelity; upstream-PR success unlocks lower-maintenance mode; PR failure has a graceful degradation. Never stuck waiting on external decisions.
   - Cons: Slightly more code (the adapter abstraction + two adapter implementations). 80–120 extra lines of architecture; comparable extra implementation work.

**Decision:** D.

**Rationale:**
- The core insight: **95% of LyriCue is mode-agnostic.** Only the rendering surface differs. The OutputAdapter abstraction (~50 LOC interface) is the entire bet.
- D dominates A on long-term maintenance and dominates B/C on time-to-market and risk.
- D matches the user's stated principle: *"don't get stuck being idle waiting for something that might or might not happen."*

**Consequences accepted:**
- Two adapter implementations to maintain (`ForkOutputAdapter`, `OwnWindowOutputAdapter`) in MVP, possibly three after the upstream PR (`CaptionInjectionOutputAdapter`).
- Two installer flavors during the transition period (fork build, sister build). Most code shared.
- The upstream PR is a real piece of work (~150 LOC, plus the discussion / advocacy with vassbo). Not free, but bounded.
- Some additional design surface (mode selection during first-run wizard, settings to switch modes post-install).
- If the upstream PR is rejected, the sister-service mode is still viable via `OwnWindowOutputAdapter` — just with the two-app operator workflow. We document this fallback clearly so it's not a surprise.

**Action items derived from this ADR:**
1. Draft and open the Captions word-highlight extension PR against FreeShow during Phase 4 (specifically: early in implementation, so we know vassbo's response before we ship MVP).
2. Open a GitHub Discussion in the ChurchApps repo describing the use case and architecture options, as the lower-commitment alternative to a code PR. Use vassbo's response to refine the PR.
3. Build the OutputAdapter abstraction first in Phase 4; both fork and own-window adapter must work before MVP.

### ADR-17: Single Monorepo Layout

**Status:** Accepted (decided 2026-05-13 by the project owner; records the resolution of readiness item 4 from epics.md §8).

**Context:** Per ADR-16 we ship two deployment modes (fork and sister-service) from one codebase. The repository layout determines whether shared code lives in one place or has to be coordinated across multiple repos.

**Options considered:**

A. **Single monorepo** with `apps/fork/`, `apps/sister/`, `packages/core/`, `packages/ui/`. Build-time flag selects mode.
B. **Multi-repo:** `lyricue-core` (npm package) + `lyricue-fork` (FreeShow fork) + `lyricue-sister` (standalone). Core published to a private registry or GitHub Packages.
C. **Single repo, single app** with runtime detection of mode (no build-time flag).

**Decision:** A — single monorepo.

**Rationale:**
- The shared surface (sync engine, beat detection, VAD, STT, timing-map storage, sidecar controller, library manager) is large. Multi-repo would require constant version bumping between three repos for any cross-cutting change.
- npm workspaces is mature and matches FreeShow's tooling family (also npm-based). No need for nx/turborepo at this scale.
- The build-time flag is honest about which mode an installer targets; runtime detection (option C) would mean every binary carries both implementations of the OutputAdapter, bloating installer size.
- Single repository simplifies CI, code search, refactors, and PR review.

**Folder layout:**

```
lyricue/                            (single git repo, monorepo root)
├── apps/
│   ├── fork/                       (fork-mode Electron app — vendors FreeShow as a submodule)
│   │   ├── freeshow/               (git submodule: ChurchApps/FreeShow, pinned to a release tag)
│   │   ├── electron-main.ts        (entry point that boots FreeShow + LyriCue main-process modules)
│   │   ├── package.json
│   │   └── electron-builder.yml
│   └── sister/                     (sister-mode standalone Electron app — does not embed FreeShow)
│       ├── electron-main.ts        (entry point that boots LyriCue standalone)
│       ├── renderer/               (LyriCue's own Svelte UI shell)
│       ├── package.json
│       └── electron-builder.yml
├── packages/
│   ├── core/                       (shared TypeScript modules — mode-agnostic)
│   │   ├── src/
│   │   │   ├── types/              (LyriCue.ts — all shared types)
│   │   │   ├── sync/               (SE — sync engine)
│   │   │   ├── audio/              (AI, BD, VAD)
│   │   │   ├── stt/                (ST)
│   │   │   ├── storage/            (TM)
│   │   │   ├── sidecar/            (SC — sidecar controller)
│   │   │   ├── library/            (LM)
│   │   │   ├── fs/                 (atomic-write utility)
│   │   │   └── settings/           (SettingsStore, IdentityStore, LibraryConfigStore)
│   │   └── package.json
│   └── ui/                         (shared Svelte components — mode-agnostic)
│       ├── src/
│       │   ├── KaraokeOutput.svelte
│       │   ├── SetlistPanel.svelte
│       │   ├── ModeIndicator.svelte
│       │   ├── LearnSongWizard/
│       │   ├── SettingsTab/
│       │   └── ArrangementBuilder.svelte
│       └── package.json
├── python-sidecar/                 (Python ML pipeline — packaged via PyInstaller)
│   ├── lyricue_sidecar/
│   ├── pyproject.toml
│   └── build.py
├── infra/
│   ├── publish-worker/             (Cloudflare Worker)
│   │   ├── src/index.ts
│   │   └── wrangler.toml
│   └── scripts/
│       └── setup-library.ts        (org-setup automation)
├── docs/
│   ├── library-setup.md
│   └── (other end-user / admin docs)
├── .github/
│   └── workflows/
│       ├── build.yml               (5-platform CI matrix)
│       └── release.yml
├── package.json                    (npm workspaces root)
├── tsconfig.base.json
├── .prettierrc.yaml                (matches FreeShow's config exactly)
└── README.md
```

**Build-time flag:** `LC_DEPLOYMENT_MODE=fork|sister` selects:
- Which `apps/<mode>/` entry point electron-builder packages.
- Which OutputAdapter is the default at runtime (overridable in settings post-install).
- Which installer flavor is produced (`lyricue-fork-<platform>.<ext>` or `lyricue-sister-<platform>.<ext>`).

**Shared vs. mode-specific surface:**

| Concern | Where it lives | Why |
|---|---|---|
| Sync engine, audio, STT, storage, sidecar, library, settings | `packages/core/` | Mode-agnostic per ADR-16 — 95% of LyriCue |
| Svelte UI components | `packages/ui/` | Both apps mount the same components |
| FreeShow integration (IPC channel registration, KaraokeOutput mounting in FreeShow's BrowserWindow, settings tab insertion) | `apps/fork/` | Only fork mode touches FreeShow internals |
| Standalone Electron entry, own Electron BrowserWindow management, FreeShow API client | `apps/sister/` | Only sister mode operates without FreeShow as host |
| Python ML pipeline | `python-sidecar/` | Mode-agnostic; same binary for both |
| Cloudflare Worker, library admin scripts | `infra/` | Infrastructure, not bundled into either app |

**FreeShow vendoring strategy:** `apps/fork/freeshow/` is a git submodule pointing at our fork of FreeShow at `https://github.com/njabulozmnisi/lyricue-freeshow.git` (a fork of `ChurchApps/FreeShow`). The submodule is pinned to a specific commit on the `lyricue-integration` branch of our fork. The fork has two branches:

- **`main`** — tracks upstream `ChurchApps/FreeShow/main`. Synced periodically; carries no LyriCue modifications. Used as the rebase base when bumping FreeShow versions.
- **`lyricue-integration`** — branches off a FreeShow release tag (currently `v1.6.0`). Carries the LyriCue 10-touchpoint patches as a small ordered series of commits on top of the tag. **This is the branch the monorepo submodule tracks.**

To bump FreeShow upstream:
1. Sync `main` to upstream (`git fetch upstream && git rebase upstream/main main && git push origin main`).
2. Rebase `lyricue-integration` onto the new desired FreeShow release tag.
3. Resolve any conflicts in the 10 patched files (usually trivial; the touchpoints are deliberately narrow per §7.1).
4. Push the rebased `lyricue-integration`.
5. In the monorepo, `cd apps/fork/freeshow && git fetch && git checkout <new commit>`, then commit the submodule SHA bump.

This strategy gives:
- Exact pin to a known FreeShow + LyriCue-patches state (reproducible builds).
- Clean upstream tracking on a separate branch — `main` of our fork is always a near-identical mirror of `ChurchApps/FreeShow/main`.
- Patches stay reviewable as a small series of commits, not a tangled merge.
- If we ever propose upstream-merging some of the touchpoints, they're already isolated as discrete commits.

The submodule strategy gives all of: exact pin (reproducible builds), deliberate upgrade (no upstream drift), and clear separation between our integration code (under our control in the monorepo) and the FreeShow base (vendored, modified only via the 10 patches on `lyricue-integration`).

**Consequences accepted:**
- Larger initial clone (~200 MB including FreeShow). One-time cost.
- Submodule operational cost (developers occasionally forget `--recurse-submodules` on clone). Documented in README.
- The two app bundles share `packages/core/` and `packages/ui/` but produce separate installers; users who want both modes installed have two installers. Acceptable — most campuses use one mode.

**Consequences rejected:** None significant. Option B's flexibility (independent versioning of core) is not needed at this scale; option C's single-binary convenience isn't worth the installer-size cost.

---

## 10. Non-Functional Requirements Mapping

How each NFR from the PRD is realized in this architecture:

| NFR | Target | Architectural Realization |
|---|---|---|
| NFR1.1 (5min/5min-song learning) | ≤5min | Demucs `htdemucs` ~30s/min audio on 4-core; WhisperX `small` ~20s/min audio. Total ≈ 4 min for a 5-min song. Headroom for I/O. |
| NFR1.2 (100ms audio in→processing) | ≤100ms | Web Audio API + Worklet ≈ 5–20 ms. Meyda buffer (typically 512 samples @ 48kHz = ~11ms). Total ≈ 30 ms. |
| NFR1.3 (≥30fps highlight) | ≥30 fps | requestAnimationFrame at 60fps with CSS `--progress` updates; no per-frame DOM mutation. |
| NFR1.4 (≤200ms beat detection) | ≤200ms | Meyda flux peak detection on 11ms buffer windows. Adaptive threshold reacts within 2–3 buffers (~30ms). BPM smoothing adds 1–2 second on stability but beat events themselves are <50ms latency. |
| NFR1.5 (≤1s STT latency) | ≤1s | Whisper.cpp `base.en` on 5-second window: ~300–800ms. 2-second cadence + ~500ms compute ≈ 2.5s utterance-to-recognition, ~700ms recognition-to-correction. Within NFR with the 2s cadence noted as a soft constraint. |
| NFR1.6 (≤200ms manual response) | ≤200ms | Keypress → SE.onNextSection → store update → CSS update: well under 50ms in practice. |
| NFR1.7 (≤10s extra startup) | ≤10s | LyriCue init is async-deferred; on startup we register stores, load settings, and resolve the Python interpreter path. No model loading at startup (lazy on first learn). |
| NFR1.8 (≤500MB extra RAM) | ≤500MB | Whisper.cpp base model ~75MB + Meyda ~5MB + Svelte component overhead + timing maps in memory (~1MB per loaded song). Comfortably under budget. Python sidecar only spawned during learning. |
| NFR2.1 (no crash during worship) | Zero | Process isolation (P4) + try/catch boundaries around every IPC handler + tier degradation (P2) + atomic file writes (ADR-7). |
| NFR2.2 (85% words ±300ms) | ≥85% | WhisperX accuracy + 30 fps render frame rate ≈ ±33ms frame quantization + tempo smoothing accuracy. Field validation required; architecture supports the budget. |
| NFR2.3 (90% sections ±1s) | ≥90% | Section boundaries come directly from timing map; rendering is exact. Live drift is bounded by tempo ratio smoothing (~1s lag in extreme tempo changes). |
| NFR2.4 (3s audio-loss recovery) | ≤3s | `MediaStreamTrack.onended` handler → tier transition to Timer immediately. |
| NFR2.5 (no app crash on sidecar crash) | Zero | SC observes subprocess exit; updates `SidecarStatus.crashed`; UI surfaces error; no main app death. |
| NFR3.1 (Win/macOS/Linux) | All three | FreeShow already cross-platform; Whisper.cpp native addon and PyInstaller bundles target all three. |
| NFR3.2 (FreeShow compat) | Current + 1 prior minor | Fork-based development tracks current minor; integration touches are minimal (§7) to ease forward porting. |
| NFR3.3 (audio input compat) | All major | Web Audio API delegates to OS audio stack. |
| NFR3.4 (resolution support) | 720p/1080p/4K/UW | KR uses vmin-based sizing + media-query branches for ultrawide. |
| NFR3.5 (Python 3.10+) | MVP requirement | Documented; SC validates on first sidecar use. |
| NFR4.1 (offline live sync) | Required | No network calls in BD, VAD, ST, SE, KR. Audited as part of Phase 4 testing. |
| NFR4.2 (offline learning) | Required | Demucs + WhisperX models are local files. Sidecar spawns offline. |
| NFR4.3 (local storage) | Required | All data under `<userData>/lyricue/`. No cloud calls in default flow. |
| NFR4.4 (online features marked) | Required | UI clearly labels community library as online; toggle off by default. |
| NFR5.1 (no CLI for learning) | GUI-only | Learn Song Wizard handles the entire flow. |
| NFR5.2 (≤3 actions to start sync) | ≤3 | Setlist Panel design (§4.10) confirms 3 actions. |
| NFR5.3 (setup wizard) | First-launch | On first launch detect missing audio device → prompt; missing Python → guide. |
| NFR5.4 (plain-language errors) | Required | All error codes have user-facing messages; structured at the boundary in WS components. |
| NFR6.1 (timing map versioned) | Required | `$schema` field + ADR-10 migration policy. |
| NFR6.2 (renderer decoupled) | Required | KR consumes only stores; SE doesn't know KR exists. KR is replaceable. |
| NFR6.3 (audio analysis decoupled) | Required | SE depends on BD/VAD/ST via store interfaces; mock implementations work for headless CLI usage (post-MVP). |
| NFR6.4 (clean API boundaries) | Required | Sidecar via JSON-RPC; renderer via IPC; storage via typed methods. Documented in §6. |

### Multi-Campus NFRs (derived from §8)

These NFRs were not in the original PRD but emerge from the multi-campus deployment requirement. They are recorded here as architectural commitments that Phase 4 will verify.

| NFR | Target | Architectural Realization |
|---|---|---|
| MC-NFR1 (zero-IT install) | Volunteer installs in <5 min, no terminal | PyInstaller bundle (ADR-14) + signed installer (§8.6) + first-run wizard (§8.4) |
| MC-NFR2 (library scales to 1000+ campuses) | No architectural bottleneck | R2 + CDN; static files (ADR-11) |
| MC-NFR3 (church operating cost ≤$10/mo) | Stays in free/cheap tier | R2 free egress; first 10 GB free; Worker free tier covers 100k req/day (ADR-11) |
| MC-NFR4 (offline-after-sync works fully) | All worship features work without internet after first sync | LM downloads bundles to disk; live worship references local files only (§4.11, §2.1.3) |
| MC-NFR5 (mixed-mode equality) | Central + autonomous on same install | Per-service project source picker (§8.5, ADR-12) |
| MC-NFR6 (anonymous-by-default identity) | No required signup | InstallIdentity allows `isAnonymous: true` (§6.3) |
| MC-NFR7 (single-vendor recovery) | One backend failure doesn't break campuses | GitHub mirror fallback (§8.7, ADR-11 amendment) |
| MC-NFR8 (bundle integrity) | Tampered bundles rejected | SHA256 verification mandatory; Ed25519 signatures optional per-org (ADR-13) |

---

## 11. Risks & Mitigations (Architecture-Specific)

This extends the PRD's risk register with risks introduced specifically by the architecture.

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| PyInstaller bundle bloats app installer to 700+ MB | High | Low | Acceptable for one-time download in 2026; ONNX migration in v2.0 reduces this. |
| FreeShow upstream changes break integration | Medium | Medium | Touch points (§7) are minimal and documented; fork keeps moving; integration tests check each touch point. |
| Whisper.cpp native addon platform issues | Medium | Low | Three platform builds; fall back to disabling STT (FR4.1 setting `sttEnabled`) — sync engine works without STT, just no position correction. |
| Meyda beat detection unreliable on certain genres | Medium | Medium | Tier-down to Timer automatically (FR5.5); operator can also force Timer manually. |
| IPC throughput at 60 Hz becomes a bottleneck | Low | Low | Throttle to 30 Hz if profiling reveals issues; interpolate in KR. |
| Timing map file gets large (10+ minute song) | Low | Low | Schema is compact (~80KB for 5min); 10-min song ≈ 160KB — still trivial. |
| Two output windows (karaoke + standard) drift | Low | Low | Both subscribe to the same SyncFrame stream; FreeShow's IPC is FIFO per channel. |
| Sidecar zombie process on app crash | Low | Low | `process.on('exit')` registers cleanup; on next startup, SC kills any stale sidecar by checking PID file. |
| Concurrent writes to timing map file | Very Low | Medium | Atomic write (ADR-7); LyriCue is single-instance; even on multi-monitor systems, only one main process writes. |
| User installs incompatible WhisperX/Demucs model version | Medium | Low | `check_models` RPC validates compatibility; UI prompts to re-download. |
| Memory leak in 4-hour rehearsal recording | Medium | Medium | Audio capture writes directly to WAV on disk in chunks (not in-memory accumulation); FR8.8 disk cleanup. |

### Multi-Campus-Specific Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cloudflare R2 service disruption during a Sunday | Very Low | Low | All bundles are pre-downloaded; live worship doesn't touch the network. Library check fails gracefully. GitHub mirror provides fallback for new downloads. |
| Compromise of central publish credential | Low | High | Credentials are scoped to write-only on a single Worker; rotation is one Worker redeploy. Ed25519 signing (ADR-13) detects bundle tampering even if the bucket is hijacked. |
| Cloudflare account closure / billing dispute | Very Low | High | GitHub mirror provides independent copy; setup script's idempotency lets the church migrate to any S3-compatible service if needed. |
| Catalog file grows too large for efficient diff | Low | Low | Catalog is just a JSON index, ~1 KB per song. 10000 songs = ~10 MB. Mitigation: paginate / shard by year if it exceeds 50 MB. |
| Campus install drift (different LyriCue versions across campuses) | Medium | Medium | electron-updater pulls from the church's release feed; central team can roll updates progressively. Schema versioning (ADR-10) ensures cross-version interop. |
| Bundle floods (a campus accidentally publishes 500 bundles in a loop) | Low | Medium | Worker rate-limits writes per credential (configurable, default 60/hour). Publish-log audit trail (§8.9) identifies the source. |
| Signing key loss | Low | Medium | Lost private key means no further central-signed publishes until a new key is rolled and re-distributed via the trust.json. The setup script supports key rotation. |
| Wrong campus published a bundle as "central" | Low | Medium | Worker validates credential type; only credentials issued by the central team can write to the `central/` path. Misconfiguration caught at credential setup. |

---

## 12. Build, Distribution, and Deployment

This section covers the build pipeline mechanics. The deployment topology, library hosting, identity model, and installer strategy live in §8 (Distribution & Multi-Campus Architecture) — this section focuses on the build itself and what feeds §8.

### 12.1 Build Pipeline

FreeShow's existing pipeline (Vite + electron-builder + tsc) extended for LyriCue:

- `src/electron/lyricue/` compiled via the existing `tsconfig.electron.json`.
- `src/frontend/lyricue/` compiled via Vite as part of the existing renderer bundle.
- `src/types/LyriCue.ts` shared between both.
- `python-sidecar/` packaged per-platform-per-arch via PyInstaller (per ADR-14); output binaries placed in `build/sidecar/<platform>-<arch>/` and included in the Electron installer as `extraResources` with `asarUnpack` (sidecar binaries can't be loaded from inside an asar archive).

For the native Whisper.cpp addon:
- Dependency: `@nicoder/whisper.node` (or current best-of-breed binding) listed in `package.json`.
- electron-builder rebuilds for the target platform via the existing `postinstall: electron-builder install-app-deps` script.

### 12.2 CI Build Matrix

GitHub Actions runs five parallel jobs (one per target). Each job builds the PyInstaller sidecar first, then runs electron-builder to produce the platform installer:

| Job | PyInstaller target | electron-builder output |
|---|---|---|
| macOS arm64 | macOS arm64 sidecar binary | `.dmg` signed + notarized (arm64) |
| macOS x86_64 | macOS x86_64 sidecar binary | `.dmg` signed + notarized (x64) |
| Windows x64 | Windows x86_64 sidecar binary | `.exe` (NSIS) code-signed (EV cert) |
| Linux x64 | Linux x86_64 sidecar binary | `.AppImage` + `.deb` |
| Linux arm64 | Linux arm64 sidecar binary | `.AppImage` + `.deb` |

All artifacts are uploaded to GitHub Releases. The church's installer URL points to that release feed (per §8.6); electron-updater picks up auto-updates from the same source.

### 12.3 First-Run Experience

The first-run wizard is detailed in §8.4. From the build perspective, the wizard runs only once, then never again unless the user explicitly resets identity in settings. After the wizard:

1. Live sync is usable immediately with locally-learned or library-imported songs.
2. The Whisper.cpp `base.en` model (~75 MB) downloads on first attempt to start live sync with STT enabled — surfaced in UI with a progress bar.
3. Demucs + WhisperX models (~800 MB combined) download on first attempt at song learning — surfaced in UI with a progress bar.
4. All subsequent sessions reuse cached models and skip the wizard.

### 12.4 Update Path

LyriCue rides electron-updater (FreeShow's existing mechanism), pointed at the church's release feed. The bundled sidecar updates as part of the main app update — no separate sidecar update mechanism. The central team controls update cadence for all 60 campuses via the release feed: they can publish a release as "staged" (only some campuses receive it) before promoting to "general availability."

### 12.5 Model Mirror Hosting

The ~875 MB of ML models are not bundled in the installer (would push it past 1.5 GB). They are downloaded on first use from a model mirror configurable per-install:

- **Default mirror:** The same Cloudflare R2 bucket used for the song library (separate prefix: `/models/`). Models are immutable per-version.
- **Fallback:** Hugging Face Hub direct URLs for Demucs/WhisperX; ggerganov's release URLs for Whisper.cpp.
- **Air-gapped / self-hosted option:** The IT lead can pre-stage models on a USB stick or local file server and configure the install to load from there. The first-run wizard accepts a custom model URL.

Model download progress is shown explicitly during the first relevant operation; no silent background downloading.

---

## 13. Glossary

| Term | Definition |
|---|---|
| **AI** (acronym in this doc) | Audio Input Capture module. Distinct from "AI" the umbrella term. |
| **Arrangement** | An ordered sequence of section references for a song; multiple per song supported. |
| **BPM** | Beats per minute. |
| **Confidence** | Per-word alignment confidence from WhisperX (0–1); also used by BD for beat-tracking certainty. |
| **Cursor** | The current playback position in reference-track milliseconds, maintained by SE. |
| **Held note** | A word whose duration exceeds 800 ms in the timing map — triggers pulse animation in KR. |
| **JSON-RPC 2.0** | The wire protocol between Electron main and the Python sidecar. |
| **Karaoke Output** | A new FreeShow output type added by LyriCue that renders word-level highlighting. |
| **Lead time** | Seconds before a section change that the next section begins fading into view; default 2s. |
| **Reference-track time** | Time in milliseconds as captured during song learning; the canonical timing domain. |
| **Section** | A labeled span of a song (Verse 1, Chorus, Bridge, …); maps to a FreeShow slide group. |
| **Sidecar** (process) | The Python subprocess running Demucs + WhisperX. |
| **Sidecar** (file) | `.timing.json` file adjacent to FreeShow's `.show` file. |
| **Sweep** | The left-to-right fill animation within an active word, driven by `wordProgress` 0→1. |
| **SyncFrame** | Per-frame state payload `(slideIndex, wordIndex, wordProgress, tier, vad)` sent from SE to KR. |
| **Tempo ratio** | `liveBPM / referenceBPM`, clamped to [0.7, 1.4]. |
| **Tier** | Control mode: `auto` (full AI sync), `timer` (timer-based advance), `manual` (operator-driven). |
| **Timing map** | The `lyricue-timing-v1` JSON document with per-word timestamps for one song. |
| **VAD** | Voice Activity Detection; energy-based, distinguishes active singing from silence. |
| **`.wstiming`** | Bundle format (ZIP of manifest + timing map + show + arrangements) used for library publication and peer-to-peer sharing. |
| **Bundle** | A `.wstiming` archive — the unit of song sharing in the library. |
| **Campus** | A single physical location of a multi-campus organization; one LyriCue install per location. |
| **Catalog** | The master index (`catalog.json`) at the library root; the only file campuses poll to discover new content. |
| **Central team** | The 1–2 people in a multi-campus organization who publish authoritative song bundles and setlists. |
| **Identity** | The org/campus/user triple stored in each install; tags for attribution, not authentication. |
| **Library** | The shared remote store of song bundles and setlists; hosted on Cloudflare R2 with an optional GitHub mirror. |
| **LM** | Library Manager module (§4.11); handles all library I/O. |
| **Mirror** | The optional GitHub repository that mirrors R2 content for disaster recovery. |
| **Mixed mode** | The architectural commitment that every install supports both central-plan-driven and locally-driven services equally (ADR-12). |
| **Project plan** | A setlist (ordered song sequence) for a specific service; publishable to the library. |
| **Provenance** | Per-artifact record of whether it was learned locally or imported from the library; also tracks whether locally edited. |
| **Publish credential** | The token used to write to the library Worker; held only by installs that publish. |
| **Publish Worker** | A small Cloudflare Worker that fronts R2 for credentialed writes and catalog regeneration. |
| **R2** | Cloudflare's S3-compatible object storage; the primary library host. |
| **Signed bundle** | A bundle whose manifest is Ed25519-signed by a trusted key, allowing tampering detection (ADR-13). |
| **Trust list** | Per-install set of Ed25519 public keys whose signatures we accept as authentic. |
| **OutputAdapter** | The interface that abstracts how SE's per-frame output reaches the projector. Lets one codebase support fork mode and sister-service mode (P11, ADR-16). |
| **Fork mode** | Deployment where LyriCue code is integrated into a FreeShow fork; the operator runs one combined app. Uses `ForkOutputAdapter`. |
| **Sister-service mode** | Deployment where LyriCue is a standalone Electron app driving FreeShow externally via its APIs. Uses `OwnWindowOutputAdapter` or `CaptionInjectionOutputAdapter`. |
| **Captions extension PR** | The proposed small upstream PR to FreeShow adding a `highlightMode: 'word-sweep'` option to the Captions item. Enables full-fidelity sister-service mode. |

---

*BMAD Phase 3: Solutioning — Architecture Document*
*Status: DRAFT rev. 2 — multi-campus distribution architecture added*
*Author: Architect Agent*
*Date: 2026-05-13*
*Input: product-brief.md (Phase 1), PRD.md (Phase 2)*
*Source analysis: FreeShow v1.6.1-beta.2 codebase (ChurchApps/FreeShow)*
*Revision history:*
*  - rev. 1 (2026-05-13): Initial draft, single-church deployment*
*  - rev. 2 (2026-05-13): Added §2.1 (offline+hardware+no-LLM), §8 (multi-campus distribution), LM module, identity/library schemas, ADRs 11–15, MC-NFRs, multi-campus risks*
*  - rev. 3 (2026-05-13): Dual-mode deployment (P11, ADR-16). Added OutputAdapter abstraction (§3.3, §4.9), sister-service integration path (§7.8). Informed by deep research on FreeShow contribution culture: upstream merge of large feature is low-probability; sister-service is the maintainer's preferred pattern (Caption.ninja precedent). The architecture now supports fork mode for MVP and sister-service mode as a parallel track, with a small upstream PR proposed in parallel.*
*Next: Phase 3 — Epics & Stories → Implementation Readiness Check*
