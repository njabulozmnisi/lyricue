# EP-11 Production Learning UI QA Report — 2026-05-19
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** Learn Song wizard production-mode controls, Demucs/WhisperX model selection handoff, and operator progress labels for model cache/download/install stages.
**Environment:** Local dev; `/Users/njabulomnisi/Projects/Dojo/worshipsync`; Svelte component tests; renderer progress-label unit tests; full TypeScript/Python quality gate; sister-mode Vite bundles.
**Status:** Pass

## Executive summary
The operator song-learning flow now exposes production learning as an explicit choice. When selected, the wizard captures Demucs and WhisperX model choices, the sister renderer forwards them into `learn_song.options`, and model cache/download progress notifications render as operator-readable labels.

No defects were surfaced in this pass. The remaining production caveat is unchanged: real model downloads require a configured model manifest and real model artifacts.

## Test environment + persona setup
- PASS: Repo was clean at start; branch `main`; starting HEAD `51dd505`.
- PASS: Svelte component diagnostics ran cleanly.
- PASS: TypeScript and Python regression suites ran cleanly.
- PASS: Sister-mode renderer bundles still build.
- N/A: No DB, login persona, migrations, Redis, MinIO, or external network services apply to this UI/IPC handoff.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| TC-01 | Learning mode selector | Operator | Audio step exposes deterministic vs production mode when a reference audio file is present | `LearnSongWizard` renders a `Learning mode` select after audio is attached | PASS |
| TC-02 | Model choices | Operator | Production mode exposes Demucs and WhisperX model selectors | Wizard renders model selectors for `htdemucs`, `htdemucs_ft`, `mdx_extra`, `tiny`, `base`, `small`, `medium` | PASS |
| TC-03 | Draft round-trip | Operator | Production/model selections reach the injected `learnSong` callback | Component test asserts `alignmentMode: production`, `demucsModel: mdx_extra`, `whisperxModel: base` | PASS |
| TC-04 | Renderer payload | Operator / host bridge | Sister renderer forwards alignment/model choices in `learn_song.options` | `operator-window-bootstrap.ts` includes `alignmentMode`, `demucsModel`, and `whisperxModel` in host request | PASS |
| TC-05 | Progress labels | Operator | Model cache/download/install notifications map to readable labels | Unit test covers `models`, `model_download_start`, `model_download_progress`, `model_installed`, and `model_cached` | PASS |
| TC-06 | Component type safety | Developer QA | Svelte component compiles without diagnostics | `svelte-check` found 0 errors and 0 warnings | PASS |

## Defects surfaced + fixed
None.

## Network / data layer observations
- IPC contract: the wizard still delegates all sidecar work to the host callback; it only enriches the draft with production/model choices.
- Network posture: no download is initiated by the UI. Downloads remain inside the sidecar `ensure_models` path when the host supplies a manifest-backed production request.
- Form hydration round-trip: existing `initialDraft` values now hydrate `alignmentMode`, `demucsModel`, and `whisperxModel`; default values are deterministic/htdemucs/small.
- Privacy boundary: no user, org, or campus identity is added to the learning payload.
- Console/build: Vite operator build still emits the existing `svelte-dnd-action` resolve warning; no new warnings were introduced by this change.

## Cumulative defect tally (if multi-pass)
| Pass | Defects | CRITICAL | HIGH | MEDIUM | LOW | INFO |
|---|---:|---:|---:|---:|---:|---:|
| EP-11 production learning UI | 0 | 0 | 0 | 0 | 0 | 0 |

## Recommendations before production shipping
1. **HIGH:** Run one real production-mode learning pass after a real model manifest and ML dependencies are provisioned.
2. **MEDIUM:** Add a visible manifest/configuration status badge in the song-learning wizard once installer settings are finalized.
3. **MEDIUM:** Capture browser evidence for the production-mode controls during the next walking-skeleton UI QA pass.

## Final verdict
Ship this UI increment. Production learning is now an explicit operator choice with model selection and visible model-download progress, while the actual network/model integrity boundary remains in the already-tested sidecar manifest path.
