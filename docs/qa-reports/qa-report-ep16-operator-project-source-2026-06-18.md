# EP-16 Operator Project Source QA Report — 2026-06-18
**QA persona:** Senior QA analyst — Electron smoke + IPC boundary + data-loader integration
**Scope:** Sister-mode operator Setlist Source access, project-source IPC bridge, central-plan load path, and smoke evidence contract.
**Environment:** Local macOS dev; sister E2E mode with synthetic audio; temporary user-data and evidence directories.
**Status:** Pass-with-caveats

## Executive summary
The ProjectSourcePicker is now reachable from the live operator window. The sister host exposes guarded IPC for project sources, local project selection, and central project-plan loading through the existing library manager. No local defects were surfaced; deployed Cloudflare and two-install subscribe/publish proof remain external release gates.

## Test environment + persona setup
- Pass: TypeScript build completed with the documented `env -i` Node wrapper.
- Pass: Focused UI/parser tests passed.
- Pass: Sister renderer/main/preload build completed.
- Pass: Electron launched in `LC_E2E_MODE=1`; synthetic audio drove the SyncEngine and karaoke output.
- Pass: Fresh local persona and default library config were loaded from temporary user data.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP16-SRC-001 | Operator access | Live operator | Setlist Source opens from primary operator controls | `[data-testid="open-project-source"]` opened the picker | Pass |
| EP16-SRC-002 | Default library state | Anonymous local operator | No central plans are listed without configured library URL | Picker showed `No central projects available.` | Pass |
| EP16-SRC-003 | Local project source | Anonymous local operator | Active local project is available through host source bridge | Host returned the persisted/default active project | Pass |
| EP16-SRC-004 | Central loader contract | Library-connected operator | Central plans load through catalog + bundle import path | Main-process handler uses `fetchCatalog()` + `loadProjectPlanBundles()` | Pass |
| EP16-SRC-005 | Smoke evidence contract | Release verifier | Smoke parser requires source-picker screenshot evidence | `packaged-smoke-summary.test.ts` now fails without `10-project-source-picker-operator.png` | Pass |
| EP16-SRC-006 | Dual-window E2E smoke | Live operator | Existing sync pipeline and operator tools still pass | Smoke completed with source-picker screenshot captured | Pass |

## Defects surfaced + fixed
None in this pass.

Carry-forward caveat: central project loading is locally wired, but production proof still requires a real Worker/R2 catalog, real `.lcbundle` objects, and a second install consuming the published plan.

## Network / data layer observations
- IPC: new project-source channels validate `event.sender` against the operator window before reading project/library state or loading plans.
- Data layer: local project selection normalizes project payloads before saving them through `ProjectStorage`.
- Central path: when configured, the host lists central plans, fetches the catalog with mirror fallback, imports missing bundles, persists timing maps and arrangements, saves the resulting project, and reloads the setlist controller.
- Console: Electron smoke completed with no smoke failures. Known diagnostic frame logs and sidecar lifecycle logs were observed.

## Cumulative defect tally (if multi-pass)
| Pass | Critical | High | Medium | Low | Info |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2026-06-18 EP-16 operator project source | 0 | 0 | 0 | 0 | 0 |

## Recommendations before production shipping
1. **HIGH:** Run the central plan path against deployed Cloudflare Worker/R2/KV data with real signed bundles.
2. **HIGH:** Execute a two-install flow: publish project on install A, load central project on install B, then verify timing maps, arrangements, and setlist source metadata.
3. **MEDIUM:** Replace the build-new placeholder with a real local project builder once local setlist authoring is in scope.

## Final verdict
EP-16 is stronger locally: the project-source component is no longer isolated from the operator host, and the central-plan loader is connected to the production library manager path. It is not production-certified until the same path is exercised against deployed library infrastructure.
