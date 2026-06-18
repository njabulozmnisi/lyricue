# EP-15 Publish Credential Dialog QA Report — 2026-06-18
**QA persona:** Senior QA analyst — component + IPC contract + Electron smoke verification
**Scope:** EP-15 operator publish credential management in the sister-mode operator window. This pass verifies the Settings Library credential action opens a real operator dialog, saves/clears through the existing safe-storage IPC bridge, and keeps raw credential material out of persisted library config JSON.
**Environment:** Local development; macOS arm64; sister-mode Electron app; isolated `LC_USER_DATA_DIR` and `LC_CAPTURE_EVIDENCE_DIR`.
**Status:** Pass-with-caveats

## Executive summary
The prompt-based credential flow has been replaced by a mounted Svelte operator dialog. Focused unit coverage and the Electron smoke bridge both pass, and the smoke still verifies raw dummy credentials do not appear in the returned/saved library config JSON.

No new critical or high defects surfaced. Production certification still requires a packaged build with real OS safe-storage and real Cloudflare Worker credentials.

## Test environment + persona setup
- PASS: Repository slice built with `npx tsc -b`.
- PASS: Focused Vitest coverage for `PublishCredentialDialog` and packaged smoke summary parsing passed.
- PASS: Sister renderer/main/preload build passed.
- PASS: Electron sister-mode smoke passed with `LC_E2E_MODE=1`, `LC_SMOKE_TEST=1`, `LC_CAPTURE_EVIDENCE=1`, and isolated user-data/evidence directories.
- PASS: Credential bridge smoke returned `credential-bridge-secure`.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| TC-EP15-CD-001 | Credential dialog save gate | Operator | Save remains disabled until label and credential are both non-empty | Component disabled Save initially, enabled after both inputs, and called `onSave` with trimmed key ID plus raw credential | PASS |
| TC-EP15-CD-002 | Existing credential clear | Operator | Existing credential shows a remove action and invokes clear callback | Component called `onClear` once and showed removed status | PASS |
| TC-EP15-CD-003 | Renderer build contract | Operator | New component imports through `@lyricue/ui` without pulling Node-only modules into Vite | `npm run build:sister` passed | PASS |
| TC-EP15-CD-004 | Safe-storage IPC contract | Operator | Configure/clear flows route through main process and persisted config excludes plaintext credential | Electron smoke returned `operator credential bridge result={"status":"credential-bridge-secure"}` | PASS |

## Defects surfaced + fixed
No new defects were surfaced in this pass.

Confirmed fixed locally:
- D-EP15-CD-001, **MEDIUM**: Credential management previously used blocking `window.prompt` / `window.confirm`, which is not a production-grade Electron operator surface and cannot provide clear state. Root cause was renderer-only prompt orchestration in `apps/sister/src/renderer/operator-window-bootstrap.ts`. Fixed by mounting `PublishCredentialDialog` and routing save/clear through the existing validated IPC bridge. Verification: component tests, sister build, Electron smoke credential bridge.

## Network / data layer observations
- No external network calls were required for this pass.
- The renderer never persists the raw credential itself; `configurePublishCredential` forwards it to main process and stores only the returned `LibraryConfig`.
- The smoke guard still inspects the persisted config shape and fails if the dummy secret leaks into JSON.

## Cumulative defect tally (if multi-pass)
| Pass | Critical | High | Medium | Low | Info |
|---|---:|---:|---:|---:|---:|
| EP-15 credential bridge | 0 | 0 | 1 fixed | 0 | 0 |
| EP-15 credential dialog | 0 | 0 | 1 fixed | 0 | 0 |

## Recommendations before production shipping
1. **HIGH**: Run the same credential configure/publish flow in a signed packaged app on the release machine to certify Electron `safeStorage` behavior outside development.
2. **HIGH**: Repeat with real Cloudflare Worker credentials and verify a song publish reaches R2/KV and the GitHub mirror without storing plaintext credentials locally.
3. **MEDIUM**: Add an operator screenshot capture for the credential dialog if this surface becomes a release-demo checkpoint.

## Final verdict
The local EP-15 credential-management UX is ready for the local MVP gate: it is no longer prompt-based, it is covered by focused component tests, and the end-to-end smoke still proves the safe-storage bridge contract. It is not yet production-certified until the external packaged safe-storage and real Worker credential flow are verified.
