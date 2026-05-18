# EP18 Arrangement Builder QA Report — 2026-05-18

**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** Arrangement Builder core helpers, shared Svelte operator component, arrangement persistence contract, FreeShow layout projection, and live sync arrangement sequence behavior.
**Environment:** Local dev workspace at `/Users/njabulomnisi/Projects/Dojo/worshipsync`; no API/DB services required for this component-level pass.
**Status:** Pass-with-caveats

## Executive summary

EP18 is locally verified for the shared LyriCue codebase. The pass surfaced one **MEDIUM** acceptance gap before commit: the first implementation only had button reorder controls, while STORY-18.1 requires drag/drop. That gap is fixed in this change with `svelte-dnd-action`, while keeping button controls as an accessible fallback.

No **CRITICAL** defects remain in the locally testable EP18 surface. The caveat is that sister mode still has no mounted Arrangement Builder route in the operator window, so this pass proves the reusable component and runtime contracts, not an end-to-end operator-window editing flow.

## Test environment + persona setup

- Pass: Repository branch is local `main`; working tree only contained the EP18 changes plus ignored `.claude/`.
- Pass: Node commands used the required `env -i` Node 25 wrapper.
- Pass: No DB, migrations, API health endpoint, Redis, MinIO, or mail services are in scope for this local component pass.
- Pass: Persona was the live tech operator/worship leader editing a learned song arrangement.
- Pass: Seed/literal drift is not applicable; EP18 uses `TimingSectionType` literals from the canonical timing-map type.
- Caveat: Browser network inspection is not applicable because `ArrangementBuilder.svelte` is not mounted in the sister operator window yet.

## Test cases executed

| TC ID      | Feature                    | Persona             | Expected                                                                                                       | Actual                                                                                                                         | Status |
| ---------- | -------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------ |
| EP18-TC-01 | Shorthand parser           | Worship leader      | `V1 C V2 C B2 Tag Outro` maps to timing-map section IDs; unknown tokens are retained.                          | `parseArrangementShorthand` maps expected IDs and returns `unknownTokens` for `Vamp`.                                          | Pass   |
| EP18-TC-02 | Section sequence editing   | Tech operator       | Sequence can be reordered, duplicated, and removed without mutating the original sequence.                     | Core helper tests cover move, duplicate, remove, and immutability.                                                             | Pass   |
| EP18-TC-03 | Named arrangements         | Tech operator       | A named arrangement can be created, selected by ID, or default-selected.                                       | `createArrangement` and `selectActiveArrangement` tests pass.                                                                  | Pass   |
| EP18-TC-04 | FreeShow layout projection | Developer/operator  | Arrangement produces the expected slide sequence and rejects missing section IDs.                              | `arrangementToFreeShowLayout` returns `[1, 0, 1]` for a chorus/verse/chorus sequence and throws on unknown section.            | Pass   |
| EP18-TC-05 | Shared UI happy path       | Tech operator       | Component renders, applies shorthand, flags unknown tokens, edits sequence, and saves named arrangement.       | `ArrangementBuilder.test.ts` covers render, shorthand apply, warning, sequence edit, save, and existing arrangement selection. | Pass   |
| EP18-TC-06 | Drag/drop acceptance       | Tech operator       | Sequence list uses a drag/drop mechanism, with a fallback reorder path.                                        | `ArrangementBuilder.svelte` uses `svelte-dnd-action` on the sequence list and keeps explicit move buttons.                     | Pass   |
| EP18-TC-07 | Runtime arrangement sync   | Congregation output | Sync engine follows arrangement sequence instead of native timing-map order.                                   | Existing `lookup-word.test.ts` arrangement cases continue passing in full TS suite.                                            | Pass   |
| EP18-TC-08 | Bundle/build integration   | Developer/operator  | Shared UI/core additions do not break TypeScript, Svelte diagnostics, workspace tests, or sister bundle build. | `svelte-check`, `tsc -b`, `npm run test:ts`, and `npm -w @lyricue/sister run build` all pass.                                  | Pass   |

## Defects surfaced + fixed

**D22 — MEDIUM — Drag/drop acceptance initially missing**  
Symptom: The first EP18 UI implementation allowed up/down reorder, duplicate, remove, and save, but did not use a drag/drop interaction for STORY-18.1 AC2.  
Root cause: `ArrangementBuilder.svelte` initially modelled reordering as explicit buttons only, leaving the drag/drop acceptance path unimplemented.  
Latency: Introduced during this EP18 implementation pass; not caught by focused unit tests because the first tests verified behavior, not the literal drag/drop interaction requirement.  
Repro steps: Inspect the first local version of `ArrangementBuilder.svelte`; no `dndzone` action or drag event handler was present.  
Evidence: Fixed implementation now imports and applies `dndzone` in [ArrangementBuilder.svelte](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/ui/src/ArrangementBuilder.svelte:2) and [ArrangementBuilder.svelte](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/ui/src/ArrangementBuilder.svelte:168).
Fix proposal: Add `svelte-dnd-action` to `@lyricue/ui`, bind the sequence list to `dndzone`, and update sequence state from `consider/finalize` events.  
Fix status: Fixed locally and verified with `svelte-check`, `tsc -b`, `npm run test:ts`, and sister build.

## Network / data layer observations

- Network: No network calls are made by EP18 shared core/UI. Sister-mode REST writeback for FreeShow layouts is represented as a pure layout projection in [arrangement-builder.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/arrangements/arrangement-builder.ts:111); host integration remains the next step for an operator-window mounted flow.
- Data layer: Arrangement persistence continues to use `TimingMapStorage.saveArrangements` and `loadArrangements`, which validate schema and show ID consistency before disk writes.
- IPC: EP18 does not add IPC channels. Existing operator IPC sender validation and pre-ready buffer behavior were not changed.
- Console: Component-level jsdom tests did not emit unexpected console failures.
- Dependency hygiene: Installing `svelte-dnd-action@0.9.69` reported 9 existing moderate npm audit findings; they were not introduced or triaged as part of EP18.

## Cumulative defect tally (if multi-pass)

| Pass                       | Defects | Critical | High | Medium | Low | Fixed in pass |
| -------------------------- | ------: | -------: | ---: | -----: | --: | ------------: |
| EP18 local QA — 2026-05-18 |       1 |        0 |    0 |      1 |   0 |             1 |

## Recommendations before production shipping

1. **MEDIUM:** Mount `ArrangementBuilder.svelte` inside the real operator shell and add an end-to-end Electron/browser pass that saves an arrangement through the host, reloads it from disk, and selects it for live sync.
2. **MEDIUM:** Add host adapter coverage for FreeShow Layout writeback once the sister-mode REST boundary exists, including a failing response case and a round-trip assertion on the layout `slides` array.
3. **LOW:** Add a browser-level drag/drop test when a component harness or operator route is available; current coverage verifies the DnD wiring at build time and the fallback controls at interaction level.

## Final verdict

EP18 is locally ship-ready as a reusable core/UI implementation with one explicit caveat: the full operator-window editing workflow is not mounted yet, so production readiness for FR9.7 sister-mode REST layout writeback depends on the next host-integration slice. The shipped pieces cover section blocks, drag/drop wiring, shorthand parsing, named arrangement save/select callbacks, FreeShow slide projection, and the already-existing SyncEngine arrangement playback path.
