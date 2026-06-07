# EP08 Position Correction Log Entry QA Report — 2026-06-07
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP-08 host-neutral position-correction telemetry bridge from live STT correction decisions to durable JSONL entries.
**Environment:** Local dev workspace at `/Users/njabulomnisi/Projects/Dojo/worshipsync`; pure core STT verification with Node 25 via the required isolated shell wrapper.
**Status:** Pass-with-caveats

## Executive summary

The STT correction path now has a deterministic, reusable bridge from `PositionCorrectionDecision` plus transcript output to the durable `PositionCorrectionLogEntry` schema. No **CRITICAL** or **HIGH** defects were found in this slice.

The remaining EP-08 caveat is unchanged: real Whisper.cpp runtime selection and sister-mode host wiring are still required before production audio proof.

## Test environment + persona setup

- Pass: Repository workspace was local `main`; only current EP-08 telemetry changes and ignored `.claude/` were present.
- Pass: Node commands used the documented `env -i` Node 25 wrapper.
- Pass: No native Whisper.cpp package was loaded; transcript output was represented at the core `SttTranscript` boundary.
- Pass: Persona was the live SyncEngine host persisting correction telemetry during performance.
- Pass: Network, privacy, SSR/CSR, and literal-drift checks are not applicable to this host-neutral core helper.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP08-LOG-01 | Decision-to-log mapping | Sync host | Log entry captures show ID, transcript text/confidence, source cursor, and target cursor. | Entry matched expected JSONL schema exactly. | Pass |
| EP08-LOG-02 | Invalid confidence guard | Sync host | Non-finite transcript confidence does not poison durable telemetry. | `NaN` became `0`; confidence above `1` clamped to `1`. | Pass |
| EP08-LOG-03 | JSONL append | Sync host | Multiple entries append to the dated positions log. | Existing append test still passes. | Pass |
| EP08-LOG-04 | Retention pruning | Sync host | Old dated position logs are removed; unrelated files remain. | Existing prune test still passes. | Pass |
| EP08-LOG-05 | Type boundary | Core package | Public helper compiles through the composite TypeScript build. | `npx tsc -b` passed. | Pass |

## Defects surfaced + fixed

**INFO — Confirmed correction telemetry bridge behaviour**  
Symptom: Prior EP-08 QA noted that the live STT path had durable append/prune primitives, but no shared host-neutral function for converting a correction decision and transcript into the persisted JSONL shape.  
Root cause: Telemetry schema construction was left as a host integration concern, which would make sister-mode wiring duplicate field mapping and confidence guards.  
Latency: Present since the position log primitive landed; earlier passes focused on correction matching, controller failure isolation, and append/prune behaviour rather than host-level telemetry mapping.  
Repro steps: Construct a valid `PositionCorrectionDecision` and `SttTranscript`; before this change, there was no core API that returned a complete `PositionCorrectionLogEntry` for hosts to append.  
Evidence: The helper lives in [position-correction-log.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/stt/position-correction-log.ts:36), with mapping and confidence guard coverage in [position-correction-log.test.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/stt/position-correction-log.test.ts:51). Focused verification passed: `position-correction-log.test.ts` 4/4 and `tsc -b`.  
Fix proposal: Add `createPositionCorrectionLogEntry()` as the single core conversion API and clamp invalid transcript confidence before persistence.  
Fix status: Fixed and verified locally in this change.

## Network / data layer observations

- Network: No network calls are made by the position-correction telemetry helper.
- Data layer: The helper is pure; existing append/prune tests continue to verify JSONL persistence and retention behaviour.
- Console: Focused tests emitted no unexpected console errors.

## Cumulative defect tally (if multi-pass)

| Pass | Defects | Critical | High | Medium | Low | Info | Fixed in pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| EP08 STT correction scaffolding — 2026-06-06 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| EP08 STT correction controller — 2026-06-06 | 1 | 0 | 1 | 0 | 0 | 0 | 1 |
| EP08 STT controller live-safety — 2026-06-06 | 1 | 0 | 1 | 0 | 0 | 0 | 1 |
| EP08 position correction log entry — 2026-06-07 | 1 | 0 | 0 | 0 | 0 | 1 | 1 |

## Recommendations before production shipping

1. **HIGH:** Select and package a supported native Whisper.cpp binding, then re-run EP-08 with the real transcriber.
2. **HIGH:** Wire the controller and correction log append path into the sister-mode audio host behind the operator STT toggle once the native dependency is selected.

## Final verdict

This local EP-08 telemetry slice is ready. It does not make EP-08 production-complete by itself; the remaining blockers are native STT runtime selection and real host/audio integration proof.
