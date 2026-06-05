# LyriCue Completion Roadmap — 2026-05-19

This roadmap supersedes the stale 2026-05-16 handoff snapshot. It reflects current `main` after M2-close work plus the Gate A local MVP hardening commits through 2026-06-05.

## Current State

LyriCue has a working sister-mode vertical slice: dual Electron windows, real SyncEngine, synthetic audio driver, operator control panel, karaoke output, local sidecar song-learning contracts, setlist/arrangement/translation/rehearsal/library surfaces, and a local quality gate. The current local test floor is:

- TypeScript/Vitest: 703 tests passing.
- Python sidecar: 77 tests passing.
- Python sidecar with optional ML dependencies on Python 3.11: 77 tests passing.
- `svelte-check`: 0 errors / 0 warnings on the current UI slice.
- Sister karaoke and operator renderer bundles build.
- Gate A Electron smoke passes with `LC_SMOKE_TEST=1` against the real sister-mode dual-window app.
- Local Gate A close QA has no open critical/high walking-skeleton defects.

The project is not yet production-shippable for a multi-campus rollout because several release gates require real external assets, credentials, hardware, or packaged-binary validation.

## Epic Stocktake

| Epic | Current status | Completion | Local ship state | Unexpected things that popped |
|---|---:|---:|---|---|
| EP-01 Foundation | Mostly complete, local CI added | 85% | Local development foundation works | Full 10-job installer matrix is blocked by platform runners/signing/vendor SDKs; stale shell `NODE_PATH` required the `env -i` wrapper everywhere |
| EP-02 OutputAdapter walking skeleton | Complete | 100% | Sister mode proven; fork adapter contract present | FreeShow vendor SDKs make fork runtime verification external |
| EP-03 Timing map/storage | Complete | 100% | Atomic storage and migrations are in place | Crash-safe writes became a load-bearing invariant across later modules |
| EP-04 Sidecar infra | Locally strong, packaging incomplete | 82% | JSON-RPC, controller, model manifest/download manager, subprocess smoke pass, Python 3.11 ML venv validated | PyInstaller bundle and real model mirror remain external release gates |
| EP-05 Song learning | Production fixture repeatable, quality gate failing | 74% | Deterministic path works; production stage contracts and progress are wired; Demucs/WhisperX packages install/import; public-domain opt-in fixture exists | Real fixture runs completed but only 18-19/26 words met confidence gate; model artifact/offline strategy still needs release proof |
| EP-06 Karaoke renderer | Complete for sister-mode local use | 95% | Renderer, easing, next-section preview, perf harness pass | Visual QA mattered more than unit tests; tempo-adaptive easing arrived from operator feedback |
| EP-07 Audio input/beat detection | Mostly complete | 85% | Synthetic and pure module tests pass | Physical microphone/loopback QA remains a hardware gate |
| EP-08 VAD/STT correction | Partial | 45% | VAD and phrase matcher exist; SyncEngine accepts correction events | Whisper.cpp native addon is the main missing platform-specific dependency |
| EP-09 SyncEngine core | Complete | 100% | Real SyncEngine drives E2E demo | Operator-state IPC had to be throttled separately from karaoke frames |
| EP-10 Operator UI | Complete for M2 | 95% | D13-D18 closed; controls usable in sister mode | Hydration and keyboard-focus bugs were integration defects not caught by pure tests |
| EP-11 Lyrics sourcing/show creation | Locally strong | 90% | Learn Song wizard, parsing, import, production controls, sidecar trigger work, timing review/manual word adjustment | Browser screenshot policy blocked `file://` evidence capture; Electron smoke now covers the real renderer path |
| EP-12 Setlist/continuous playback | Locally strong | 85% | Sync badges, jump-to-song, next-up, auto-advance, disk-backed active project state | Real FreeShow REST project ingestion remains an external integration layer |
| EP-13 Library manager | Locally strong | 80% | ZIP `.lcbundle`, integrity, import/export, signing contracts tested | Original JSON-only bundle shape had to be replaced by ZIP |
| EP-14 Library hosting | Locally strong, externally unverified | 70% | Worker, setup script, signing/trust, GitHub mirror logic exist | Real Cloudflare R2/KV/Worker + GitHub mirror credentials are required for production proof |
| EP-15 Identity/publishing | Locally testable | 75% | Identity, publish credentials, safe-storage backend, publish dialog/browser exist | Secure storage wiring had a high-severity gap and was fixed locally |
| EP-16 Project plans | Partial/local | 60% | Source picker and plan schema/storage exist | Central-plan loading and campus-published project flows need end-to-end polish |
| EP-17 Rehearsal mode | Locally strong | 85% | Capture, segmentation, summary, variants, review/promotion work, Electron smoke approval path | Physical microphone QA and real multi-song rehearsal capture remain hardware gates |
| EP-18 Arrangement builder | Mostly complete | 80% | Drag/drop, parser, named arrangements, operator persistence work | Modal mounting and persistence were the real defects, not the pure arrangement logic |
| EP-19 Multilingual lyrics | Mostly complete | 80% | Translation editor, rendering, language swap, sizing exist | Translated-primary karaoke needs a learned timing map per primary language |
| EP-20 FreeShow upstream/caption injection | Local fallback complete | 70% | Discussion/PR draft, fallback plan, caption injection adapter contract exist | Actual upstream acceptance and real FreeShow WebSocket verification are external |

## Release Gates

### Gate A — Local Shippable MVP

Goal: the sister-mode app is reliable for local demos, local libraries, deterministic song learning, rehearsal capture, arrangements, translations, and operator controls.

Status: closed locally on 2026-06-05.

Completed local work:

1. Browser/evidence QA for Learn Song production controls and progress labels.
2. EP-11 waveform/manual word timing editor for timing-map review.
3. EP-12 disk-backed setlist/project replacement for demo-only setlist state.
4. EP-17 stop-capture-to-segmentation summary integration hardening.
5. End-to-end Electron smoke harness for operator window hydration, command IPC, Learn Song wizard, persistence, and rehearsal capture.
6. Final local Gate A close QA with full local CI and smoke evidence.

### Gate B — Production ML Certification

Goal: real song learning produces acceptable timing maps using local Demucs/WhisperX.

Remaining work:

Completed local work:

1. Installed and validated `python-sidecar[ml]` in a Python 3.11 ML venv.
2. Fixed the Python 3.11 subprocess test harness issue surfaced by the ML venv.
3. Verified the full Python sidecar suite in both the regular venv and ML venv.
4. Added the EP-05.8 public-domain audio fixture and opt-in production ML test.
5. Ran the real production fixture; it completed model inference but failed the current quality gate at 18-19/26 confident words across two runs.

Remaining work:

1. Capture and inspect the failing production TimingMap against manually prepared ground truth.
2. Decide whether the failure is fixture quality, lyric-window mismatch, model selection, vocal isolation, or alignment mapping.
3. Provision a real model manifest and model artifacts with SHA256 hashes.
4. Run a real production-mode Learn Song pass through the operator UI.
5. Capture QA evidence for timing accuracy, progress, cancellation, and fallback.

### Gate C — Multi-Campus Library/Publishing Certification

Goal: a campus can publish, download, import, verify, and use signed bundles.

Remaining work:

1. Run EP-14 against real Cloudflare R2/KV/Worker credentials.
2. Verify GitHub mirror fallback with a real token.
3. Verify safe-storage persistence for real publish credentials in the packaged host.
4. Run disaster-recovery drill: publish ZIP bundle, fetch from R2, disable primary URL, fetch from mirror.

### Gate D — Packaged Release

Goal: signed installers for target platforms.

Remaining work:

1. PyInstaller sidecar build script and per-platform binary smoke.
2. Electron-builder `extraResources` wiring for sidecar binaries.
3. GitHub Actions platform matrix and artifact retention.
4. macOS signing/notarization and Windows signing.
5. Fork-mode verification after FreeShow native vendor SDKs are installed.

### Gate E — Hardware/Live Worship Certification

Goal: prove the system behaves safely under real operator and audio conditions.

Remaining work:

1. Physical microphone/loopback tempo accuracy pass.
2. 10+ minute rehearsal capture with real silence gaps.
3. Live graceful-degradation drills: audio loss, low confidence, manual override, re-engage.
4. Venue-style display QA: 1080p, 4K, ultrawide, projector-safe contrast.

## Autonomous Execution Strategy

Work proceeds in this order:

1. Finish local-gate product gaps first, because they create the strongest base for every external proof.
2. Keep every slice small and committed with its own QA report.
3. Use the QA Analyst pass at three levels:
   - Per-slice: targeted unit/integration/browser checks plus a QA report.
   - Per-gate: broader smoke/depth pass before declaring a gate complete.
   - Final release: full local CI, Electron live smoke, packaged-app smoke where possible, and external-gate checklist.
4. Never mark an externally blocked item complete from mocks alone. Mark it "locally complete, external proof pending."
5. Prefer sister-mode production hardening first. Fork-mode work resumes after FreeShow vendor SDK prerequisites are available.

## Immediate Queue

1. Capture the failing EP-05.8 production TimingMap and compare it with manually prepared ground truth.
2. Fix the production learning quality root cause or replace the fixture if the source recording is unsuitable.
3. Provision the real model manifest and model artifacts with SHA256 hashes.
4. Run a real production-mode Learn Song pass through the operator UI.
5. Capture Gate B QA evidence for timing accuracy, progress, cancellation, and fallback.
6. Keep Gate C/D/E items marked external-proof pending until the required credentials, signing assets, vendor SDKs, and hardware are available.

## External Inputs Needed Before Final Production Sign-Off

- Real model manifest + model artifacts for Demucs/WhisperX.
- Cloudflare R2/KV/Worker credentials and GitHub mirror token.
- Code-signing certificates.
- FreeShow native vendor SDKs for fork-mode verification.
- Physical microphone/loopback environment for hardware QA.

Until those are available, the correct completion language is "locally shippable / external proof pending," not "production certified."
