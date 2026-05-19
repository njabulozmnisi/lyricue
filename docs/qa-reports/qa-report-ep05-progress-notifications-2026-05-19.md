# EP05 Progress Notifications QA Report — 2026-05-19
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP05 sidecar progress notifications for `learn_song`: JSON-RPC request context, tagged progress event ordering, deterministic and production stage names, host correlation contract, and regression safety.
**Environment:** Local macOS dev, Python sidecar `.venv`, Node 25 `env -i` wrapper.
**Status:** Pass

## Executive summary
`learn_song` now emits tagged `progress` notifications that the existing TypeScript `SidecarController` can correlate by `request_id`. No defects were surfaced in this pass.

The implementation keeps existing one-argument JSON-RPC handlers compatible and only gives request context to handlers registered with `register_with_context`.

## Test environment + persona setup
- Pass: Repository was on `main` after `3bea948 feat:(#EP-05): add production learning stage contracts`.
- Pass: Python sidecar tests ran in `.venv`.
- Pass: Node commands used the required clean `env -i` wrapper.
- Pass: No DB, browser persona, external service, or network-backed account was required.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP05-PROG-TC-01 | JSON-RPC context handler | Local developer | A context-aware handler can emit progress before its final response. | `register_with_context` emitted a `progress` notification with `request_id=42`, then the response. | Pass |
| EP05-PROG-TC-02 | Backward compatibility | Local developer | Existing one-argument handlers continue to work unchanged. | Existing protocol/method tests passed without handler rewrites. | Pass |
| EP05-PROG-TC-03 | Learn-song deterministic progress | Local developer | Deterministic `learn_song` emits decode, BPM, alignment, timing-map, section-detection, and complete stages. | Test captured `decode`, `bpm`, `alignment`, `timing_map`, `section_detection`, `complete`, all tagged to request id `7`. | Pass |
| EP05-PROG-TC-04 | Host correlation contract | Local developer | Progress payload uses `request_id`, matching the TypeScript `SidecarController` dispatcher. | Payload field matches the existing controller contract in `packages/core/src/sidecar/sidecar-controller.ts`. | Pass |
| EP05-PROG-TC-05 | Regression sweep | Local developer | Existing local floor stays clean. | `tsc -b` passed, 677/677 TS tests passed, 67/67 Python tests passed, both sister bundles built. | Pass |

## Defects surfaced + fixed
No new defects were surfaced in this pass.

## Network / data layer observations
- No network calls or persistent data writes were required.
- Code-level evidence: `RequestContext.progress` emits `progress` notifications with `request_id` in `python-sidecar/lyricue_sidecar/protocol.py:84`.
- Code-level evidence: context-aware handlers are registered through `register_with_context` in `python-sidecar/lyricue_sidecar/protocol.py:131`.
- Code-level evidence: dispatch constructs `RequestContext` from the JSON-RPC request id before invoking context handlers in `python-sidecar/lyricue_sidecar/protocol.py:183`.
- Code-level evidence: `learn_song` emits decode/BPM/alignment/model/timing-map/section/complete stage notifications in `python-sidecar/lyricue_sidecar/learning.py:56`.

## Cumulative defect tally (if multi-pass)
| Pass | New defects | Critical | High | Medium | Low | Current status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| EP05 section auto-detection | 0 | 0 | 0 | 0 | 0 | Pass |
| EP05 production stage contracts | 0 | 0 | 0 | 0 | 0 | Pass-with-caveats |
| EP05 progress notifications | 0 | 0 | 0 | 0 | 0 | Pass |

## Recommendations before production shipping
1. **HIGH** Connect the operator learn-song UI to `onProgress` so long-running production learning gives visible progress.
2. **HIGH** Run the real Demucs/WhisperX E2E fixture after installing `python-sidecar[ml]` and provisioning model cache.
3. **MEDIUM** Add per-stage percent estimates once the production runners can expose native progress.

## Final verdict
EP05 progress notifications are locally ready. The sidecar now emits request-tagged progress events that match the existing TypeScript host correlation logic, and the full local regression sweep remains clean.
