# Gate D Release Matrix Skeleton QA Report — 2026-06-06

**QA persona:** Senior QA analyst — workflow boundary + release-gate triage
**Scope:** Manual GitHub Actions release matrix skeleton for sister-mode unsigned directory packages
**Environment:** Local workflow review; target workflow `.github/workflows/release-matrix.yml`
**Status:** Pass-with-caveats

## Executive summary

The repository now has a manual Gate D release matrix skeleton. It does not claim signed/notarized production installers are complete; it only encodes the target package jobs, sidecar build step, unsigned Electron directory package step, artifact upload, and optional macOS arm64 packaged smoke hook.

## Test environment + persona setup

- Persona: release engineer.
- Trigger: `workflow_dispatch` only.
- Default safety posture: `package_artifacts=false`, so the workflow documents the gate without running heavyweight packaging unless explicitly requested.
- Runner labels were checked against GitHub's hosted-runner reference, including `macos-14`, `macos-15-intel`, `ubuntu-24.04`, `ubuntu-24.04-arm`, and `windows-2022`: <https://docs.github.com/en/actions/reference/runners/github-hosted-runners>.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| GD-RM-01 | Manual trigger safety | Release engineer | Release matrix is not silently required on every push | Workflow uses `workflow_dispatch` only and `package_artifacts=false` by default | Pass |
| GD-RM-02 | Target matrix | Release engineer | Matrix covers macOS arm64, macOS Intel, Windows x64, Linux x64, and Linux arm64 | Matrix includes `darwin-arm64`, `darwin-x64`, `win32-x64`, `linux-x64`, and `linux-arm64` | Pass |
| GD-RM-03 | Sidecar packaging boundary | Release engineer | Sidecar builds before Electron packaging so `extraResources` has a binary to copy | Workflow runs `npm run build:sidecar` before `electron-builder --dir` | Pass |
| GD-RM-04 | Artifact retention | Release engineer | Each package job uploads an unsigned directory artifact | Workflow uploads `lyricue-sister-${{ matrix.target }}-unsigned-dir` | Pass |
| GD-RM-05 | Smoke hook | Release engineer | Packaged smoke can be run where supported without pretending every target is smoke-certified | `run_packaged_smoke=true` runs `npm -w @lyricue/sister run smoke:packaged` only on macOS arm64 | Pass |

## Defects surfaced + fixed

No new code defects were surfaced. This pass intentionally avoids marking external signing, notarization, fork-mode vendor SDK verification, and hardware/live-worship QA as complete.

## Network / data layer observations

- The workflow will download npm, pip, Electron, and ML packaging dependencies when manually enabled.
- The packaged smoke step is local-runtime only after dependencies and artifacts exist; it writes log/summary evidence through the package script added in the prior Gate D pass.
- No secrets are consumed by this skeleton. Signing/notarization requires a later workflow revision with explicit secret names and protected environments.

## Cumulative defect tally

| Pass | Defects | Critical | High | Medium | Low |
|---|---:|---:|---:|---:|---:|
| Gate D release matrix skeleton — 2026-06-06 | 0 | 0 | 0 | 0 | 0 |

## Recommendations before production shipping

1. **HIGH:** Add protected signing/notarization steps only after certificate secrets and Apple/Windows account credentials are available.
2. **HIGH:** Run this workflow on the real repository and retain artifacts before declaring Gate D complete.
3. **MEDIUM:** Add fork-mode packaging only after FreeShow native vendor SDK prerequisites are installed and documented on the runner.

## Final verdict

The release matrix skeleton is ready as a manual, unsigned packaging harness. It advances Gate D local readiness, but production release remains blocked on signing/notarization, real hosted artifact runs, fork-mode vendor SDK verification, and live hardware QA.
