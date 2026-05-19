# EP05 Section Auto-Detection QA Report — 2026-05-19
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP05 `learn_song` section proposal path: repeated lyric detection, audio-energy contour detection via `librosa.feature.rms`, best-effort failure posture, and sidecar/host contract non-regression.
**Environment:** Local macOS dev, Python sidecar `.venv`, Node 25 `env -i` wrapper.
**Status:** Pass

## Executive summary
EP05 section auto-detection now covers both required heuristics: repeated lyrics and audio RMS energy contours. No defects were surfaced in this focused pass.

The implementation remains conservative: energy analysis is best-effort and cannot block `learn_song`; if librosa/RMS analysis fails, repeated-lyric proposals still return.

## Test environment + persona setup
- Pass: Repository was on `main` after `30a243c docs:(#QA): add M2 close QA report`.
- Pass: Python sidecar tests ran in `.venv`.
- Pass: Node commands used the required clean `env -i` wrapper.
- Pass: No UI persona, DB, external service, or network-backed account was required for this sidecar-only increment.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP05-SAD-TC-01 | Repeated lyric proposal | Local developer | Repeated non-chorus sections are proposed as chorus candidates. | Existing repeated-lyrics path still returns proposals. | Pass |
| EP05-SAD-TC-02 | Audio-energy proposal | Local developer | `learn_song` with `detectSections=true` passes decoded samples into section detection and proposes a loud section from RMS energy contour. | Synthetic low/high/low sample fixture proposed `sectionId="lift"` with `reason` containing `energy_spike` and `energyScore > 1.35`. | Pass |
| EP05-SAD-TC-03 | Best-effort failure posture | Local developer | Energy-analysis failure does not fail `learn_song` or suppress lyric-repetition proposals. | Forced RMS failure returned repeated-lyric proposals without throwing. | Pass |
| EP05-SAD-TC-04 | Python sidecar regression | Local developer | Sidecar tests pass. | 55/55 tests passed. | Pass |
| EP05-SAD-TC-05 | Host contract regression | Local developer | TypeScript build/tests and renderer bundles remain clean. | `tsc -b` passed, 677/677 TS tests passed, karaoke/operator bundles built. | Pass |

## Defects surfaced + fixed
No new defects were surfaced in this pass.

## Network / data layer observations
- No network calls were required. The feature runs entirely in-process in the sidecar.
- No persistent data writes were required. The output contract is the JSON-RPC `learn_song` response field `proposedSections`.
- Code-level evidence: `learn_song_handler` now passes `aligned_words`, decoded samples, and sample rate to `propose_sections` in `python-sidecar/lyricue_sidecar/learning.py:92`.
- Code-level evidence: `propose_sections` computes repeated-lyric reasons and optional energy scores in `python-sidecar/lyricue_sidecar/timing_map.py:161`.
- Code-level evidence: energy analysis imports `librosa.feature.rms` and returns `{}` on failure in `python-sidecar/lyricue_sidecar/timing_map.py:196`.

## Cumulative defect tally (if multi-pass)
| Pass | New defects | Critical | High | Medium | Low | Current status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| EP05 section auto-detection | 0 | 0 | 0 | 0 | 0 | Pass |

## Recommendations before production shipping
1. **HIGH** Complete the remaining EP05 production ML stages: Demucs vocal isolation and WhisperX forced alignment.
2. **MEDIUM** Add a public-domain audio fixture for a full `learn_song` integration test once model download/runtime strategy is settled.
3. **MEDIUM** Surface section proposals in the learn-song UI as operator-accept/reject actions instead of treating them as invisible diagnostics.

## Final verdict
EP05 section auto-detection is locally ready: it now implements the intended repeated-lyrics plus audio-energy heuristic, preserves the offline/no-blocking sidecar posture, and passes the full local regression sweep. EP05 as a whole remains incomplete until the heavyweight production alignment stages land.
