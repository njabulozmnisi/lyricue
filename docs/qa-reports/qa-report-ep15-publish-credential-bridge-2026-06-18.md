# EP-15 Publish Credential Bridge QA Report — 2026-06-18
**QA persona:** Senior QA analyst — IPC boundary + safe-storage privacy + Electron smoke
**Scope:** Sister-mode Settings Library credential management, preload/main credential IPC, safe-storage persistence, and smoke evidence contract.
**Environment:** Local macOS dev; sister E2E mode with synthetic audio; temporary user-data and evidence directories.
**Status:** Pass-with-caveats

## Executive summary
The sister operator can now configure and clear a publish credential through the Settings Library section. The raw credential crosses only from the isolated renderer to main during the configure call, is stored through Electron `safeStorage`, and is not returned or persisted in plaintext. No local defects were surfaced; packaged-host credential proof with a real Cloudflare token remains a Gate C release item.

## Test environment + persona setup
- Pass: TypeScript build completed with the documented `env -i` Node wrapper.
- Pass: Focused settings, credential helper, and packaged-smoke parser tests passed.
- Pass: Sister renderer/main/preload build completed.
- Pass: Electron launched in `LC_E2E_MODE=1`; synthetic audio drove the SyncEngine and karaoke output.
- Pass: Fresh temporary user data was used so credential storage and cleanup did not touch the operator's real profile.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP15-CRED-001 | Settings event bridge | Library publisher | Library Add/Manage events reach the sister renderer | SettingsTab forwards `credential-manage` to the renderer host | Pass |
| EP15-CRED-002 | Credential configure IPC | Library publisher | Main stores credential through safeStorage and returns only a SecretRef config | Electron smoke returned `credential-bridge-secure` | Pass |
| EP15-CRED-003 | Plaintext privacy boundary | Library publisher | Saved/returned config must not include the raw credential | Smoke checked JSON for the dummy secret and found no leak | Pass |
| EP15-CRED-004 | Credential clear IPC | Library publisher | Main removes publishCredential from LibraryConfig | Smoke configured then cleared the dummy credential | Pass |
| EP15-CRED-005 | Smoke evidence contract | Release verifier | Packaged-smoke parser fails if credential bridge proof is missing | Parser test now requires `credential-bridge-secure` | Pass |
| EP15-CRED-006 | Dual-window E2E smoke | Live operator | Existing operator tools still pass after credential wiring | Smoke completed with no failures | Pass |

## Defects surfaced + fixed
None in this pass.

Carry-forward caveat: this proves the local safe-storage boundary with a dummy credential in source-mode Electron. Production proof still requires the packaged host and a real Cloudflare Worker credential.

## Network / data layer observations
- IPC: new configure/clear channels validate `event.sender` against the operator window before touching credential state.
- Privacy: plaintext is accepted only in the configure request and is never written into `library-config.json`.
- Data layer: the smoke configured a dummy credential, verified a `secretRef.handle`, then cleared it from the temporary profile.
- Network: no external Worker request was made in this pass.

## Cumulative defect tally (if multi-pass)
| Pass | Critical | High | Medium | Low | Info |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2026-06-18 EP-15 publish credential bridge | 0 | 0 | 0 | 0 | 0 |

## Recommendations before production shipping
1. **HIGH:** Repeat credential configure, app restart, credential reveal, and publish against a packaged app with a real Cloudflare credential.
2. **HIGH:** Verify credential clear in the packaged app removes publish access before running a second publish attempt.
3. **MEDIUM:** Replace the transient prompt flow with a dedicated credential dialog before non-technical operators configure credentials themselves.

## Final verdict
The local credential bridge is production-shaped: main owns safe-storage and the renderer never receives stored plaintext. Gate C still needs a packaged-host and deployed-Worker proof pass before calling publishing production-certified.
