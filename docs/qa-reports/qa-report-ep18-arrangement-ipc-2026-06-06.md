# EP18 Arrangement IPC QA Report — 2026-06-06
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP-18 sister-mode operator `saveArrangement` IPC boundary, section normalization, unknown-show rejection, and disk-persistence guard.
**Environment:** Local dev workspace at `/Users/njabulomnisi/Projects/Dojo/worshipsync`; pure sister-main helper verification with Node 25 via the required isolated shell wrapper.
**Status:** Pass-with-caveats

## Executive summary

The sister main process now validates and normalizes arrangement save payloads after IPC validation and before mutating in-memory arrangement state or writing to disk. One **HIGH** IPC-boundary data-integrity defect was surfaced and fixed. No **CRITICAL** defects were found.

The remaining EP-18 caveat is unchanged: real FreeShow REST layout writeback still needs validation against a live FreeShow instance.

## Test environment + persona setup

- Pass: Repository workspace was local `main`; only current EP-18 IPC hardening changes and ignored `.claude/` were present.
- Pass: Node commands used the documented `env -i` Node 25 wrapper.
- Pass: No API, DB, migrations, Redis, MinIO, mail, or external worker services are in scope for this pure IPC-boundary helper pass.
- Pass: Persona was the sister-mode main process receiving operator arrangement save commands from the renderer.
- Pass: IPC/channel drift check: existing `saveArrangement` command kind is unchanged; the payload preparation happens behind the same main-process command handler.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP18-IPC-01 | Stale section filtering | Sister main process | A save payload with stale and current section IDs persists only current IDs. | `prepareOperatorArrangementSave` returned a valid arrangement with only `c1`. | Pass |
| EP18-IPC-02 | Unknown show rejection | Sister main process | A save payload for a show with no active timing map is rejected before persistence. | Helper returned `unknown showId=missing`. | Pass |
| EP18-IPC-03 | All-stale rejection | Sister main process | A save payload whose sequence has no current-map sections is rejected. | Helper returned `arrangement "default" has no sections in active timing map`. | Pass |
| EP18-IPC-04 | Main-process wiring | Sister main process | `saveDemoArrangement` uses the same preparation helper before state mutation and disk save. | [main.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/apps/sister/src/main.ts:804) now calls `prepareOperatorArrangementSave`. | Pass |

## Defects surfaced + fixed

**D37 — HIGH — Main process trusted renderer arrangement section IDs after IPC validation**  
Symptom: The renderer-side arrangement builder now filters stale section IDs, but `saveDemoArrangement` still accepted any schema-valid arrangement sequence sent over IPC. A stale or malformed renderer payload could persist an arrangement referencing sections absent from the active timing map, causing later layout projection or live arrangement playback to fail.  
Root cause: `validateArrangement` checks shape only; it cannot know whether `sequence[].sectionId` exists in the active `TimingMap`. The main process previously moved directly from shape validation to `DEMO_ARRANGEMENTS` mutation and `TimingMapStorage.saveArrangements`.  
Latency: Present since operator arrangement persistence was mounted. Component tests caught renderer behavior, but no test covered the IPC boundary as a separate trust boundary.  
Repro steps: Send `saveArrangement` with a valid arrangement object for `show-1` whose sequence includes `{ sectionId: "stale" }`; previous main-process code accepted it if the show ID existed.  
Evidence: The new helper is covered in [operator-arrangements.test.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/apps/sister/src/operator-arrangements.test.ts:37), and `saveDemoArrangement` now calls it from [main.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/apps/sister/src/main.ts:804). Focused verification passed: `tsc -b` and `operator-arrangements.test.ts` 3/3. Full local verification passed: `tsc -b`, root Vitest 749/749, Python sidecar 88 passed/1 skipped, Python sidecar ML 88 passed/1 skipped, `svelte-check` 0 errors/warnings, and Worker Vitest 11/11.  
Fix proposal: Add a pure IPC preparation helper that validates arrangement shape, resolves the active timing map, filters section IDs to current map sections, rejects empty normalized sequences, and returns the normalized arrangement to the main process.  
Fix status: Fixed and verified locally in this change.

## Network / data layer observations

- Network: No network calls are made by this IPC boundary.
- IPC: The command channel and command kind did not change; only server-side payload preparation was added.
- Data layer: Bad arrangement sequences are now rejected before `TimingMapStorage.saveArrangements`, preventing invalid arrangement JSON from reaching disk.
- Console: Focused tests emitted no unexpected console errors.

## Cumulative defect tally (if multi-pass)

| Pass | Defects | Critical | High | Medium | Low | Fixed in pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| EP18 local QA — 2026-05-18 | 1 | 0 | 0 | 1 | 0 | 1 |
| EP18 arrangement builder refresh — 2026-06-06 | 1 | 0 | 1 | 0 | 0 | 1 |
| EP18 arrangement IPC — 2026-06-06 | 1 | 0 | 1 | 0 | 0 | 1 |

## Recommendations before production shipping

1. **HIGH:** Extend the Electron smoke harness to send a stale `saveArrangement` payload and assert the main process rejects it without writing arrangement JSON.
2. **MEDIUM:** Validate real FreeShow REST layout writeback once the sister-mode FreeShow control boundary is available.
3. **LOW:** Mirror this IPC-boundary pattern for any future renderer-originated persistence commands that reference timing-map section IDs.

## Final verdict

The EP-18 arrangement save boundary is safer after this pass: renderer-side normalization is no longer the only defense, and the main process rejects stale or unknown arrangement payloads before persistence. The epic remains externally gated on real FreeShow layout writeback.
