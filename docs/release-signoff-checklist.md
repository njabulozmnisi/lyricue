# LyriCue Release Sign-Off Checklist

This checklist defines the evidence required before LyriCue can be called production-certified for a multi-campus rollout. Local gates are strong, but Gate C, Gate D, and Gate E still require external credentials, signing assets, vendor SDKs, or hardware.

## Current Local Baseline

- TypeScript/Vitest: 793 tests passing across 83 files.
- Publish Worker Vitest: 16 tests passing.
- Python sidecar: 88 passing, 1 skipped in the regular venv.
- Python sidecar with ML dependencies: 88 passing, 1 skipped, 1 known third-party `librosa` deprecation warning.
- `svelte-check`: 0 errors, 0 warnings.
- Gate A local Electron smoke: passing.
- Gate B packaged ML sidecar smoke: passing locally on macOS arm64.
- Gate D packaged sister-app smoke: passing locally on macOS arm64 with retained log/summary evidence; current smoke evidence must include Settings, Publish, Setlist Source, and Publish Credential operator screenshots.
- Release matrix skeleton: present at `.github/workflows/release-matrix.yml`, manual-only, unsigned by default.

Current local aggregate command:

```bash
env -i HOME="$HOME" PWD="$PWD" PATH="/opt/homebrew/opt/node@25/bin:$PWD/node_modules/.bin:/usr/bin:/bin" \
  npm run verify:local
```

## Gate B — Production ML Artifact Sign-Off

Goal: every release artifact ships with known-good local model assets and the packaged sidecar can learn a real song offline.

Required external inputs:

- Final release-owned Demucs, Faster Whisper, and WhisperX alignment model artifacts.
- Model mirror URL if models are distributed separately from the app.
- Per-platform packaged sidecar artifacts from the release matrix.

Required commands/evidence:

1. Stage the final model cache:

```bash
cd python-sidecar
.venv-ml/bin/python scripts/stage_release_models.py --output-root ../build/models/release
```

2. Run packaged `learn_song` smoke per platform artifact:

```bash
cd python-sidecar
LYRICUE_DEMUCS_REPO="../build/models/release/demucs-repo" \
LYRICUE_WHISPERX_DOWNLOAD_ROOT="../build/models/release/huggingface" \
LYRICUE_WHISPERX_ALIGN_MODEL_DIR="../build/models/release/torchaudio-checkpoints" \
LYRICUE_MODEL_CACHE_ONLY=1 \
HF_HUB_OFFLINE=1 \
TRANSFORMERS_OFFLINE=1 \
.venv-ml/bin/python scripts/smoke_packaged_learn_song.py \
  --binary ../build/sidecar/<platform-arch>/lyricue-sidecar \
  --output-json ../docs/qa-reports/evidence/gate-b-release-ml/<platform-arch>-learn-song-summary.json
```

Pass criteria:

- `invalidStdout=[]`.
- Required progress stages present: `decode`, `bpm`, `demucs`, `whisperx`, `timing_map`, `section_detection`, `complete`.
- Timing map validates as `lyricue-timing-v1`.
- Confidence ratio meets the current production fixture threshold.
- Native warnings are either absent or explicitly certified against the current in-memory alignment path.

## Gate C — Multi-Campus Library/Publishing Sign-Off

Goal: a campus can publish, download, import, verify, and recover signed bundles through real infrastructure.

Required external inputs:

- Cloudflare account with R2, KV, and Worker access.
- Wrangler authenticated to the target account.
- GitHub mirror repository and fine-scoped token.
- A real `.lcbundle` generated from LyriCue's library manager.

Required commands/evidence:

1. Dry-run the setup plan:

```bash
node infra/publish-worker/setup-library.mjs \
  --dry-run \
  --org-id=<org-id> \
  --org-name="<org name>" \
  --account-id=<cloudflare-account-id> \
  --github-repo=<owner/repo>
```

2. Run the real setup after reviewing the plan:

```bash
node infra/publish-worker/setup-library.mjs \
  --dry-run=false \
  --org-id=<org-id> \
  --org-name="<org name>" \
  --account-id=<cloudflare-account-id> \
  --github-repo=<owner/repo>
```

3. Publish a signed ZIP `.lcbundle` with `PUT /publish` and `X-LC-Credential`.
4. Verify R2 objects:
   - `catalog.json`
   - `songs/<songId>/<bundleVersion>.lcbundle`
   - `meta/publish-log.jsonl`
   - `trust.json`
5. Verify GitHub mirror receives matching catalog and bundle commits.
6. Run disaster recovery:
   - Configure LyriCue with primary library URL plus GitHub raw mirror URL.
   - Break the primary URL.
   - Refresh catalog.
   - Download bundle from mirror.
   - Verify SHA256 against the mirrored catalog entry.

Pass criteria:

- Real Worker returns successful publish response.
- Catalog includes the new bundle version with correct checksum.
- Client imports the downloaded bundle and rejects a deliberately corrupted checksum.
- Mirror fallback works with primary unavailable.
- Publish credential persists through Electron safe storage in the packaged host.
- Worker rejects publish writes where `X-LC-Org` or `X-LC-Campus` does not match the resolved credential.
- Worker rejects malformed or invalid KV credential metadata with a controlled authorization failure.
- Worker rejects unsafe bundle/project identifiers before writing R2 object keys.

## Gate D — Packaged Release Sign-Off

Goal: signed installers exist for target platforms and package the correct sidecar/resources.

Required external inputs:

- Apple Developer ID certificate, notarization credentials, and any required provisioning profile.
- Windows code-signing certificate.
- GitHub Actions repository secrets and protected release environment.
- Hosted/self-hosted runner access for all target platforms.

Required commands/evidence:

1. Run the manual release matrix with unsigned artifacts first:
   - Workflow: `.github/workflows/release-matrix.yml`
   - Inputs: `package_artifacts=true`, `run_packaged_smoke=true`
2. Download and inspect all uploaded unsigned directory artifacts.
3. Add signing/notarization steps after secrets are configured.
4. Re-run the matrix and retain:
   - macOS arm64 signed/notarized artifact.
   - macOS Intel signed/notarized artifact.
   - Windows x64 signed artifact.
   - Linux x64 artifact.
   - Linux arm64 artifact.
5. Run packaged smoke on every platform where GUI automation is available:

```bash
npm -w @lyricue/sister run smoke:packaged -- \
  --output-dir docs/qa-reports/evidence/gate-d-release/<platform-arch> \
  --timeout-ms 300000
```

Pass criteria:

- Installer/app launches without OS trust warnings after signing/notarization.
- `Contents/Resources` or platform equivalent contains the sidecar binary for the target architecture.
- Packaged smoke JSON reports `status="pass"`, `operatorSettingsOverlayCaptured=true`, `operatorPublishDialogCaptured=true`, `operatorProjectSourceCaptured=true`, `operatorCredentialDialogCaptured=true`, `sidecarStarted=true`, `segmentationReady=true`, `capturedApproved=true`, and `sourcePythonFallback=false`.
- Packaged smoke screenshots are retained under `<output-dir>/screenshots/karaoke` and `<output-dir>/screenshots/operator`.
- Packaged `learn_song` smoke from Gate B passes against the same sidecar artifact.

## Gate D — Fork-Mode Verification

Goal: fork-mode still composes with FreeShow after native vendor SDK prerequisites are installed.

Required external inputs:

- FreeShow native vendor SDKs: NDI, Blackmagic, libltc-wrapper, and any upstream FreeShow build prerequisites.
- FreeShow fork submodule on the intended release branch.

Required evidence:

1. Initialize FreeShow dependencies per upstream docs.
2. Build fork-mode TypeScript and renderer surfaces.
3. Run `npm run demo:walking-skeleton:fork`.
4. Verify the fork output receives the same timing-map and frame stream as sister mode.
5. Capture screenshots of the fork output surface.

Pass criteria:

- Fork-mode Electron starts.
- `ForkOutputAdapter` sends frames through FreeShow output IPC.
- Visual sweep matches sister-mode timing for the demo map.
- No new FreeShow native-module failures.

## Gate E — Hardware/Live Worship Sign-Off

Goal: prove the app remains safe and usable under real audio, display, and operator conditions.

Required external inputs:

- Physical microphone or loopback audio interface.
- Projector/display targets: 1080p, 4K, ultrawide if used at target venues.
- Real rehearsal audio with silence gaps and multi-song transitions.
- Operator available for manual override drills.

Required drills:

1. Tempo accuracy:
   - Feed a known click/vocal reference at multiple BPMs.
   - Verify tempo ratio stays within the intended clamp and displayed word timing remains usable.
2. Rehearsal capture:
   - Capture at least 10 minutes with real silence gaps.
   - Verify segmentation summary, matched songs, unmatched segments, and reviewed timing-map promotion.
3. Graceful degradation:
   - Pull audio input.
   - Force low beat confidence.
   - Switch manual mode.
   - Re-engage automatic sync.
4. Display QA:
   - Verify contrast, sizing, sweep legibility, parallel-language layout, and no overlap at each target resolution.

Pass criteria:

- No crashes during drills.
- Audio input loss reaches Timer within 3 seconds unless Manual was explicitly selected.
- Manual override remains operator-controllable.
- Mode indicator and tier-change banner accurately reflect tier transitions.
- Projector output remains legible and frame delivery has no dropped-frame burst that disrupts lyrics.

## Final Production Verdict Rule

Do not mark LyriCue production-certified until every required evidence item above is attached to a dated QA report. Until then, the correct status is:

> Locally shippable / external proof pending.
