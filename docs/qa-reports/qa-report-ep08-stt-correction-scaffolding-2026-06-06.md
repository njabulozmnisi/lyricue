# EP-08 STT Correction Scaffolding QA Report — 2026-06-06

**QA persona:** Senior QA analyst — unit boundary + data-contract + defect triage
**Scope:** EP-08 local STT correction scaffolding: rolling 16 kHz window buffer, transcription cadence/backpressure, transcript-to-position correction decision, STT-disabled no-op, and position-correction JSONL logging.
**Environment:** Local dev, `/Users/njabulomnisi/Projects/Dojo/worshipsync`.
**Status:** Pass-with-caveats

## Executive summary

The EP-08 local correction path now has tested core primitives for bounded audio windows, no-queue backpressure, transcript matching, correction-event generation, and durable correction logs. No defects were surfaced in this pass. The remaining caveat is native Whisper.cpp binding/model-download integration, which is platform-specific and still not production-proven.

## Test environment + persona setup

- Repository state: local core-module verification, no app persona required.
- TypeScript build: pass via `npx tsc -b`.
- Focused STT suite: pass, 5 files / 20 tests.
- Data layer: pass; JSONL append and retention pruning verified against a temp directory.
- External services: not required for this local core pass.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| EP08-STT-001 | Float32 ring buffer | Runtime STT pipeline | Buffer preserves chronological order and drops oldest samples after overflow | Snapshot returned newest samples in order, including single-push overflow | Pass |
| EP08-STT-002 | Rolling STT cadence | Runtime STT pipeline | Processor waits for minimum audio and dispatches at cadence | Returned `insufficient-audio`, then one bounded dispatch, then `not-due` inside cadence | Pass |
| EP08-STT-003 | Backpressure | Runtime STT pipeline | A due window while transcription is in-flight increments dropped count and does not queue | Returned `dropped` with `droppedWindows=1`; first transcription completed normally | Pass |
| EP08-STT-004 | STT disable switch | Operator setting | Disabled STT produces no correction decision | Evaluator returned `null` with `sttEnabled=false` | Pass |
| EP08-STT-005 | Same-section suppression | Live sync runtime | Same-section phrase does not jump the cursor by default | Evaluator returned `null` for current-section transcript | Pass |
| EP08-STT-006 | Cross-section correction | Live sync runtime | Cross-section phrase emits SyncEngine `positionCorrection` event | Generated `{ kind:"positionCorrection", targetRefMs:3000, wallTime:9000 }` | Pass |
| EP08-STT-007 | Position logging | Runtime diagnostics | Corrections append to `positions-YYYY-MM-DD.jsonl` and retention removes only expired position logs | JSONL append passed; 30-day prune removed only stale dated position log | Pass |

## Defects surfaced + fixed

None in this pass.

## Network / data layer observations

No network calls are involved in this slice. The data-layer contract for position corrections is a JSONL record containing timestamp, show ID, recognized phrase, confidence, old section/time, and new section/time. Retention deletes only files matching `positions-YYYY-MM-DD.jsonl` older than the configured retention window, leaving unrelated logs untouched.

## Cumulative defect tally (if multi-pass)

| Pass | Critical | High | Medium | Low | Info |
|---|---:|---:|---:|---:|---:|
| 2026-06-06 EP-08 STT correction scaffolding | 0 | 0 | 0 | 0 | 0 |

## Recommendations before production shipping

1. **HIGH** Add native Whisper.cpp binding integration tests once the selected package and release model path are pinned: load `base.en`, transcribe a 3-second WAV, and assert transcript similarity.
2. **HIGH** Add packaged-app proof that the native STT binding loads from the signed installer on each release target.
3. **MEDIUM** Add a live Electron smoke that feeds a deterministic transcript into the STT correction evaluator and verifies the karaoke cursor animates to the corrected section.

## Final verdict

This EP-08 slice is locally sound and ready to build on. It does not close EP-08 because the native Whisper.cpp addon/model-download story remains open and must be proven on the release platforms before production shipping.
