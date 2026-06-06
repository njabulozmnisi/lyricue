# EP-05 Operator Production Learn Song QA Report — 2026-06-06

**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** Production-mode Learn Song through the sister-mode operator bridge: operator progress IPC, main-process `learn_song` handler, source ML sidecar launch, Demucs + WhisperX alignment, TimingMap validation, and evidence capture.
**Environment:** Local macOS arm64 dev run; `LC_DEPLOYMENT_MODE=sister`, `LC_E2E_MODE=1`, `LC_CAPTURE_EVIDENCE=1`, `LC_CAPTURE_OPERATOR_TOOLS=1`, `LC_CAPTURE_PRODUCTION_LEARN_SONG=1`, `LC_SIDECAR_PYTHON=python-sidecar/.venv-ml/bin/python`; staged model cache under `build/models/release`; offline/cache-only flags enabled.
**Status:** Pass-with-caveats

## Executive summary

Production-mode Learn Song now completes through the operator bridge and returns a valid TimingMap from the Amazing Grace fixture. One **HIGH** defect was found and fixed: the operator path used a 120s request timeout that was too short for observed packaged cold-start production alignment.

No **CRITICAL** defects remain in this pass. The remaining caveat is release certification of torchcodec/FFmpeg and torchaudio native dependency warnings already carried by the packaged ML sidecar pass.

## Test environment + persona setup

- Pass scope: operator-window production Learn Song, not FreeShow fork mode.
- Persona: local live operator in sister-mode E2E run; no login/session layer applies.
- Renderer/process pre-flight: karaoke and operator windows loaded; operator renderer signalled ready; output frames continued during the ML job.
- Sidecar pre-flight: source-mode sidecar launched with `LC_SIDECAR_PYTHON=python-sidecar/.venv-ml/bin/python`; `ready` notification received.
- Model cache pre-flight: `LYRICUE_DEMUCS_REPO`, `LYRICUE_WHISPERX_DOWNLOAD_ROOT`, and `LYRICUE_WHISPERX_ALIGN_MODEL_DIR` pointed at `build/models/release`; cache-only/offline flags were set.
- Evidence path: `docs/qa-reports/evidence/ep05-operator-production-learn-song-2026-06-06/production-learn-song-summary.json`.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| EP05-OP-01 | Operator production Learn Song request | Live operator | Main handler accepts production payload and runs sidecar `learn_song` | Handler completed in 26,497ms | Pass |
| EP05-OP-02 | Operator progress IPC | Live operator | Renderer receives progress stages from main via `lyricue:operator:learn-song-progress` | Received `decode`, `bpm`, `demucs`, `whisperx`, `timing_map`, `section_detection`, `complete` | Pass |
| EP05-OP-03 | TimingMap contract | Live operator | Returned map validates against `lyricue-timing-v1` | Validation errors empty | Pass |
| EP05-OP-04 | Alignment quality | Live operator | Fixture reaches confidence ratio `>=0.85` | 24/26 confident words, ratio `0.9230769230769231` | Pass |
| EP05-OP-05 | Offline model posture | Release engineer | Production alignment uses staged local cache, not network | Run used cache-only/offline env and completed | Pass |
| EP05-OP-06 | E2E output continuity during learning | Live operator | Karaoke output remains alive while learning runs | Diagnostics continued reporting delivered frames, dropped `0`, lastError `none` | Pass |

## Defects surfaced + fixed

### D-EP05-OP-01 — **HIGH**

Symptom: The operator production Learn Song path enforced a fixed 120s sidecar request timeout. Packaged production alignment had already produced a cold-run sample of about 229s, so a real packaged operator run could fail even when the sidecar was healthy.

Root cause: `apps/sister/src/main.ts:1094` passed `timeoutMs: 120_000` for every Learn Song request, while deterministic and production alignment have materially different runtime envelopes.

Latency: The deterministic Learn Song wizard smoke and source-mode tests ran inside 120s. The defect only became visible after packaged ML variance runs measured cold-start production alignment.

Repro steps: Run packaged production `learn_song` from a cold process with the Amazing Grace fixture and compare elapsed time to the operator handler's 120s timeout.

Evidence: Packaged QA report recorded cold packaged total around 229s; this pass fixed the handler and then completed the source-ML operator bridge pass in `26497ms` warm with valid progress and TimingMap evidence.

Fix status: Fixed. `apps/sister/src/learn-song-sidecar-options.ts:5` keeps deterministic timeout at 120s and sets production timeout to 7 minutes. `apps/sister/src/main.ts:1095` now selects timeout by alignment mode. `apps/sister/src/learn-song-sidecar-options.test.ts:9` pins the split.

### D-EP05-OP-02 — **LOW**

Symptom: Source-mode Electron QA could not select the ML venv because `getSidecarController()` preferred `python-sidecar/.venv` whenever present, ignoring the usual `PYTHON` resolver path.

Root cause: The source sidecar path always passed the `.venv` interpreter as a settings override before `nodePythonResolver` could consider the environment.

Latency: Most source-mode sidecar tests use the lightweight `.venv`; production alignment requires `.venv-ml`, so this only blocked realistic production Learn Song QA.

Repro steps: Launch Electron source mode with `PYTHON=python-sidecar/.venv-ml/bin/python` while `python-sidecar/.venv/bin/python` exists; observe source mode still uses `.venv`.

Evidence: This pass added `LC_SIDECAR_PYTHON` and used it to launch the source sidecar from `.venv-ml`; the evidence summary shows production alignment completed.

Fix status: Fixed. `apps/sister/src/main.ts:1254` now resolves source-mode Python through `LC_SIDECAR_PYTHON` first, falling back to `.venv`, then auto-discovery. `apps/sister/src/learn-song-sidecar-options.test.ts:20` pins the precedence.

## Network / data layer observations

- No outbound network call was required by the app path under test; cache-only/offline model flags were set for the sidecar process.
- JSON-RPC stdout stayed clean enough for the controller to parse all progress notifications and final response.
- Operator progress IPC delivered the expected stage sequence to the renderer subscription.
- No database or persistent library write was part of this path; the evidence run validated the returned TimingMap but did not save it into project storage.
- Runtime stderr still reports torchcodec/FFmpeg warnings and a Pyannote checkpoint upgrade message. These are not blockers for the current in-memory audio path, but they remain release certification caveats.

## Cumulative defect tally

| Pass | Critical | High | Medium | Low | Info | Status |
|---|---:|---:|---:|---:|---:|---|
| EP-05 packaged ML sidecar | 0 | 5 | 0 | 0 | 1 | 5 fixed, 1 variance note |
| EP-05 operator production Learn Song | 0 | 1 | 0 | 1 | 0 | 2 fixed |

## Recommendations before production shipping

1. **HIGH** Add a release smoke that launches the packaged sister app and runs `LC_CAPTURE_PRODUCTION_LEARN_SONG=1` against the packaged sidecar, not only source `.venv-ml`.
2. **MEDIUM** Add a cancellation QA pass for production Learn Song once the UI exposes user-facing cancellation for the heavy alignment job.
3. **MEDIUM** Resolve or certify the torchcodec/FFmpeg and torchaudio native dependency warnings in the signed/notarized release artifact.
4. **LOW** Keep the operator production evidence harness explicit-only; it should not run during normal fast smoke because it is intentionally heavyweight.

## Final verdict

EP-05 production Learn Song is locally pass-with-caveats through the sister-mode operator bridge. The operator can launch production alignment, receive progress, and get a validated TimingMap with acceptable confidence from the public-domain fixture. The remaining gap is packaged-app release certification for the same operator evidence path plus native dependency warning resolution.
