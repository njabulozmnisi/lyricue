# EP08 STT Correction Controller QA Report — 2026-06-06
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP-08 host-neutral live STT correction controller: rolling audio window, transcript confidence gate, position-correction decision, SyncEngine event dispatch, disabled no-op, and live-safe transcriber failure handling.
**Environment:** Local dev workspace at `/Users/njabulomnisi/Projects/Dojo/worshipsync`; pure core verification with Node 25 via the required isolated shell wrapper.
**Status:** Pass-with-caveats

## Executive summary

EP-08 now has a host-neutral controller that composes rolling STT transcripts into SyncEngine `positionCorrection` events without requiring the unresolved native whisper.cpp dependency. One **HIGH** integration gap was surfaced and fixed. No **CRITICAL** defects were found.

The remaining EP-08 caveat is still native live-STT runtime proof: the production transcriber dependency and physical audio path need platform-specific validation before this epic is complete.

## Test environment + persona setup

- Pass: Repository workspace was local `main`; only current EP-08 hardening changes and ignored `.claude/` were present.
- Pass: Node commands used the documented `env -i` Node 25 wrapper.
- Pass: No API, DB, migrations, Redis, MinIO, mail, or external worker services are in scope for this pure core pass.
- Pass: Persona was the live performance SyncEngine host receiving rolling recognized phrases from a local STT engine.
- Pass: Literal drift is not applicable; SyncEngine correction events use the canonical `SyncEvent` union.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP08-TC-01 | Rolling STT to correction dispatch | Sync host | A confident cross-section transcript dispatches one `positionCorrection` event. | Controller dispatched `{ kind: "positionCorrection", targetRefMs: 3000, wallTime: 1000 }`. | Pass |
| EP08-TC-02 | STT disabled posture | Sync host | Disabled STT returns a no-op without transcribing or dispatching. | Controller returned `disabled`; dispatch was not called. | Pass |
| EP08-TC-03 | Transcript confidence gate | Sync host | Low-confidence transcripts do not move the cursor. | Controller returned `low-confidence`; dispatch was not called. | Pass |
| EP08-TC-04 | Transcriber failure isolation | Sync host | A native/STT engine exception does not throw out of the live correction tick. | Controller returned `error`, invoked `onError`, and did not dispatch. | Pass |
| EP08-TC-05 | Type surface | Developer/operator | Optional rolling-window options respect `exactOptionalPropertyTypes`. | `tsc -b` passed after omitting undefined optional fields. | Pass |

## Defects surfaced + fixed

**D36 — HIGH — STT correction pieces were not composed behind a live-safe host boundary**  
Symptom: EP-08 had a rolling STT window, phrase matcher, position-correction evaluator, and SyncEngine correction event support, but no reusable controller that safely tied transcript output to SyncEngine dispatch. Hosts would have had to duplicate cadence, confidence, disabled-state, and error handling logic.  
Root cause: The previous implementation stopped at pure helper scaffolding. No file owned the integration boundary between `RollingSttWindow`, `evaluatePositionCorrection`, and `SyncEngine.dispatch`.  
Latency: Present since the STT correction scaffold landed; pure helper tests verified each piece independently but did not prove the composition contract or the live no-throw behavior around transcriber failures.  
Repro steps: Search the core STT package for a component that accepts audio samples, runs a transcriber, evaluates correction, and dispatches `SyncEvent`; none existed before this change.  
Evidence: `LiveSttCorrectionController` now lives at [live-stt-correction-controller.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/stt/live-stt-correction-controller.ts:20), with regression coverage in [live-stt-correction-controller.test.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/stt/live-stt-correction-controller.test.ts:65). Focused verification passed: `tsc -b` and `live-stt-correction-controller.test.ts` 4/4. Full local verification passed: `tsc -b`, root Vitest 746/746, Python sidecar 88 passed/1 skipped, Python sidecar ML 88 passed/1 skipped, `svelte-check` 0 errors/warnings, and Worker Vitest 11/11.  
Fix proposal: Add a host-neutral controller that owns rolling-window ticks, confidence gating, disabled no-op behavior, correction dispatch, and transcriber error isolation.  
Fix status: Fixed and verified locally in this change.

## Network / data layer observations

- Network: No network calls are made by EP-08 live STT correction core.
- Data layer: This slice does not write logs directly; position JSONL logging remains available through the existing `position-correction-log` helper for hosts that want audit telemetry.
- SyncEngine boundary: The controller dispatches only the canonical `positionCorrection` event and does not import or mutate SyncEngine internals.
- Runtime safety: Transcriber exceptions are converted to `{ status: "error" }` and reported through `onError`, preserving the live no-crash invariant.

## Cumulative defect tally (if multi-pass)

| Pass | Defects | Critical | High | Medium | Low | Fixed in pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| EP08 STT correction scaffolding — 2026-06-06 | 0 | 0 | 0 | 0 | 0 | 0 |
| EP08 STT correction controller — 2026-06-06 | 1 | 0 | 1 | 0 | 0 | 1 |

## Recommendations before production shipping

1. **HIGH:** Wire `LiveSttCorrectionController` into the sister-mode audio host once a supported native whisper.cpp transcriber package is selected.
2. **HIGH:** Run a physical microphone/loopback QA pass with real sung phrases and verify corrections do not fight manual operator interventions.
3. **MEDIUM:** Add position-correction JSONL logging at the host boundary so live pilot runs can be audited without expanding SyncEngine.

## Final verdict

EP-08 is stronger after this pass because the local STT correction composition contract is now explicit, tested, and live-safe. It is not production-complete until native live transcription and physical audio QA are resolved.
