# EP-15 Credential Dialog Smoke QA Report — 2026-06-18
**QA persona:** Senior QA analyst — Electron smoke + screenshot evidence + parser gate verification
**Scope:** Sister-mode operator smoke harness coverage for the EP-15 publish credential dialog nested under Settings > Library.
**Environment:** Local development; macOS arm64; sister-mode Electron app; isolated `LC_USER_DATA_DIR` and `LC_CAPTURE_EVIDENCE_DIR`.
**Status:** Pass-with-caveats

## Executive summary
The Electron smoke harness now opens Settings, selects the Library tab, enables the shared-library section when needed, opens the Publish Credential dialog, and captures `11-publish-credential-dialog-operator.png`.

Two integration-only defects were surfaced and fixed in the smoke driver: the Library section is hidden behind a tab, and the credential action is hidden until library sharing is enabled. No critical or high defects remain in this local path.

## Test environment + persona setup
- PASS: Focused TypeScript build passed with `npx tsc -b`.
- PASS: Focused Vitest passed: `apps/sister/src/packaged-smoke-summary.test.ts`, `packages/ui/src/SettingsTab/SettingsTab.test.ts`, `packages/ui/src/PublishCredentialDialog.test.ts`.
- PASS: Sister renderer/main/preload build passed.
- PASS: Electron sister-mode smoke passed with `LC_E2E_MODE=1`, `LC_SMOKE_TEST=1`, `LC_CAPTURE_EVIDENCE=1`, and isolated user-data/evidence directories.
- PASS: Visual artifact reviewed at `/tmp/lyricue-credential-dialog-smoke-evidence-a1q54r/screenshots/operator/11-publish-credential-dialog-operator.png`.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| TC-EP15-CDS-001 | Packaged-smoke summary gate | Release engineer | Smoke summary fails if the credential dialog screenshot is missing | Parser now requires `11-publish-credential-dialog-operator.png` and has a missing-artifact regression test | PASS |
| TC-EP15-CDS-002 | Settings Library path | Operator | Smoke can reach the credential action from default Settings state | First run failed while Display tab was active; fixed by selecting the Library tab | PASS |
| TC-EP15-CDS-003 | Shared-library precondition | Operator | Smoke can reach Add/Manage from default library config | First run failed because library sharing was disabled; fixed by toggling the library section before opening Add | PASS |
| TC-EP15-CDS-004 | Visual evidence | Operator | Dialog is visible, non-overlapping, and not duplicate-titled | Screenshot captured and duplicate inner heading was removed | PASS |
| TC-EP15-CDS-005 | Full sister smoke | Operator | Dual-window smoke completes without smoke failures | Smoke completed with `[smoke] complete: pass` | PASS |

## Defects surfaced + fixed
- D-EP15-CDS-001, **MEDIUM**: Credential dialog smoke initially failed with `missing-credential-button`. Root cause: Settings opens on Display, while the credential action lives under the Library tab. Latency: introduced by adding nested credential UI after earlier smoke coverage only captured top-level overlays. Fix: select the Library tab before looking for the credential action in `apps/sister/src/main.ts`. Verification: Electron smoke captured `11-publish-credential-dialog-operator.png`.
- D-EP15-CDS-002, **MEDIUM**: Credential dialog smoke then failed with `missing-library-toggle`. Root cause: default `LibraryConfig.enabled` is false, so the Add/Manage action is intentionally hidden. Latency: the unit test covered the dialog directly but not the operator path from default Settings state. Fix: toggle “Use a shared LyriCue library” in the smoke driver before opening Add when needed. Verification: Electron smoke completed with `[smoke] complete: pass`.
- D-EP15-CDS-003, **LOW**: Visual screenshot showed duplicate “Publish Credential” headings. Root cause: the overlay shell and the component both rendered visible titles. Fix: keep the overlay title and remove the component’s visible `h2` while preserving `aria-label`. Verification: final screenshot reviewed.

## Network / data layer observations
- No external network calls were required.
- Smoke still runs the safe-storage credential bridge separately and returned `credential-bridge-secure`.
- Screenshot evidence is pass-specific through `LC_CAPTURE_EVIDENCE_DIR`; historical evidence is not overwritten.

## Cumulative defect tally (if multi-pass)
| Pass | Critical | High | Medium | Low | Info |
|---|---:|---:|---:|---:|---:|
| EP-15 credential bridge | 0 | 0 | 1 fixed | 0 | 0 |
| EP-15 credential dialog | 0 | 0 | 1 fixed | 0 | 0 |
| EP-15 credential dialog smoke | 0 | 0 | 2 fixed | 1 fixed | 0 |

## Recommendations before production shipping
1. **HIGH**: Run the packaged smoke summary parser against real release-job logs so missing credential-dialog screenshots fail release validation.
2. **HIGH**: Repeat the credential dialog flow in a signed packaged app with real Cloudflare Worker credentials.
3. **MEDIUM**: Keep the nested Settings path in smoke coverage because direct component tests cannot catch hidden-tab or disabled-section integration defects.

## Final verdict
The local operator path for publish credential management is now smoke-proven, not just component-proven. Production certification still depends on packaged safe-storage and real Worker credential verification.
