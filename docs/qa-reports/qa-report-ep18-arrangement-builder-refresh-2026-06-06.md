# EP18 Arrangement Builder Refresh QA Report — 2026-06-06
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP-18 operator arrangement builder hydration, same-ID arrangement updates, and current timing-map section persistence.
**Environment:** Local dev workspace at `/Users/njabulomnisi/Projects/Dojo/worshipsync`; component/core verification with Node 25 via the required isolated shell wrapper.
**Status:** Pass-with-caveats

## Executive summary

The mounted EP-18 arrangement builder now refreshes when the selected arrangement object changes and saves only section IDs that exist in the active timing map. One **HIGH** stale-state persistence defect was surfaced and fixed. No **CRITICAL** defects were found.

The remaining EP-18 caveat is external integration depth: real FreeShow REST layout writeback still needs verification once the sister-mode FreeShow control boundary is available.

## Test environment + persona setup

- Pass: Repository workspace was local `main`; only current EP-18 hardening changes and ignored `.claude/` were present.
- Pass: Node commands used the documented `env -i` Node 25 wrapper.
- Pass: No API, DB, migrations, Redis, MinIO, mail, or external worker services are in scope for this local operator component/core pass.
- Pass: Persona was the live tech operator editing and saving named song arrangements from the sister-mode operator window.
- Pass: Seed/literal drift is not applicable; section IDs come from the active `TimingMap`.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP18-TC-01 | Arrangement shorthand | Tech operator | Common tokens still map to current timing-map section IDs and unknown tokens remain visible. | Existing shorthand behavior continued passing. | Pass |
| EP18-TC-02 | Sequence editing | Tech operator | Reorder, duplicate, remove, and save preserve the expected named arrangement sequence. | Existing component happy path continued passing. | Pass |
| EP18-TC-03 | Current-section normalization | Tech operator | Missing section IDs are dropped before arrangement save/projection. | `normalizeArrangementSequence` returned only current map sections in order. | Pass |
| EP18-TC-04 | Same-ID arrangement update hydration | Tech operator | If the parent replaces the selected arrangement with the same ID and list count, the modal hydrates the new name and sequence. | The component updated from `Default`/`Verse 1` to `Updated Default`/`Chorus`. | Pass |
| EP18-TC-05 | Stale section persistence guard | Tech operator | Saving against a changed timing map cannot persist old-song section IDs. | Save returned `show-2` with only section `chorus2`; stale section `verse1` was filtered. | Pass |

## Defects surfaced + fixed

**D35 — HIGH — Arrangement builder could retain stale selected-arrangement state after same-ID parent updates**  
Symptom: `ArrangementBuilder.svelte` hydrated its form from a key made of timing-map show ID, selected arrangement ID, and arrangement count. If the parent replaced an arrangement object with the same ID and count but changed its name or sequence, the modal could continue showing and saving the stale local state.  
Root cause: The hydration guard in [ArrangementBuilder.svelte](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/ui/src/ArrangementBuilder.svelte:24) used a coarse string key instead of the selected arrangement object identity. Save also accepted raw local sequence section IDs without a current-map filter in [ArrangementBuilder.svelte](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/ui/src/ArrangementBuilder.svelte:85).  
Latency: Introduced when the arrangement builder became a mounted operator overlay. Existing tests covered initial load and selection, but not parent prop replacement with the same arrangement ID.  
Repro steps: Open the builder for arrangement `default`, replace the parent `arrangements` prop with a new `default` object of the same array length and a different sequence, then save. The previous modal could persist the old sequence.  
Evidence: Regression tests now cover same-ID prop replacement and current-section save filtering in [ArrangementBuilder.test.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/ui/src/ArrangementBuilder.test.ts:142), and the reusable section filter is pinned in [arrangement-builder.test.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/arrangements/arrangement-builder.test.ts:63). Focused verification passed: core arrangement builder 7/7 and UI ArrangementBuilder 5/5. Full local verification passed: `tsc -b`, root Vitest 742/742, Python sidecar 88 passed/1 skipped, Python sidecar ML 88 passed/1 skipped, `svelte-check` 0 errors/warnings, and Worker Vitest 11/11.  
Fix proposal: Hydrate from timing-map reference and selected arrangement object identity, and normalize save sequences against the active timing map before creating the arrangement.  
Fix status: Fixed and verified locally in this change.

## Network / data layer observations

- Network: No network calls are made by the shared arrangement builder or core arrangement helpers.
- IPC: The mounted sister-mode operator save path sends `saveArrangement` through the existing operator command bridge; this pass did not change channel names or sender validation.
- Data layer: Arrangement save payloads are now filtered to `TimingMap.sections`, preventing old-song section IDs from reaching disk persistence or later FreeShow layout projection.
- Console: Focused jsdom component tests emitted no unexpected console errors after the TypeScript build artifact was refreshed.

## Cumulative defect tally (if multi-pass)

| Pass | Defects | Critical | High | Medium | Low | Fixed in pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| EP18 local QA — 2026-05-18 | 1 | 0 | 0 | 1 | 0 | 1 |
| EP18 arrangement builder refresh — 2026-06-06 | 1 | 0 | 1 | 0 | 0 | 1 |

## Recommendations before production shipping

1. **HIGH:** Add an Electron smoke assertion that opens the arrangement builder, switches or refreshes the active arrangement, and verifies the save payload uses only the active song's section IDs.
2. **MEDIUM:** Verify FreeShow REST layout writeback against a real FreeShow instance once the sister-mode control boundary is wired.
3. **LOW:** Add a component harness drag/drop assertion for reordered sequence payloads once the browser-level harness can exercise `svelte-dnd-action` reliably.

## Final verdict

EP-18's mounted arrangement editor is safer after this pass: same-ID parent updates no longer leave stale modal state, and arrangement saves are constrained to the active timing map. The epic remains short of production-complete until real FreeShow layout writeback is verified.
