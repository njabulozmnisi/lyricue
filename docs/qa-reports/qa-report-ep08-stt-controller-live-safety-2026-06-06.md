# EP08 STT Controller Live-Safety QA Report — 2026-06-06
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP-08 host-neutral live STT correction controller failure isolation for transcriber, dispatch, and decision-observer boundaries.
**Environment:** Local dev workspace at `/Users/njabulomnisi/Projects/Dojo/worshipsync`; pure core STT controller verification with Node 25 via the required isolated shell wrapper.
**Status:** Pass-with-caveats

## Executive summary

The live STT correction controller now fails closed when the SyncEngine dispatch boundary or decision observer throws. One **HIGH** live-safety defect was surfaced and fixed. No **CRITICAL** defects were found.

The remaining EP-08 caveat is unchanged: native Whisper.cpp runtime selection and packaged-platform proof are still external to this local slice.

## Test environment + persona setup

- Pass: Repository workspace was local `main`; only current EP-08 controller hardening changes and ignored `.claude/` were present.
- Pass: Node commands used the documented `env -i` Node 25 wrapper.
- Pass: No native Whisper.cpp package was loaded; transcript output was mocked at the controller boundary.
- Pass: Persona was the live SyncEngine host receiving local STT phrase corrections during performance.
- Pass: Privacy and literal-drift checks are not applicable to this host-neutral correction controller.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP08-LS-01 | Cross-section correction | Sync host | Confident transcript dispatches a `positionCorrection` event. | Existing dispatch test still passes. | Pass |
| EP08-LS-02 | STT disabled | Sync host | Disabled controller returns no-op without transcribing. | Existing disabled test still passes. | Pass |
| EP08-LS-03 | Low confidence | Sync host | Low-confidence transcript does not dispatch. | Existing confidence gate test still passes. | Pass |
| EP08-LS-04 | Transcriber failure | Sync host | Native/STT exception returns `error` and does not throw. | Existing transcriber isolation test still passes. | Pass |
| EP08-LS-05 | Dispatch failure | Sync host | Throwing SyncEngine dispatch returns `error`, calls `onError`, and does not throw out of `tick()`. | Controller returned `error` with `sync dispatch unavailable`. | Pass |
| EP08-LS-06 | Decision observer failure | Sync host | Throwing observer is reported but does not undo a successful correction. | Controller returned `corrected`, dispatch fired, and `onError` received `decision observer unavailable`. | Pass |

## Defects surfaced + fixed

**D42 — HIGH — STT correction controller could throw after a valid transcript**  
Symptom: `LiveSttCorrectionController.tick()` isolated transcriber failures, but a throwing `dispatch()` or `onDecision()` callback could still escape the live correction tick after a valid phrase match.  
Root cause: The controller's failure boundary wrapped only `RollingSttWindow.tick()`. The downstream SyncEngine dispatch and observer callbacks were trusted even though they execute on the live path.  
Latency: Present since the controller composition layer was introduced; earlier tests covered native transcriber failure but not downstream host callback failure.  
Repro steps: Instantiate the controller with a confident cross-section transcript and a dispatch or observer callback that throws; previous code rejected/escaped instead of returning a live-safe result.  
Evidence: Dispatch failure isolation is covered in [live-stt-correction-controller.test.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/stt/live-stt-correction-controller.test.ts:113), and observer isolation is covered in [live-stt-correction-controller.test.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/stt/live-stt-correction-controller.test.ts:129). The guarded implementation lives in [live-stt-correction-controller.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/stt/live-stt-correction-controller.ts:102). Focused verification passed: `live-stt-correction-controller.test.ts` 6/6 and `tsc -b`. Full local verification passed: `tsc -b`, root Vitest 760/760, Python sidecar 88 passed/1 skipped, Python sidecar ML 88 passed/1 skipped, `svelte-check` 0 errors/warnings, and Worker Vitest 11/11.  
Fix proposal: Wrap correction dispatch and decision observer callbacks, route failures to `onError`, return `error` when dispatch itself fails, and preserve `corrected` when only the observer fails after a successful dispatch.  
Fix status: Fixed and verified locally in this change.

## Network / data layer observations

- Network: No network calls are made by the live STT correction controller.
- Data layer: This slice does not write position logs directly; host logging remains a separate integration concern.
- Console: Focused tests emitted no unexpected console errors.

## Cumulative defect tally (if multi-pass)

| Pass | Defects | Critical | High | Medium | Low | Fixed in pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| EP08 STT correction scaffolding — 2026-06-06 | 0 | 0 | 0 | 0 | 0 | 0 |
| EP08 STT correction controller — 2026-06-06 | 1 | 0 | 1 | 0 | 0 | 1 |
| EP08 STT controller live-safety — 2026-06-06 | 1 | 0 | 1 | 0 | 0 | 1 |

## Recommendations before production shipping

1. **HIGH:** Select and package a supported native Whisper.cpp binding, then re-run this controller pass with the real transcriber.
2. **HIGH:** Wire the controller into the sister-mode audio host behind the operator STT toggle once the native dependency is selected.
3. **MEDIUM:** Add host-level position-correction JSONL logging around successful corrections and callback failures.

## Final verdict

EP-08's controller boundary is safer after this pass because failures after a recognized phrase can no longer throw out of the live correction tick. EP-08 remains locally partial until the native STT runtime and physical audio path are proven.
