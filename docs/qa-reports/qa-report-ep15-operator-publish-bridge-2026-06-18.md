# EP-15 Operator Publish Bridge QA Report — 2026-06-18
**QA persona:** Senior QA analyst — Electron smoke + network/IPC boundary + evidence capture
**Scope:** Sister-mode operator Publish button, LibraryPublishDialog host mounting, publish IPC sender validation, and packaged-smoke evidence contract.
**Environment:** Local macOS dev; sister E2E mode with synthetic audio; temporary user-data and evidence directories.
**Status:** Pass-with-caveats

## Executive summary
The operator Publish button no longer routes to a silent main-process no-op. It now opens the LibraryPublishDialog in the sister operator window, hydrates the selected song title, and fails closed when no publish credential exists. No new local defects were found; production publishing still requires real Cloudflare Worker/R2/KV credentials and a bundle/project metadata source.

## Test environment + persona setup
- Pass: Repository TypeScript build completed with the documented `env -i` Node wrapper.
- Pass: Sister renderer/main/preload build completed.
- Pass: Electron launched in `LC_E2E_MODE=1` with synthetic audio and dual windows.
- Pass: Default anonymous local persona loaded from fresh temporary user data.
- Pass: Default library config loaded with no publish credential; publish action was disabled.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP15-PUB-001 | Operator Publish button | Anonymous local operator | Opens publish dialog instead of no-op command | Dialog opened from `[data-testid="publish-song"]` | Pass |
| EP15-PUB-002 | Publish dialog hydration | Anonymous local operator | Title reflects selected setlist item | Dialog title field contained `Walking-Skeleton Reprise` | Pass |
| EP15-PUB-003 | Credential gate | Anonymous local operator | Missing credential blocks publish | Button disabled with explicit missing central credential message | Pass |
| EP15-PUB-004 | Smoke evidence contract | Release verifier | Parser requires publish screenshot evidence | `packaged-smoke-summary.test.ts` passes with publish screenshot required | Pass |
| EP15-PUB-005 | Dual-window E2E smoke | Live operator | Sync pipeline and operator tools remain functional | Smoke completed with `09-publish-dialog-operator.png` captured | Pass |

## Defects surfaced + fixed
None in this pass.

Carry-forward caveat: project/song publishing is not production-certified until a deployed Worker, real safe-storage credential, bundle exporter, and project-plan metadata source are exercised.

## Network / data layer observations
- IPC: renderer uses a new `lyricue:operator:library:publish` invoke channel; main validates `event.sender` against the operator window before reading identity/config or revealing credentials.
- Privacy: raw publish credentials remain main-process only and are revealed through Electron `safeStorage` only inside the publish handler.
- Data layer: fresh `library-config.json` and `identity.json` were loaded from defaults in temporary user data; no repository evidence files were mutated.
- Console: Electron smoke completed without smoke failures. Known diagnostic frame logs and sidecar startup/shutdown logs were observed.

## Cumulative defect tally (if multi-pass)
| Pass | Critical | High | Medium | Low | Info |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2026-06-18 EP-15 operator publish bridge | 0 | 0 | 0 | 0 | 0 |

## Recommendations before production shipping
1. **HIGH:** Run Gate C against a deployed Cloudflare Worker/R2/KV setup with a real publish credential and verify central and campus publish paths.
2. **HIGH:** Wire sister host song publishing to the production bundle exporter before enabling the song Publish button for credentialed installs.
3. **MEDIUM:** Load a production project with `songId` and `bundleVersion` metadata in sister mode and verify project-plan publish to `/publish/project`.

## Final verdict
The local operator integration defect is closed: Publish is now a visible, testable, fail-closed operator flow rather than a no-op. This is locally shippable as a guarded UI path, but cloud publishing itself remains gated by external infrastructure and exporter wiring.
