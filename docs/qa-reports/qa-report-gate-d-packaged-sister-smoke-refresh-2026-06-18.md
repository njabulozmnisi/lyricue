# Gate D Packaged Sister-App Smoke Refresh QA Report — 2026-06-18
**QA persona:** Senior QA analyst — packaged runtime + Electron smoke + release evidence path verification
**Scope:** Fresh macOS arm64 sister-mode directory package after EP-15 credential-dialog smoke hardening. This pass verifies the packaged app includes the stricter operator screenshot gate and still launches the bundled sidecar from packaged resources.
**Environment:** Local macOS arm64 directory package at `apps/sister/release/mac-arm64/LyriCue.app`; evidence under `docs/qa-reports/evidence/gate-d-packaged-sister-smoke-2026-06-18`.
**Status:** Pass-with-caveats

## Executive summary
The refreshed packaged sister smoke passes locally. The packaged app loaded from `Contents/Resources/app.asar`, captured all required karaoke/operator screenshots including `11-publish-credential-dialog-operator.png`, exercised operator persistence/settings/credential/stale-payload guards, and reached packaged sidecar rehearsal segmentation.

One **MEDIUM** release-script defect was surfaced and fixed: relative `--output-dir docs/...` paths were resolving under `apps/sister/docs/...` when invoked through the npm workspace script.

## Test environment + persona setup
- PASS: Rebuilt unsigned/ad-hoc macOS arm64 package with `cd apps/sister && npx electron-builder --dir --mac`.
- PASS: Packaged app executable found at `apps/sister/release/mac-arm64/LyriCue.app/Contents/MacOS/LyriCue`.
- PASS: Packaged smoke command completed with status pass.
- PASS: Summary JSON retained at `docs/qa-reports/evidence/gate-d-packaged-sister-smoke-2026-06-18/packaged-sister-smoke-2026-06-18T14-24-00-956Z.json`.
- PASS: Screenshot evidence retained under `docs/qa-reports/evidence/gate-d-packaged-sister-smoke-2026-06-18/screenshots`.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| TC-GD-REFRESH-001 | Directory package build | Release engineer | Electron Builder produces a macOS arm64 `.app` with bundled resources | `electron-builder --dir --mac` completed with ad-hoc signing and skipped notarization | PASS |
| TC-GD-REFRESH-002 | Packaged app boundary | Operator | Renderer assets load from `Contents/Resources/app.asar` | Smoke summary `packagedAppLoaded=true` | PASS |
| TC-GD-REFRESH-003 | Operator screenshot gate | Operator | Settings, Publish, Setlist Source, and Publish Credential screenshots are captured | Summary has all operator screenshot booleans true, including `operatorCredentialDialogCaptured=true` | PASS |
| TC-GD-REFRESH-004 | Safe-storage bridge smoke | Operator | Credential bridge runs and plaintext does not persist into config JSON | Summary `operatorCredentialBridgePassed=true` | PASS |
| TC-GD-REFRESH-005 | Bundled sidecar boundary | Operator | Rehearsal segmentation starts the packaged sidecar, not source Python | Summary `sidecarStarted=true`, `segmentationReady=true`, `sourcePythonFallback=false` | PASS |
| TC-GD-REFRESH-006 | Evidence output path | Release engineer | Relative `--output-dir docs/...` writes under repo-root `docs/...` | Fixed script and rerun wrote JSON/screenshots under `/Users/njabulomnisi/Projects/Dojo/worshipsync/docs/...` | PASS |

## Defects surfaced + fixed
- D-GD-REFRESH-001, **MEDIUM**: Packaged smoke evidence initially wrote to `apps/sister/docs/qa-reports/...` when invoked with `npm -w @lyricue/sister run smoke:packaged -- --output-dir docs/...`. Root cause: `apps/sister/scripts/smoke-packaged-sister.ts` resolved relative `--output-dir` against the npm workspace process cwd instead of the repository root. Latency: present since the packaged smoke script was added; previous default output path used `repoRoot`, so the defect only appeared with an explicit relative path. Fix: resolve relative `--output-dir` against `repoRoot`. Verification: rerun wrote summary/screenshots under repo-root `docs/qa-reports/evidence/gate-d-packaged-sister-smoke-2026-06-18`.

## Network / data layer observations
- Runtime used local packaged files and the local packaged sidecar. No external publish/library calls were required.
- The onefile sidecar cold start remained slow, but the packaged renderer stayed responsive with diagnostics around mid-50s fps and `dropped=0`.
- The smoke wrote rehearsal audio under the packaged app support directory and approved the matched segment through operator IPC.

## Cumulative defect tally (if multi-pass)
| Pass | Critical | High | Medium | Low | Info |
|---|---:|---:|---:|---:|---:|
| Gate D packaged sister smoke — 2026-06-06 | 0 | 1 fixed | 2 fixed | 0 | 0 |
| Gate D packaged sister smoke refresh — 2026-06-18 | 0 | 0 | 1 fixed | 0 | 0 |

## Recommendations before production shipping
1. **HIGH**: Run this packaged smoke on each release-matrix platform and retain JSON plus screenshots per artifact.
2. **HIGH**: Add signing/notarization and rerun the same smoke on signed macOS and Windows artifacts.
3. **MEDIUM**: Continue tracking onefile sidecar cold-start duration before rollout; this pass remained stable, but startup dominated the smoke runtime.

## Final verdict
Local macOS arm64 Gate D packaged sister smoke remains pass-with-caveats after the EP-15 credential-dialog smoke hardening. The local package is not production-certified because signing, notarization, cross-platform artifacts, and fork-mode vendor SDK verification are still external gates.
