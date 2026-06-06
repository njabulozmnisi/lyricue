# EP19 Translation Editor Refresh QA Report — 2026-06-06
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP-19 operator translation editor draft hydration, parallel-lyrics persistence shaping, and mounted sister-mode translation save contract.
**Environment:** Local dev workspace at `/Users/njabulomnisi/Projects/Dojo/worshipsync`; component/core verification with Node 25 via the required isolated shell wrapper.
**Status:** Pass-with-caveats

## Executive summary

The EP-19 operator translation editor now refreshes its editable draft when the active timing map changes and core persistence normalizes translation tracks to the current map sections. One **HIGH** data-loss defect was surfaced and fixed in this pass. No **CRITICAL** defects were found.

The remaining EP-19 caveat is unchanged: translated-primary karaoke still needs a learned timing map for each primary language rather than only translated display text over the original timing map.

## Test environment + persona setup

- Pass: Repository workspace was local `main`; only current EP-19 hardening changes and ignored `.claude/` were present.
- Pass: Node commands used the documented `env -i` Node 25 wrapper.
- Pass: No API, DB, migrations, Redis, MinIO, mail, or external worker services are in scope for this local operator component/core pass.
- Pass: Persona was the live tech operator editing a parallel-language lyric track from the sister-mode operator window.
- Pass: Seed/literal drift is not applicable; language values are free-form BCP-47-style strings and section IDs come from the active `TimingMap`.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP19-TC-01 | Parallel lyrics draft | Tech operator | Draft creation preserves existing translation text for current timing-map sections. | `createParallelLyricsDraft` preserved existing `zu-ZA` text for section `v1`. | Pass |
| EP19-TC-02 | Translation save normalization | Tech operator | Saving a track drops stale section IDs and adds missing current sections as empty strings. | `normalizeParallelLyricsTrack` returned only current sections in timing-map order. | Pass |
| EP19-TC-03 | Translation editor happy path | Tech operator | Operator can edit translated section text and save it onto the active map. | `TranslationEditor.test.ts` saved the entered `zu-ZA` text into the map parallel track. | Pass |
| EP19-TC-04 | Form hydration round-trip | Tech operator | When the active timing map changes while the editor is mounted, the form shows the new map's original and translated values. | The editor replaced the stale Verse 1 textarea with the Chorus textarea and hydrated the existing Chorus translation. | Pass |
| EP19-TC-05 | Stale draft persistence guard | Tech operator | Save after a timing-map swap cannot write stale old-song section IDs into the new song. | Save returned `show-2` with only section `c1`; stale section `v1` was not persisted. | Pass |

## Defects surfaced + fixed

**D34 — HIGH — Translation editor could save stale section drafts after active song changes**  
Symptom: `TranslationEditor.svelte` initialized its draft from `timingMap` but only refreshed when `language` changed. If the editor stayed mounted and the active timing map changed, the visible section list came from the new map while the draft still came from the old map.  
Root cause: The reactive guard in [TranslationEditor.svelte](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/ui/src/TranslationEditor.svelte:12) compared only `draft.language` to `language`, and `upsertParallelLyricsTrack` in [parallel-lyrics.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/translations/parallel-lyrics.ts:24) accepted caller-provided section IDs without normalizing them to the current timing map.  
Latency: Introduced when the translation editor became a mounted operator overlay. Pure helper tests and the original happy-path component test did not simulate a timing-map prop replacement while the editor remained mounted.  
Repro steps: Open the translation editor for one song, type an unsaved translation, switch the active timing map without destroying the editor, then save. The previous code could persist old-song section IDs against the new map.  
Evidence: Regression tests now cover stale draft replacement in [TranslationEditor.test.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/ui/src/TranslationEditor.test.ts:85) and section normalization in [parallel-lyrics.test.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/translations/parallel-lyrics.test.ts:83). Focused verification passed: `parallel-lyrics.test.ts` 4/4 and `TranslationEditor.test.ts` 2/2. Full local verification passed: `tsc -b`, root Vitest 739/739, Python sidecar 88 passed/1 skipped, Python sidecar ML 88 passed/1 skipped, `svelte-check` 0 errors/warnings, and Worker Vitest 11/11.  
Fix proposal: Refresh the editor draft whenever either `timingMap` or `language` changes, and normalize saved tracks through the active timing map before upsert.  
Fix status: Fixed and verified locally in this change.

## Network / data layer observations

- Network: No network calls are made by the shared translation editor or parallel-lyrics helpers.
- IPC: The mounted sister-mode operator save path sends `saveTranslation` through the existing operator command bridge; this pass did not change channel names or sender validation.
- Data layer: Translation saves are now shaped by the active `TimingMap.sections`, preventing orphan parallel-lyrics section IDs before the map is passed to disk persistence.
- Console: Focused jsdom component tests emitted no unexpected console errors.

## Cumulative defect tally (if multi-pass)

| Pass | Defects | Critical | High | Medium | Low | Fixed in pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| EP19 translation editor refresh — 2026-06-06 | 1 | 0 | 1 | 0 | 0 | 1 |

## Recommendations before production shipping

1. **HIGH:** Add an Electron smoke assertion that opens the translation editor, switches the active setlist song, and verifies the save payload uses only the new song's section IDs.
2. **MEDIUM:** Add translated-primary timing-map learning for each selected primary language before treating EP-19 as production-complete.
3. **LOW:** Add a fixture with multiple translated sections and a missing translation row to keep normalization behavior pinned across future editor changes.

## Final verdict

EP-19's mounted translation editor is safer after this pass: the main local data-loss risk in the current operator overlay is fixed and pinned at the core and component layers. The epic remains short of full production readiness until translated-primary timing maps are learned and verified end to end.
