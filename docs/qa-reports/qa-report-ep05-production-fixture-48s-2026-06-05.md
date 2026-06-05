# EP-05 Production Fixture Follow-Up QA Report — 2026-06-05

**QA persona:** Senior QA analyst — production ML fixture + data-layer evidence + defect triage
**Scope:** EP-05.8 public-domain Amazing Grace production learning fixture after the prior 30-second fixture failed the confidence gate.
**Environment:** Local macOS arm64 host; Python 3.11 ML venv at `python-sidecar/.venv-ml`; Demucs `htdemucs`; WhisperX `small`; no application server or database.
**Status:** Pass-with-caveats

## Executive summary

The EP-05 production fixture gate now passes. The root cause of the previous failure was the fixture itself: the first 30 seconds of the source recording cut the first verse before the final phrase completed, forcing low-confidence timings near the boundary.

The fixture was replaced with a 48-second excerpt from the same public-domain source. The opt-in production test passed, and evidence output reached 25/26 confident words, a 0.962 confidence ratio. No **CRITICAL** defects remain for this local fixture gate.

## Test environment + persona setup

- Python ML environment: `python-sidecar/.venv-ml` on Python 3.11.
- Audio fixture: `python-sidecar/tests/fixtures/ep05-public-domain/amazing-grace-48s.wav`, mono 16 kHz WAV, SHA256 `0b4c71c9dbd66e2a02f9cfd7f24b27f5450573153a3ae5e84cbbe3a33e651329`.
- Source recording: Wikimedia Commons `Amazing_grace.ogg`, 141.363 seconds.
- Persona setup: not applicable; this pass tests the sidecar production learning data path.
- Pre-flight: repo local, no DB/migrations/background services involved, ML dependencies already installed from Gate B setup.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| EP05-FX-01 | 30-second failure triage | QA analyst | Determine whether failure is code, model, or fixture | 38-second probe improved confidence from 18/26 to 21/26, indicating truncation was material | Pass |
| EP05-FX-02 | Longer fixture probe | QA analyst | Longer excerpt should avoid boundary clipping | 48-second probe reached 24/26 confident words | Pass |
| EP05-FX-03 | Opt-in production fixture test | Release engineer | `LYRICUE_RUN_ML_FIXTURE=1` test passes with >=0.85 confidence ratio | `1 passed, 7 warnings in 28.25s` | Pass |
| EP05-FX-04 | Evidence generation | Release engineer | Persist TimingMap + summary evidence for the passing fixture | `summary.json` reports 25/26 confident words, ratio 0.9615 | Pass |

## Defects surfaced + fixed

### D-EP05-FX-01 — **HIGH**

Symptom: The committed 30-second public-domain fixture failed the production confidence gate at 18-19/26 confident words.

Root cause: The fixture was generated from only the first 30 seconds of a 141-second source recording. The first verse continues beyond that boundary, so the final phrase was clipped and WhisperX assigned very low confidence to the trailing words.

Latency: Introduced with the first production fixture gate. Unit tests did not catch it because the heavyweight production fixture is opt-in, and the initial fixture transform was not validated against manually inspected verse duration before committing.

Repro steps:

1. Run the previous 30-second fixture through `learn_song` with `alignmentMode=production`.
2. Observe final words compressed at the 29-second boundary and confidence ratio below 0.85.

Evidence:

- Failed historical evidence: `docs/qa-reports/evidence/ep05-production-fixture-2026-06-05/summary.json`.
- Passing follow-up evidence: `docs/qa-reports/evidence/ep05-production-fixture-48s-2026-06-05/summary.json`.

Fix proposal: Replace the fixture with a 48-second excerpt from the same source recording and update the opt-in test duration bound.

Fix status: Fixed locally.

## Network / data layer observations

- The follow-up fixture run required no new model downloads; it reused the existing local ML caches.
- The sidecar emitted the known torchcodec warning. The run still completed because LyriCue passes an in-memory waveform into WhisperX. This remains a release-packaging warning until the final packaged ML runtime proves its decode path.
- The evidence TimingMap preserves all 26 lyric tokens in monotonic order and stays inside the 48.5-second test bound.
- This fixture intentionally differs from the original EP-05.8 "30-second clip" wording because the selected public-domain source recording takes roughly 46.7 seconds to complete the first verse under test.

## Cumulative defect tally

| Pass | Critical | High | Medium | Low | Info | Status |
|---|---:|---:|---:|---:|---:|---|
| EP-05 30-second production fixture | 0 | 1 | 0 | 0 | 0 | Fixed by 48-second fixture |
| EP-05 48-second production fixture | 0 | 0 | 0 | 0 | 1 | Pass-with-caveats |

## Recommendations before production shipping

1. **HIGH** Keep this opt-in production fixture in the release checklist and run it from the packaged sidecar binary, not only from source.
2. **HIGH** Provision checksum-pinned, loader-compatible Demucs and WhisperX model directories and rerun this fixture with `LYRICUE_MODEL_CACHE_ONLY=1`.
3. **MEDIUM** Resolve or explicitly certify the torchcodec warning in the release ML runtime so future decode-path regressions are not hidden as expected warning noise.
4. **MEDIUM** Add a small fixture-authoring checklist: source duration, lyric coverage, excerpt tail margin, SHA256, and manual first-pass timing inspection.

## Final verdict

The local EP-05 production fixture gate is now passing and suitable as a repeatable heavyweight regression check. Gate B remains open for release-owned offline model artifacts, packaged-sidecar ML execution, and operator-UI production learning evidence.
