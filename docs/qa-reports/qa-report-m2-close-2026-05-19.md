# M2 Close QA Report — 2026-05-19
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** LyriCue sister-mode walking skeleton after local EP05–EP20 implementation slices, including E2E synthetic-audio pipeline, legacy demo launch, operator IPC/data persistence, rehearsal capture/review promotion, multilingual/arrangement tooling, and EP20 caption injection adapter contract.
**Environment:** Local macOS dev, Electron sister app, `LC_DEPLOYMENT_MODE=sister`, isolated Node 25 `env -i` wrapper, throwaway user data at `/tmp/lyricue-m2-close-qa`.
**Status:** Pass-with-caveats

## Executive summary
The local M2 walking skeleton is ship-ready for continued development demos: TypeScript, Python, renderer builds, demo launch, E2E launch, operator tools, and rehearsal approval all passed. No new **CRITICAL**, **HIGH**, **MEDIUM**, or **LOW** defects were surfaced in this pass.

The remaining caveats are outside this local proof: physical microphone rehearsal validation, production Cloudflare publish deployment, upstream FreeShow caption-extension action, and future waveform-level timing editing.

## Test environment + persona setup
- Pass: Repository was clean before the pass and HEAD was `bcd9d8d feat:(#EP-20): add caption injection output adapter`.
- Pass: `env -i ... npx tsc -b --pretty false` completed successfully.
- Pass: `env -i ... npm run test:ts` completed successfully: 61 files, 677 tests.
- Pass: `env -i ... cd python-sidecar && .venv/bin/pytest -q` completed successfully: 53 tests.
- Pass: Sister karaoke renderer bundle built successfully.
- Pass-with-known-warning: Sister operator renderer bundle built successfully; it still emits the existing `svelte-dnd-action` Svelte resolve warning.
- Pass: No authenticated, multi-user, or network-backed persona was required for this local Electron skeleton. Persona for the pass was the local operator using the sister app.
- Pass: No DB, Prisma migrations, Redis, MinIO, mail, or queues are in scope for the current offline-first local walking skeleton.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| M2-TC-01 | Build pre-flight | Local operator/dev | TypeScript composite build passes under required Node wrapper. | Build completed with no TypeScript errors. | Pass |
| M2-TC-02 | TS test floor | Local operator/dev | Core, UI, sister, and fork tests pass. | 677/677 tests passed. Expected defensive-guard stderr appeared in tests that intentionally throw subscribers. | Pass |
| M2-TC-03 | Python sidecar | Local operator/dev | Sidecar unit tests pass. | 53/53 tests passed. | Pass |
| M2-TC-04 | Renderer bundles | Local operator/dev | Karaoke and operator bundles build. | Both bundles built; operator build retained the known `svelte-dnd-action` warning. | Pass |
| M2-TC-05 | E2E launch | Local operator | Real SyncEngine + synthetic audio + OutputAdapter + karaoke renderer + operator window starts and runs. | Electron launched, `LC_LOAD_MAP` reached renderer, frames advanced, loop restart occurred, diagnostics reported `dropped=0`. | Pass |
| M2-TC-06 | Operator tools | Local operator | Arrangement builder, translation editor, and rehearsal panel render during capture run. | Capture wrote operator evidence states for arrangement builder, translation editor, and rehearsal mode; no renderer errors appeared. | Pass |
| M2-TC-07 | Rehearsal capture/review | Local operator | Start/stop rehearsal capture, segment it, approve it, and persist a rehearsal timing-map variant. | WAV was written under `/tmp/lyricue-m2-close-qa/lyricue/rehearsals`; approval returned `captured-approved`; variant was written under `/tmp/lyricue-m2-close-qa/lyricue/timing-maps`. | Pass |
| M2-TC-08 | Legacy demo launch | Local operator | `LC_DEMO_MODE=1` still renders and loops the demo song. | Demo mode started, rendered frames, captured four states, and reported `dropped=0`. | Pass |
| M2-TC-09 | Operator IPC cross-cut | Local operator/dev | Sender validation, channel constants, and pre-ready buffering remain aligned. | Source sweep confirmed sender-filtered ready latches and buffered load-map/frame behavior; tests cover pre-ready buffering order and cap. | Pass |
| M2-TC-10 | EP20 caption adapter | Local operator/dev | Adapter sends session/map/frame payloads, supports word-sweep and word-swap modes, and never throws from `pushSyncFrame`. | `caption-injection-output-adapter.test.ts` covers both payload modes, transport failure, health counters, and pre-start drop behavior. | Pass |

## Defects surfaced + fixed
No new defects were surfaced in this pass.

Confirmed non-regression:
- D13–D18 from the EP10 operator-window pass remain closed by later operator-window and IPC work. This pass exercised the same dual-window launch path plus arrangement, translation, and rehearsal operator states.
- M1 D11 load-map race remains covered: `OwnWindowOutputAdapter` buffers `LC_LOAD_MAP` until renderer-ready and flushes it before buffered frames.
- M1 D12 CSP warning did not recur during the live Electron runs.

## Network / data layer observations
- Offline posture held. The live sister runs used local Electron IPC, local files, synthetic audio, and the Python sidecar process. No outbound service dependency was required.
- E2E launch log showed `adapter.start() OK`, `E2E mode: SyncEngine + synthetic audio pipeline started`, `LC_LOAD_MAP received`, frame logs through loop restart, and diagnostics with `delivered=541`, `dropped=0`, `lastError=none` near the rehearsal exercise.
- Demo launch log showed `DEMO mode: walking-skeleton demo engine started`, frame progression through loop restart, and diagnostics with `delivered=250`, `dropped=0`, `lastError=none`.
- Rehearsal data persisted at `/tmp/lyricue-m2-close-qa/lyricue/timing-maps/lyricue-demo-walking-skeleton.rehearsal.timing.json` with `learnedFrom.method="rehearsal"`, `filename="2026-05-19T06-49-56-913Z.wav"`, and `duration=2`.
- IPC source sweep confirmed sender validation at `apps/sister/src/output/electron-browser-window-factory.ts:151`, ready-latch pending handlers at `apps/sister/src/output/electron-browser-window-factory.ts:147`, and pre-ready load-map/frame buffering in `apps/sister/src/output/OwnWindowOutputAdapter.ts:153`.
- Caption adapter source/test sweep confirmed `wordSweepSupported` handling and no-throw `pushSyncFrame` behavior in `packages/core/src/output/caption-injection-output-adapter.ts:147`.

## Cumulative defect tally (if multi-pass)
| Pass | New defects | Critical | High | Medium | Low | Current status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| M1 close | 2 | 0 | 1 | 1 | 0 | Closed in later fixes |
| EP10 operator window | 6 | 0 | 3 | 2 | 1 | Closed in later fixes |
| EP13/EP14 fix verification | 0 | 0 | 0 | 0 | 0 | Local pass-with-caveats |
| EP17 review promotion | 0 | 0 | 0 | 0 | 0 | Local pass-with-caveats |
| EP20 caption adapter | 0 | 0 | 0 | 0 | 0 | Local pass-with-caveats |
| M2 close | 0 | 0 | 0 | 0 | 0 | Local pass-with-caveats |

## Recommendations before production shipping
1. **HIGH** Run a real physical microphone rehearsal QA pass: 10+ minutes, multiple songs, real silence gaps, and macOS microphone permission prompts. The current proof uses synthetic audio and file-backed capture.
2. **HIGH** Execute EP14 against real Cloudflare R2/KV/Worker credentials plus GitHub mirror token before claiming production library publishing.
3. **MEDIUM** Post or stage the EP20 upstream FreeShow Captions extension through the operator’s GitHub credentials; the local caption adapter is ready, but full FreeShow rendering depends on upstream acceptance.
4. **MEDIUM** Add a waveform-level/manual timing editor before treating rehearsal learning as production-fidelity timing correction. The current review path is safe and persistent but intentionally scaffolded.
5. **MEDIUM** Add a dedicated automated Electron smoke harness that stores fresh screenshots under a per-pass directory instead of reusing historical evidence paths.

## Final verdict
The local M2 walking skeleton passes: the app builds, tests, launches in both E2E and demo modes, renders the karaoke output, drives the operator window, persists rehearsal-approved timing variants, and keeps IPC/output adapter boundaries healthy. It is ready for the next implementation phase and stakeholder demo with explicit caveats around real hardware rehearsal, external publishing infrastructure, and upstream FreeShow caption-extension work.
