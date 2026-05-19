# EP-12 Disk-Backed Setlist QA Report — 2026-05-19

**QA persona:** Senior QA analyst — storage boundary + setlist controller + local gate verification
**Scope:** Gate A EP-12 replacement of demo-only active project state with disk-backed local project storage.
**Environment:** Local dev, macOS arm64, Node 25 via isolated shell wrapper, Python sidecar venv.
**Status:** Pass

## Executive summary

EP-12 now has a disk-backed active project path for sister mode. The app loads the active project from user data, seeds the walking-skeleton project only when no local project exists, and appends newly learned timing maps into the active project before reloading the setlist controller. No defects were surfaced in this pass.

The main production caveat is scope: this is the local project store needed for Gate A, not FreeShow REST project ingestion or central library plan rollout.

## Test environment + persona setup

- Local repository: pass, branch `main`.
- Node/Electron shell isolation: pass, all Node commands used the documented `env -i` wrapper.
- Python sidecar environment: pass, `.venv/bin/pytest` completed successfully.
- Persona: operator launching sister mode with an active local project and learning additional songs mid-service.
- Persistence boundary: pass, project JSON and timing maps write through atomic storage paths.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| TC-E12-DS-001 | Empty project store | Operator | Missing active project file returns null rather than crashing. | `ProjectStorage.loadActiveProject()` returns null. | Pass |
| TC-E12-DS-002 | Active project save/load | Operator | Active project saves and reloads with canonical project shape. | Stored project reloaded with title, shows, artist, and local source. | Pass |
| TC-E12-DS-003 | Malformed project file | Operator | Bad stored project fails loudly instead of silently dropping items. | Malformed show refs throw validation errors. | Pass |
| TC-E12-DS-004 | Startup active project | Operator | Sister mode loads stored active project, with demo project as first-run fallback. | Main now calls `loadOperatorProject()` before setlist controller load. | Pass |
| TC-E12-DS-005 | Learned-song project append | Operator | A newly saved learned timing map is present in the active setlist. | `saveTimingMap` persists the map and appends missing `showId` to active project. | Pass |
| TC-E12-DS-006 | Full local gate | Developer/operator | Tests, type checks, Svelte diagnostics, and renderer bundles remain clean. | 700 TS tests, 77 Python tests, `tsc -b`, `svelte-check`, and both sister bundles passed. | Pass |

## Defects surfaced + fixed

None.

## Network / data layer observations

- No network calls are needed for the local active project path.
- Active project storage uses `writeFileAtomic`, preserving the crash-safe persistence invariant.
- Stored project JSON is normalized through the same Project shape used by REST/project-plan adapters.
- Timing map lookup now checks disk storage as well as the in-memory demo cache, so locally learned songs survive restart.

## Cumulative defect tally

| Pass | Critical | High | Medium | Low | Info |
| --- | ---: | ---: | ---: | ---: | ---: |
| EP-12 disk-backed setlist — 2026-05-19 | 0 | 0 | 0 | 0 | 0 |

## Recommendations before production shipping

1. **MEDIUM:** Add the Electron operator smoke harness to verify restart behavior: learn song, save timing map, relaunch with the same `LC_USER_DATA_DIR`, and confirm the song remains in the setlist.
2. **MEDIUM:** Keep FreeShow REST project ingestion as the next EP-12/EP-16 integration layer; the local project store is the durable fallback, not the final external project source.

## Final verdict

The local setlist state is no longer demo-only for Gate A. Active projects and newly learned songs persist to disk and reload through the existing setlist controller, so this slice is ready to commit.
