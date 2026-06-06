# Gate D Packaged Sister-App Smoke QA Report — 2026-06-06

**QA persona:** Senior QA analyst — packaged runtime + Electron smoke + sidecar boundary verification
**Scope:** macOS arm64 sister-mode directory package, dual-window walking skeleton, operator smoke harness, bundled sidecar launch from `process.resourcesPath`
**Environment:** Local macOS arm64 directory package at `apps/sister/release/mac-arm64/LyriCue.app`; `LC_DEPLOYMENT_MODE=sister LC_E2E_MODE=1 LC_VERBOSE=1 LC_SMOKE_TEST=1 LC_CAPTURE_EVIDENCE=1`
**Status:** Pass-with-caveats

## Executive summary

Packaged sister-app smoke passes locally after fixing one **HIGH** packaged-runtime defect. The `.app` contains the bundled sidecar at `Contents/Resources/sidecar/darwin-arm64/lyricue-sidecar`, the Electron package launches, both windows render, operator persistence works, and rehearsal capture reaches the packaged sidecar and returns a matched segment. Remaining caveats are release infrastructure: notarized installer, platform matrix, and signed distribution artifacts.

## Test environment + persona setup

- Repo branch: local `main`.
- Package command: `cd apps/sister && npx -p electron-builder@26.8.1 electron-builder --dir --mac`.
- Packaged app: `apps/sister/release/mac-arm64/LyriCue.app/Contents/MacOS/LyriCue`.
- Sidecar resource check: `apps/sister/release/mac-arm64/LyriCue.app/Contents/Resources/sidecar/darwin-arm64/lyricue-sidecar`, executable, 306 MB.
- Scripted smoke command: `npm -w @lyricue/sister run smoke:packaged`.
- Retained evidence: `docs/qa-reports/evidence/gate-d-packaged-sister-smoke-2026-06-06/packaged-sister-smoke-2026-06-06T08-20-21-279Z.json` and matching `.log`.
- Persona: local operator via packaged Electron operator window.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| GD-SIS-01 | Electron directory package | Release operator | `electron-builder --dir --mac` produces `.app` with app.asar and extraResources sidecar | Package succeeded after manifest fixes; ad-hoc signed directory app produced | Pass |
| GD-SIS-02 | Packaged dual-window launch | Release operator | Karaoke output and operator windows render from `app.asar` | Both windows loaded from `Contents/Resources/app.asar/public/build/*`; renderer frame stream remained active | Pass |
| GD-SIS-03 | Packaged smoke harness | Release operator | Smoke harness completes without smoke failures | `[smoke] complete: pass` | Pass |
| GD-SIS-04 | Bundled sidecar boundary | Release operator | Rehearsal segmentation launches bundled sidecar, not source Python | Sidecar stderr logged `server loop started; 7 handlers registered`; segmentation returned `stage: "segments_ready"` | Pass |
| GD-SIS-05 | Operator persistence inside package | Release operator | Arrangement and translation commands persist and reload map | `operator persistence exercise result=persisted` | Pass |
| GD-SIS-06 | Release artifact capture | Release operator | Packaged smoke writes durable stdout/stderr log and parseable summary | JSON summary reports `status: "pass"`, `sidecarStarted: true`, `segmentationReady: true`, `capturedApproved: true`, `sourcePythonFallback: false` | Pass |

## Defects surfaced + fixed

### D-GD-01 — **HIGH**

- Symptom: First packaged smoke rendered the app and reported smoke pass, but rehearsal segmentation returned `No usable Python interpreter found. Tried: python3, python`.
- Root cause: `apps/sister/src/main.ts` passed `process.env.NODE_ENV` into `resolveSidecarLaunch`; packaged Electron did not set `NODE_ENV=production`, so the app selected source-mode sidecar resolution instead of `process.resourcesPath`.
- Latency: Present since the production sidecar resolver was added; source-mode and direct packaged-sidecar smokes did not exercise the packaged Electron host boundary.
- Repro steps: Build the sister `.app`, launch without `NODE_ENV`, run `LC_SMOKE_TEST=1 LC_CAPTURE_EVIDENCE=1`; inspect rehearsal capture result.
- Evidence: First packaged smoke returned `segmentation.error="No usable Python interpreter found. Tried: python3, python"`.
- Fix: Added `sidecarResolverNodeEnv({ isPackaged, nodeEnv })`, wired `app.isPackaged` to force production resolution, and tightened the smoke harness so segmentation errors fail smoke.
- Verification: Rebuilt `.app`, relaunched packaged smoke without `NODE_ENV`; sidecar started from packaged resources and rehearsal segmentation returned a matched segment.

### D-GD-02 — **MEDIUM**

- Symptom: electron-builder refused to package because `electron` was declared in `dependencies`.
- Root cause: `apps/sister/package.json` placed Electron in runtime dependencies instead of dev dependencies.
- Latency: Present in sister packaging metadata; local Electron smoke used the workspace Electron binary and did not run electron-builder.
- Repro steps: `cd apps/sister && npx -p electron-builder@26.8.1 electron-builder --dir --mac`.
- Evidence: electron-builder error: `Package "electron" is only allowed in "devDependencies"`.
- Fix: Moved `electron` to `devDependencies`.
- Verification: Packaging advanced to Electron-version resolution.

### D-GD-03 — **MEDIUM**

- Symptom: electron-builder refused to infer Electron version when `electron` was declared as `"*"`.
- Root cause: Release package metadata did not pin an exact Electron host version.
- Latency: Present in sister packaging metadata; npm workspace dev runs tolerate the wildcard.
- Repro steps: Run electron-builder after moving Electron to dev dependencies while keeping `"*"`.
- Evidence: electron-builder error: `Cannot compute electron version ... version ("*") is not fixed in project`.
- Fix: Pinned sister Electron dev dependency to `37.10.3` and added sister `electron-builder` dev dependency.
- Verification: `electron-builder --dir --mac` completed and produced `release/mac-arm64/LyriCue.app`.

## Network / data layer observations

- One-time packaging downloaded the Electron `37.10.3` macOS arm64 runtime because it was not cached locally.
- Runtime smoke used local packaged files and local sidecar process only; no outbound runtime calls were observed in the app output.
- Rehearsal capture wrote a local WAV under the app support directory and promoted the matched segment through operator IPC.
- Packaged runtime remained responsive while the onefile sidecar cold-started; diagnostics stayed around 57-59 fps with `dropped=0`.

## Cumulative defect tally

| Pass | Defects | Critical | High | Medium | Low |
|---|---:|---:|---:|---:|---:|
| Gate D packaged sister smoke — 2026-06-06 | 3 | 0 | 1 | 2 | 0 |

## Recommendations before production shipping

1. **HIGH:** Add packaged sister-app smoke to CI/release jobs on every target platform after signing assets are available.
2. **MEDIUM:** Wire `npm -w @lyricue/sister run smoke:packaged` into release CI once signed platform artifacts are produced.
3. **MEDIUM:** Revisit onefile sidecar startup time before production rollout; local packaged smoke stayed stable, but startup took roughly two minutes before `server loop started`.

## Final verdict

Local macOS arm64 packaged sister-app smoke is pass-with-caveats. The host now resolves the bundled sidecar from `process.resourcesPath`, and the full packaged smoke reaches dual-window rendering, operator persistence, rehearsal segmentation, and segment approval. Production release remains blocked on external Gate D items: signed/notarized installers, platform matrix artifacts, and fork-mode vendor SDK verification.
