# EP05 Production Stage Contracts QA Report — 2026-05-19
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP05 production song-learning stage boundaries: Demucs vocal isolation, WhisperX forced alignment, explicit `alignmentMode`, protocol-shaped failures, optional ML dependency posture, and deterministic-path non-regression.
**Environment:** Local macOS dev, Python sidecar `.venv`, Node 25 `env -i` wrapper.
**Status:** Pass-with-caveats

## Executive summary
The EP05 production path now has concrete Demucs and WhisperX stage contracts behind `options.alignmentMode: "production"`. No new defects were surfaced in this pass.

The caveat is explicit: this pass verifies contracts and failure posture with injected runners, not a real model download/run. Full production proof still requires installing `.[ml]`, caching the models, and running the public-domain E2E fixture.

## Test environment + persona setup
- Pass: Repository was on `main` after `c474e23 feat:(#EP-05): add audio-energy section proposals`.
- Pass: Python sidecar tests ran in `.venv`.
- Pass: Node commands used the required clean `env -i` wrapper.
- Pass: No DB, browser persona, external service, or network-backed account was required.
- Pass-with-caveat: Demucs/WhisperX dependencies are declared as optional `.[ml]` dependencies; they were not installed or executed in this local pass.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP05-PSC-TC-01 | Production mode routing | Local developer | `learn_song` accepts `alignmentMode="production"` and routes through isolation/alignment before timing-map assembly. | Injected isolation/alignment runners were called; timing map preserved returned confidences and production model metadata. | Pass |
| EP05-PSC-TC-02 | Invalid mode validation | Local developer | Unknown `alignmentMode` fails before file decode/model work. | Invalid mode returned `ERROR_INVALID_PARAMS`. | Pass |
| EP05-PSC-TC-03 | Demucs stage success | Local developer | Vocal isolation runner output is coerced to mono float samples and reports RMS/model metadata. | `isolate_vocals` returned `IsolatedVocals` with expected RMS and sample rate. | Pass |
| EP05-PSC-TC-04 | Demucs low-vocal failure | Local developer | Near-silent vocal stem fails as `NO_VOCALS_DETECTED`. | Zero-RMS fixture returned `ERROR_NO_VOCALS_DETECTED` with `reason="no_vocals_detected"`. | Pass |
| EP05-PSC-TC-05 | Demucs native failure | Local developer | Runner/native failure becomes `VOCAL_ISOLATION_FAILED`, not an unhandled exception. | Forced runner failure returned `ERROR_VOCAL_ISOLATION_FAILED`. | Pass |
| EP05-PSC-TC-06 | WhisperX stage success | Local developer | Alignment runner output is wrapped with model/language metadata. | `align_vocals` returned expected `AlignedWord` sequence and model metadata. | Pass |
| EP05-PSC-TC-07 | WhisperX empty/failure paths | Local developer | Empty alignment and runner failure return `ALIGNMENT_FAILED`. | Both failure paths returned `ERROR_ALIGNMENT_FAILED`. | Pass |
| EP05-PSC-TC-08 | Forced-lyrics segment contract | Local developer | Known lyric text replaces transcription segment text before WhisperX alignment. | `_forced_segments` returned one segment with known lyric text and transcription timing or vocal-duration fallback. | Pass |
| EP05-PSC-TC-09 | Regression sweep | Local developer | Existing TS/Python/build floor stays clean. | Python sidecar passed locally at 65 tests before the full sweep. | Pass |

## Defects surfaced + fixed
No new defects were surfaced in this pass.

## Network / data layer observations
- No network calls were required. The new production stage modules import optional ML packages only when the production runner executes.
- No persistent data writes were required unless a caller explicitly passes `debugVocalsPath`, which writes a debug WAV through `soundfile`.
- Code-level evidence: `learn_song_handler` validates `alignmentMode` and branches production/deterministic mode in `python-sidecar/lyricue_sidecar/learning.py:47`.
- Code-level evidence: production mode calls `isolate_vocals` and `align_vocals` before assembling the timing map in `python-sidecar/lyricue_sidecar/learning.py:67`.
- Code-level evidence: Demucs stage handles missing dependencies, device selection, MPS/CUDA-to-CPU OOM fallback, low-RMS vocals, and debug WAV output in `python-sidecar/lyricue_sidecar/vocal_isolation.py:25`.
- Code-level evidence: WhisperX stage builds forced lyric segments and maps `word_segments` back to LyriCue section/line indexes in `python-sidecar/lyricue_sidecar/forced_alignment.py:50`.

## Cumulative defect tally (if multi-pass)
| Pass | New defects | Critical | High | Medium | Low | Current status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| EP05 section auto-detection | 0 | 0 | 0 | 0 | 0 | Pass |
| EP05 production stage contracts | 0 | 0 | 0 | 0 | 0 | Pass-with-caveats |

## Recommendations before production shipping
1. **HIGH** Install `python-sidecar[ml]`, provision model cache, and run a real Demucs + WhisperX pass on a public-domain fixture.
2. **HIGH** Add the EP05.8 sidecar subprocess integration test using a 30-second audio fixture once model runtime is available.
3. **MEDIUM** Emit progress notifications during Demucs and WhisperX stages so the operator UI can show long-running learning progress.
4. **MEDIUM** Move production model/device selection into settings once first-run model download work resumes.

## Final verdict
The EP05 production learning path is no longer just a deterministic placeholder: Demucs and WhisperX now have explicit, test-backed stage boundaries and protocol-shaped failure behavior. It is ready for the next ML-runtime step, with the caveat that real model execution remains unproven until dependencies and model cache are installed.
