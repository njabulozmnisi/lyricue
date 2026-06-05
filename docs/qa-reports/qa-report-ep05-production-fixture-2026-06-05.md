# EP-05.8 Production Fixture QA Report — 2026-06-05
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP-05.8 public-domain audio fixture and opt-in production `learn_song` run through Demucs/WhisperX.
**Environment:** Local dev, macOS arm64, Python 3.11 ML venv at `python-sidecar/.venv-ml`, fixture `python-sidecar/tests/fixtures/ep05-public-domain/amazing-grace-30s.wav`.
**Status:** Stop-the-line defects 1

## Executive summary
The EP-05.8 fixture now exists and normal CI stays fast: both Python venvs pass with the heavyweight production fixture skipped. Real opt-in production runs completed the Demucs/WhisperX path but failed the quality gate: one run produced 19/26 confident words and the captured evidence rerun produced 18/26, both below the required 85% proxy threshold. Gate B remains blocked for production certification.

## Test environment + persona setup
- Pass: Fixture source is documented as public-domain `Amazing_grace.ogg` from Wikimedia Commons / Library of Congress.
- Pass: Fixture file is a committed 30-second mono 16 kHz WAV with SHA256 `222e21c54a3e0dce97ef920ade61b6b47ee183b174377ceaa73f9ed67ce238c0`.
- Pass: Regular venv suite: `77 passed, 1 skipped in 5.09s`.
- Pass: ML venv suite: `77 passed, 1 skipped, 1 warning in 5.10s`.
- Fail: Opt-in ML fixture run: `1 failed, 8 warnings in 429.17s`.
- Not applicable: No auth persona, DB, browser session, SSR/CSR path, or privacy boundary is involved in this offline sidecar fixture pass.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| EP05-8-001 | Fixture provenance | Local operator | Public-domain audio fixture has documented source, transform, and checksum | README added with source URL, transform, and SHA256 | Pass |
| EP05-8-002 | Default CI posture | Local developer | Heavyweight ML fixture is skipped unless explicitly enabled | `77 passed, 1 skipped` in regular venv | Pass |
| EP05-8-003 | ML CI posture | Local developer | ML venv also skips the heavyweight fixture by default | `77 passed, 1 skipped` in ML venv | Pass |
| EP05-8-004 | Production run | Local operator | Opt-in fixture runs Demucs/WhisperX and produces a quality-passing TimingMap | Production runs completed but confidence ratio was 19/26 on the first run and 18/26 on the evidence rerun | Fail |

## Defects surfaced + fixed
D1 — **HIGH** — Production learning does not yet meet the EP-05.8 quality gate on the public-domain fixture.
Symptom: `LYRICUE_RUN_ML_FIXTURE=1 .venv-ml/bin/pytest tests/test_learning_production_fixture.py -q -s` failed at the confidence gate: `assert (19 / 26) >= 0.85`. A follow-up evidence capture produced 18/26 confident words.
Root cause: Unknown pending deeper ML analysis. The fixture successfully reached Demucs, WhisperX ASR, Pyannote VAD, and wav2vec2 alignment, but the produced word confidences were below the gate for 7 of 26 words. Code-level proof point: the opt-in gate assertion lives in `python-sidecar/tests/test_learning_production_fixture.py:68`.
Latency: This was not visible before because previous EP-05 passes used deterministic alignment or injected production-stage runners, not real model inference on real audio.
Repro steps: Use Python 3.11 ML venv, set `LYRICUE_RUN_ML_FIXTURE=1`, and run `python-sidecar/.venv-ml/bin/pytest tests/test_learning_production_fixture.py -q -s`.
Evidence: The run downloaded/used Demucs and WhisperX model assets, completed in 429.17 seconds, and failed with 19 confident words out of 26. The captured rerun wrote `docs/qa-reports/evidence/ep05-production-fixture-2026-06-05/timing-map.json` and `summary.json` with 18 confident words out of 26.
Fix proposal: Improve the production fixture path before relaxing any gate: capture the generated TimingMap as evidence, compare against manually prepared word timing ground truth, then decide whether the defect is fixture quality, lyric-window mismatch, model selection, vocal-isolation quality, or forced-alignment mapping.
Fix status: Proposed; not fixed.

## Network / data layer observations
- Network: First opt-in run downloaded an 80.2 MB Demucs checkpoint and a 360 MB wav2vec2 alignment model into local user caches.
- Runtime warnings: `pyannote.audio` reported `torchcodec` was not installed correctly for the local FFmpeg dynamic libraries. The run continued, but packaged release validation must resolve this warning or prove it is harmless for the chosen decode path.
- Model cache: The current production-stage model APIs use their own package caches during real inference. The LyriCue manifest/cache preflight remains useful for host progress and checksums, but Gate B still needs a release-owned model artifact strategy that proves offline reuse by the actual model loaders.
- Data layer: No database writes. The fixture WAV is 940 KB and committed under `python-sidecar/tests/fixtures/ep05-public-domain/`.

## Cumulative defect tally (if multi-pass)
| Pass | Defects | CRITICAL | HIGH | MEDIUM | LOW | INFO |
|---|---:|---:|---:|---:|---:|---:|
| Gate B ML environment readiness | 1 | 0 | 0 | 0 | 1 | 0 |
| EP-05.8 production fixture | 1 | 0 | 1 | 0 | 0 | 0 |

## Recommendations before production shipping
1. **HIGH** Capture and inspect the failing TimingMap from the real fixture run; compare against a manually prepared word-timing ground truth instead of using confidence alone as the final quality proxy.
2. **HIGH** Resolve the release-owned model artifact path so Demucs/WhisperX use checksum-pinned local assets, not only package-managed caches.
3. **MEDIUM** Investigate the `torchcodec`/FFmpeg warning in the ML venv and pin compatible runtime dependencies for packaged sidecar builds.
4. **MEDIUM** Add a second cleaner vocal fixture if this Library of Congress field recording proves too noisy for a deterministic certification threshold.

## Final verdict
EP-05.8 is now repeatable but not passing. The test fixture and opt-in production harness are in place, and the real production path runs end-to-end far enough to produce a TimingMap, but the first quality result is below gate. Gate B cannot be marked production-certified until the timing-quality root cause is understood and re-verified.
