# EP-15 Song Publish Exporter QA Report — 2026-06-18
**QA persona:** Senior QA analyst — bundle contract + IPC boundary + Electron smoke
**Scope:** Sister-mode active-song publish path from operator dialog to `.lcbundle` export and Worker publish call preparation.
**Environment:** Local macOS dev; sister E2E mode with synthetic audio; temporary user-data and evidence directories.
**Status:** Pass-with-caveats

## Executive summary
The sister host no longer blocks song publish mode at the exporter boundary. It now exports the active learned song through the core ZIP `.lcbundle` exporter, preserves bundle metadata on the active project, and sends the bundle bytes through the existing Worker publish API once a real credential is configured. No local defects were surfaced; real Cloudflare/safe-storage publish proof remains an external Gate C item.

## Test environment + persona setup
- Pass: TypeScript build completed with the documented `env -i` Node wrapper.
- Pass: Focused publish helper and publish-dialog tests passed.
- Pass: Sister renderer/main/preload build completed.
- Pass: Electron launched in `LC_E2E_MODE=1`; synthetic audio drove the SyncEngine and karaoke output.
- Pass: Default anonymous persona and no-credential library config loaded from temporary user data, keeping the UI fail-closed.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP15-SONG-001 | Active song bundle export | Library publisher | Active learned song exports to a valid ZIP `.lcbundle` | `readBundle()` accepted exported bytes and manifest metadata | Pass |
| EP15-SONG-002 | Project metadata hydration | Library publisher | Published song gets `songId` and `bundleVersion` on the active project | Helper annotates the matching show ref after export | Pass |
| EP15-SONG-003 | Stale timing-map guard | Library publisher | Mismatched active show/timing map is rejected before export | Helper throws before bundle creation | Pass |
| EP15-SONG-004 | Operator publish dialog | Anonymous local operator | No credential still blocks publish UI | Smoke captured publish dialog with disabled publish action | Pass |
| EP15-SONG-005 | Dual-window E2E smoke | Live operator | Existing sync/operator tools still pass after publish wiring | Smoke completed with no failures | Pass |

## Defects surfaced + fixed
None in this pass.

Carry-forward caveat: the host path is wired, but production proof still requires a real Worker URL, a real Electron safe-storage credential, and a deployed R2/KV Worker accepting the upload.

## Network / data layer observations
- IPC: renderer sends the local `showId`; main derives or reuses library `songId` separately so show IDs do not drift into catalog IDs accidentally.
- Data layer: successful publish preparation updates and saves the active `Project` with `songId` and `bundleVersion`, enabling later project-plan publishes to reference the bundle.
- Privacy: raw credentials remain main-process only and are revealed through Electron `safeStorage` only inside the publish handler.
- Network: no external network was called in the default no-credential smoke path.

## Cumulative defect tally (if multi-pass)
| Pass | Critical | High | Medium | Low | Info |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2026-06-18 EP-15 song publish exporter | 0 | 0 | 0 | 0 | 0 |

## Recommendations before production shipping
1. **HIGH:** Run a deployed Worker publish with a real safe-storage credential and verify `catalog.json`, bundle URL, and audit log entries.
2. **HIGH:** Reopen the operator Publish dialog after a successful deployed publish and verify the resulting project-plan publish uses the saved bundle metadata.
3. **MEDIUM:** Add a packaged-host credential setup smoke once the final operator credential-management UI is available.

## Final verdict
The local code path for song publishing is now materially complete: active learned songs can be exported and handed to the Worker publish API without a placeholder stop. It remains externally gated on real Cloudflare and packaged credential proof before production certification.
