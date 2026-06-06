# EP19 Parallel Lyrics Schema QA Report — 2026-06-06
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP-19 timing-map schema validation for `parallel` lyric tracks and stale section-reference rejection.
**Environment:** Local dev workspace at `/Users/njabulomnisi/Projects/Dojo/worshipsync`; pure core schema verification with Node 25 via the required isolated shell wrapper.
**Status:** Pass-with-caveats

## Executive summary

The timing-map validator now rejects parallel lyric section IDs that do not exist in the same map's `sections` array. One **HIGH** schema-boundary data-integrity defect was surfaced and fixed. No **CRITICAL** defects were found.

This closes the schema-level gap behind the earlier renderer and IPC normalization fixes. EP-19 still depends on translated-primary timing-map learning for full production completion.

## Test environment + persona setup

- Pass: Repository workspace was local `main`; only current EP-19 schema hardening changes and ignored `.claude/` were present.
- Pass: Node commands used the documented `env -i` Node 25 wrapper.
- Pass: No API, DB, migrations, Redis, MinIO, mail, or external worker services are in scope for this pure schema pass.
- Pass: Persona was any boundary loader or saver validating a timing map before storage/import/render.
- Pass: Literal drift is not applicable; this is a section-reference integrity check against the same map.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP19-SCHEMA-01 | Valid parallel lyrics | Boundary validator | A track referencing existing section `v1` validates. | Existing happy-path parallel lyrics test still passes. | Pass |
| EP19-SCHEMA-02 | Stale parallel section | Boundary validator | A track referencing missing section `stale` is rejected with an addressable error path. | Validator returned `path: parallel.0.sections.0.sectionId`, `code: custom`. | Pass |
| EP19-SCHEMA-03 | Existing schema coverage | Boundary validator | The broader timing-map schema suite remains green. | `timing-map-schema.test.ts` passed 34/34. | Pass |

## Defects surfaced + fixed

**D39 — HIGH — TimingMap schema accepted stale parallel lyric section IDs**  
Symptom: `parallelLyricsTrackSchema` validated the shape of each translated section but did not verify that `sectionId` existed in the parent timing map. A schema-valid timing map could therefore carry orphan translation rows after imports, IPC saves, or future editor changes.  
Root cause: The validator treated `ParallelLyricsTrack` independently from its parent `TimingMap`, so cross-field section-reference integrity was not enforced.  
Latency: Present since EP-19 introduced `TimingMap.parallel`; earlier tests only covered structurally valid translation tracks. Renderer and IPC normalization reduced current exposure, but the core schema boundary still accepted drift.  
Repro steps: Validate a timing map with `sections: [{ id: "v1" }]` and `parallel: [{ sections: [{ sectionId: "stale" }] }]`; previous schema accepted it.  
Evidence: The new rejection test lives at [timing-map-schema.test.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/types/timing-map-schema.test.ts:118), and the cross-field check lives in [timing-map-schema.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/types/timing-map-schema.ts:139). Focused verification passed: `tsc -b` and `timing-map-schema.test.ts` 34/34. Full local verification passed: `tsc -b`, root Vitest 753/753, Python sidecar 88 passed/1 skipped, Python sidecar ML 88 passed/1 skipped, `svelte-check` 0 errors/warnings, and Worker Vitest 11/11.  
Fix proposal: Add a `superRefine` on `timingMapSchema` that checks every `parallel[].sections[].sectionId` against `sections[].id` and reports a path-specific validation error.  
Fix status: Fixed and verified locally in this change.

## Network / data layer observations

- Network: No network calls are made by schema validation.
- Data layer: `TimingMapStorage.save()` and `.load()` now reject timing maps with orphan parallel lyric rows before they reach or leave disk.
- IPC: Translation IPC already normalizes before save; this schema check now protects all other timing-map boundaries too.
- Console: Focused tests emitted no unexpected console errors.

## Cumulative defect tally (if multi-pass)

| Pass | Defects | Critical | High | Medium | Low | Fixed in pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| EP19 translation editor refresh — 2026-06-06 | 1 | 0 | 1 | 0 | 0 | 1 |
| EP19 translation IPC — 2026-06-06 | 1 | 0 | 1 | 0 | 0 | 1 |
| EP19 parallel schema — 2026-06-06 | 1 | 0 | 1 | 0 | 0 | 1 |

## Recommendations before production shipping

1. **HIGH:** Add an import-path fixture with stale parallel section IDs and verify the operator receives a validation error instead of a silently loaded map.
2. **MEDIUM:** Add translated-primary timing-map learning and QA for each selected primary display language.
3. **LOW:** Consider adding duplicate-section-ID validation if future imports can produce duplicate `TimingMap.sections[].id` values.

## Final verdict

EP-19's data boundary is safer after this pass: stale translation section references are rejected at the core schema layer, not only normalized by current UI and IPC paths. Full EP-19 completion still depends on translated-primary timing-map learning.
