# LyriCue Completion Roadmap — 2026-05-19

This roadmap supersedes the stale 2026-05-16 handoff snapshot. It reflects current `main` after M2-close work plus Gate A/B/D local hardening through 2026-06-18.

## Current State

LyriCue has a working sister-mode vertical slice: dual Electron windows, real SyncEngine, synthetic audio driver, operator control panel, karaoke output, local sidecar song-learning contracts, setlist/arrangement/translation/rehearsal/library surfaces, and a local quality gate. The current local test floor is:

- TypeScript/Vitest: 793 tests passing across 83 files.
- Publish Worker Vitest: 11 tests passing.
- Python sidecar: 88 tests passing, 1 skipped.
- Python sidecar with optional ML dependencies on Python 3.11: 88 tests passing, 1 skipped.
- `svelte-check`: 0 errors / 0 warnings on the current UI slice.
- Sister karaoke and operator renderer bundles build.
- `npm run verify:local` passes the aggregate local gate: TypeScript build/tests, UI diagnostics, Worker tests, both Python sidecar suites, and sister renderer builds.
- Gate A Electron smoke passes with `LC_SMOKE_TEST=1` against the real sister-mode dual-window app.
- Smoke screenshot capture supports pass-specific `LC_CAPTURE_EVIDENCE_DIR` output so fresh QA artifacts do not overwrite historical evidence baselines.
- Operator smoke now captures live Settings, Publish, Setlist Source, and nested Publish Credential overlays as release evidence.
- Local Gate A close QA has no open critical/high walking-skeleton defects.

The project is not yet production-shippable for a multi-campus rollout because several release gates require real external assets, credentials, hardware, or packaged-binary validation.

## Epic Stocktake

| Epic | Current status | Completion | Local ship state | Unexpected things that popped |
|---|---:|---:|---|---|
| EP-01 Foundation | Mostly complete, local CI strengthened | 90% | Local development foundation works; hosted quality gate now covers TypeScript build/tests, Python sidecar tests, Svelte diagnostics, Worker tests, and sister renderer builds; `npm run verify:local` reproduces the full local gate | Full 10-job installer matrix is blocked by platform runners/signing/vendor SDKs; stale shell `NODE_PATH` required the `env -i` wrapper everywhere; CI originally lagged the local gate by missing `svelte-check` and Worker tests; local verification previously relied on copied command sequences |
| EP-02 OutputAdapter walking skeleton | Complete | 100% | Sister mode proven; fork adapter contract present | FreeShow vendor SDKs make fork runtime verification external |
| EP-03 Timing map/storage | Complete | 100% | Atomic storage and migrations are in place | Crash-safe writes became a load-bearing invariant across later modules |
| EP-04 Sidecar infra | Locally strong, packaging locally proven for macOS arm64 protocol + packaged host smoke | 92% | JSON-RPC, controller, model manifest/download manager, installer fixture manifest file, persisted manifest/mirror settings schema, subprocess smoke pass, Python 3.11 ML venv validated, PyInstaller darwin-arm64 binary smoke passed, packaged sister app launches the bundled sidecar from `process.resourcesPath` | First PyInstaller entry failed on package-relative imports; root `build:sidecar` exposed a bare-`python` clean-env defect. Packaged Electron also did not set `NODE_ENV=production`, so sidecar resolution had to key off `app.isPackaged`. Manifest tests originally pinned only the in-memory object path; a real JSON file fixture now exercises the production parser. Env/settings precedence needed an explicit resolver so release jobs can override operator settings without mutating disk state. Full platform packaging and real model mirror remain release gates |
| EP-05 Song learning | Local packaged/operator production proof passing with caveats | 99% | Deterministic path works; production stage contracts and progress are wired; Demucs/WhisperX packages install/import; public-domain opt-in fixture passes in source mode; staged release-owned model cache runs with `LYRICUE_MODEL_CACHE_ONLY=1`; packaged sidecar returns TimingMaps with clean JSON-RPC stdout and 25/26 confident words in the final variance sample; packaged release smoke is scripted and passing at 24/26 confident words; native warnings are captured and locally certified for the current in-memory path; operator bridge production Learn Song pass returns a valid TimingMap at 24/26 confident words; operator cancellation/fallback is proven locally; packaged sister smoke proves the host can launch the bundled sidecar for rehearsal segmentation | The first 30-second fixture clipped the final phrase and falsely failed the quality gate. Demucs local-repo loading failed under PyTorch 2.8 safe-load defaults until LyriCue scoped trusted local artifact loading. Packaged ML required targeted PyInstaller rules for WhisperX, Pyannote, and torchcodec metadata. Operator production alignment needed a longer timeout than deterministic learning and a source-mode ML venv override. Active ML cancellation had to terminate the sidecar because the sidecar JSON-RPC loop cannot process `cancel_job` while inside Demucs/WhisperX work. Slow onefile startup remains a release-hardening item |
| EP-06 Karaoke renderer | Complete for sister-mode local use | 95% | Renderer, easing, next-section preview, perf harness pass | Visual QA mattered more than unit tests; tempo-adaptive easing arrived from operator feedback |
| EP-07 Audio input/beat detection | Mostly complete | 85% | Synthetic and pure module tests pass | Physical microphone/loopback QA remains a hardware gate |
| EP-08 VAD/STT correction | Partial | 80% | VAD, phrase matcher, rolling STT window/backpressure scaffold, correction evaluator, host-neutral live-safe correction controller, STT disable no-op, durable position JSONL logging with decision-to-log entry mapping, and live-STT model manifest requirements exist; SyncEngine accepts correction events | Whisper.cpp native addon remains the main missing platform-specific dependency; the original epic package name no longer resolves on npm; controller dispatch/observer failures needed explicit isolation after transcriber isolation landed; correction telemetry needed a host-neutral bridge before sister host wiring |
| EP-09 SyncEngine core | Complete | 100% | Real SyncEngine drives E2E demo | Operator-state IPC had to be throttled separately from karaoke frames |
| EP-10 Operator UI | Complete for M2 | 99% | D13-D18 closed; controls usable in sister mode; shared SettingsTab is reachable from the sister operator window through validated get/save IPC; sidecar manifest controls have component-level persistence coverage; persisted shortcuts and selected audio device load at startup and save through live operator commands; Settings overlay now has live Electron screenshot evidence and a packaged-smoke parser signal | Hydration and keyboard-focus bugs were integration defects not caught by pure tests. Mounting settings exposed a renderer-bundle defect where broad core imports pulled Node-only modules into Vite; the fix required narrow UI/core subpath imports. Settings saves initially persisted but did not prove live shortcut rebroadcast until the Electron smoke bridge was expanded. The first Settings screenshot exposed a viewport overflow defect, so SettingsTab now constrains nested form controls and wraps sections responsively. Device selection originally survived tick broadcasts but not app restarts until it was wired to SettingsStore |
| EP-11 Lyrics sourcing/show creation | Locally strong | 92% | Learn Song wizard, parsing, import, production controls, model-manifest status display, sidecar trigger work, timing review/manual word adjustment | Browser screenshot policy blocked `file://` evidence capture; Electron smoke now covers the real renderer path; production controls needed an explicit operator-visible install/manifest status rather than relying on learn-time failure |
| EP-12 Setlist/continuous playback | Locally strong | 88% | Sync badges, jump-to-song, next-up, auto-advance, disk-backed active project state, REST project adapter normalization, and opt-in refresh timeout support exist | Real FreeShow REST project ingestion remains an external integration layer; local QA surfaced the need for bounded refreshes when FreeShow is unreachable |
| EP-13 Library manager | Locally strong | 83% | ZIP `.lcbundle`, integrity, import/export, signing contracts, and opt-in bounded bundle downloads tested | Original JSON-only bundle shape had to be replaced by ZIP; stalled remote bundle downloads needed explicit abort semantics |
| EP-14 Library hosting | Locally strong, externally unverified | 75% | Worker, setup script, signing/trust, GitHub mirror logic, project publish audit logging, target validation, and local Worker tests exist | Real Cloudflare R2/KV/Worker + GitHub mirror credentials are required for production proof |
| EP-15 Identity/publishing | Locally strong, external publish proof pending | 92% | Identity, publish credentials, safe-storage backend, operator credential configure/clear bridge, mounted publish credential dialog with smoke screenshot evidence, publish dialog/browser, song `.lcbundle` export from the sister host, project publish mode, project metadata hydration, and per-target credential gating exist | Secure storage wiring had a high-severity gap and was fixed locally; renderer show IDs initially risked drifting into catalog song IDs until the host split local `showId` from library `songId`; credential smoke now proves dummy secrets do not leak into config JSON and the nested credential UI is reachable from default Settings state; prompt-based credential entry has been replaced by an operator dialog, but real packaged safe-storage and Worker credentials still need external proof |
| EP-16 Project plans | Locally strong, external publish proof pending | 84% | Source picker, operator host mounting, plan schema/storage, central/campus plan metadata, campus publish hook, central plan bundle loading, download-timeout propagation, and smoke evidence exist | Real Worker catalog update and two-install subscribe flow still require external deployment; project-plan imports inherit the same stalled-download risk as direct bundle imports |
| EP-17 Rehearsal mode | Locally strong | 85% | Capture, segmentation, summary, variants, review/promotion work, Electron smoke approval path | Physical microphone QA and real multi-song rehearsal capture remain hardware gates |
| EP-18 Arrangement builder | Mostly complete | 91% | Drag/drop, parser, named arrangements, operator persistence, refreshed modal hydration, renderer current-section save guards, main-process IPC normalization, and Electron smoke stale-payload guard exist | Modal mounting and persistence were the real defects, not the pure arrangement logic; same-ID arrangement updates and stale IPC payloads exposed data-integrity risk |
| EP-19 Multilingual lyrics | Mostly complete | 93% | Translation editor, rendering, language swap, sizing, operator mounting, stale-draft protection, main-process translation IPC narrowing, timing-map schema section-reference validation, and Electron smoke stale-payload guard exist | Translated-primary karaoke needs a learned timing map per primary language; mounted editor QA surfaced stale timing-map draft, full-map IPC overwrite, and schema reference-drift hazards before they could become operator data loss |
| EP-20 FreeShow upstream/caption injection | Local fallback complete | 75% | Discussion/PR draft, fallback plan, caption injection adapter contract, and sister-mode output selection policy exist | Actual upstream acceptance and real FreeShow WebSocket verification are external; caption injection needed an explicit opt-in plus word-sweep capability selector so OwnWindow remains the default |

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

Completed local work:

1. Installed and validated `python-sidecar[ml]` in a Python 3.11 ML venv.
2. Fixed the Python 3.11 subprocess test harness issue surfaced by the ML venv.
3. Verified the full Python sidecar suite in both the regular venv and ML venv.
4. Added the EP-05.8 public-domain audio fixture and opt-in production ML test.
5. Ran the real production fixture; it completed model inference but failed the current quality gate at 18-19/26 confident words across two runs.
6. Added Demucs/WhisperX local-cache and cache-only hooks for release-owned offline model directories.
7. Diagnosed the fixture failure as a clipped 30-second excerpt and replaced it with a 48-second excerpt from the same public-domain source.
8. Re-ran the opt-in production fixture successfully: `1 passed`, with evidence at 25/26 confident words.
9. Added a release model staging utility that builds a loader-compatible local cache layout for Demucs, Faster Whisper, and WhisperX alignment checkpoints.
10. Fixed Demucs local-repo loading under PyTorch 2.8 safe-load defaults for trusted release-owned artifacts.
11. Re-ran the production fixture with `LYRICUE_MODEL_CACHE_ONLY=1`, `HF_HUB_OFFLINE=1`, and `TRANSFORMERS_OFFLINE=1` against the staged model directory successfully.
12. Built the sidecar from the Python 3.11 ML venv and verified packaged JSON-RPC liveness.
13. Fixed the first packaged `learn_song` hidden-import defect by collecting WhisperX submodules.
14. Fixed packaged runtime import/data gaps for torchcodec metadata, Pyannote data, WhisperX assets, and Pyannote segmentation submodules.
15. Redirected WhisperX stdout logging to stderr to preserve the sidecar JSON-RPC stdout contract.
16. Ran packaged `learn_song` end to end against the offline fixture; final packaged variance sample returned 25/26 confident words twice with clean stdout.
17. Added production-vs-deterministic operator Learn Song timeout selection so packaged cold-start production alignment does not fail under the old 120s budget.
18. Ran production-mode Learn Song through the sister-mode operator bridge with `.venv-ml`, cache-only model paths, and progress IPC evidence; result was 24/26 confident words, ratio `0.9230769230769231`.
19. Added operator Learn Song cancellation IPC, host-side sidecar termination, and manual-preview fallback after learning failure.
20. Ran production cancellation evidence; cancel fired at `demucs`, terminated the sidecar with `SIGTERM`, and the active `learn_song` request rejected cleanly.
21. Added and ran `python-sidecar/scripts/smoke_packaged_learn_song.py`; packaged release smoke passed with `invalidStdout=[]`, all required progress stages, and 24/26 confident words.
22. Captured native warning lines in the packaged release smoke and certified them as non-blocking for LyriCue's current `librosa` decode plus in-memory WhisperX/Pyannote path.
23. Added an installer model-manifest JSON fixture and file-parser regression so host-side schema drift is caught without reaching external mirrors.
24. Added persisted sidecar manifest/mirror settings fields plus an explicit sister-host resolver that keeps release env vars authoritative over operator settings.

Remaining work:

1. Re-run the packaged release smoke and native-warning certification for each platform artifact during release packaging.

### Gate C — Multi-Campus Library/Publishing Certification

Goal: a campus can publish, download, import, verify, and use signed bundles.

Remaining work:

1. Run EP-14 against real Cloudflare R2/KV/Worker credentials.
2. Verify GitHub mirror fallback with a real token.
3. Verify safe-storage persistence for real publish credentials in the packaged host.
4. Run disaster-recovery drill: publish ZIP bundle, fetch from R2, disable primary URL, fetch from mirror.
5. Run a deployed song publish from the sister operator and verify `catalog.json`, `meta/publish-log.jsonl`, and project-plan bundle metadata across two installs.

### Gate D — Packaged Release

Goal: signed installers for target platforms.

Completed local work:

1. Added a PyInstaller sidecar build script with a package-safe entry wrapper.
2. Built and smoke-tested the local macOS arm64 `lyricue-sidecar` executable through JSON-RPC `ready`, `ping`, and `shutdown`.
3. Wired the sister Electron package to copy `build/sidecar` into `extraResources`.
4. Updated production sidecar path resolution to use Electron `process.resourcesPath`.
5. Fixed the root `build:sidecar` script to use the project sidecar `.venv` interpreter under the clean environment wrapper.
6. Built the packaged sidecar from the Python 3.11 ML venv and proved `learn_song` from the packaged executable with a repeatable release smoke.
7. Built a local macOS arm64 sister `.app` directory package and proved the packaged host launches the bundled sidecar from `process.resourcesPath` during rehearsal segmentation.
8. Fixed sister packaging metadata so Electron is a pinned dev dependency and electron-builder is explicit for release builds.
9. Fixed packaged-host sidecar resolution to use `app.isPackaged` instead of assuming packaged Electron sets `NODE_ENV=production`.
10. Added `npm -w @lyricue/sister run smoke:packaged` to capture packaged smoke stdout/stderr and a JSON summary artifact for release jobs.
11. Added a manual release matrix skeleton for unsigned sister packages across macOS arm64, macOS Intel, Windows x64, Linux x64, and Linux arm64.

Remaining work:

1. Run the manual release matrix on the hosted repository and retain unsigned artifacts.
2. macOS signing/notarization and Windows signing.
3. Fork-mode verification after FreeShow native vendor SDKs are installed.

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

1. Continue closing local host-integration gaps that reduce external-gate uncertainty before credentials/hardware arrive.
2. Keep Gate C/D/E items marked external-proof pending until the required credentials, signing assets, vendor SDKs, and hardware are available.
3. Use `docs/release-signoff-checklist.md` as the production certification checklist once external inputs are available.

## External Inputs Needed Before Final Production Sign-Off

- Real model manifest + model artifacts for Demucs/WhisperX.
- Cloudflare R2/KV/Worker credentials and GitHub mirror token.
- Code-signing certificates.
- FreeShow native vendor SDKs for fork-mode verification.
- Physical microphone/loopback environment for hardware QA.

Until those are available, the correct completion language is "locally shippable / external proof pending," not "production certified."
