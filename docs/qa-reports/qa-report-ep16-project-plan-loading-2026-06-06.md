# EP-16 Project Plan Loading QA Report — 2026-06-06

**QA persona:** Senior QA analyst — data-contract + integration-boundary + defect triage
**Scope:** EP-16 local project-plan loading: central/campus source metadata, skip-local bundle behavior, missing-bundle import, catalog miss failure, and project source preservation.
**Environment:** Local dev, `/Users/njabulomnisi/Projects/Dojo/worshipsync`.
**Status:** Pass-with-caveats

## Executive summary

The local project-plan load path now has a tested contract: already-local songs are skipped, missing songs are downloaded/imported from verified bundles, and the resulting project preserves central or campus source metadata. No defects were surfaced in this pass. The remaining caveat is external: Worker-side project catalog update and a real two-install campus subscribe flow still need deployed infrastructure.

## Test environment + persona setup

- Repository state: local core-module verification, no live app persona required.
- TypeScript build: pass via `npx tsc -b`.
- Focused project-plan suite: pass, 2 files / 17 tests.
- Data layer: pass; bundle import callbacks received the expected show/timing/arrangement writes.
- External services: not required; fetch was stubbed for the bundle download boundary.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| EP16-PLAN-001 | Central plan metadata | Campus operator | Central plan becomes linked local project with `source.kind=central` and `diverged=false` | Project source preserved `planId` and central origin | Pass |
| EP16-PLAN-002 | Campus plan metadata | Campus operator | Campus plan becomes linked local project with campus ID preserved | Project source preserved `kind=campus`, `planId`, `campusId`, and `diverged=false` | Pass |
| EP16-PLAN-003 | Skip local bundle | Campus operator | Loader skips a plan song already present locally | `resolveLocalShow()` short-circuited download/import and result listed the show as skipped | Pass |
| EP16-PLAN-004 | Import missing bundle | Campus operator | Loader downloads bundle, verifies SHA256, imports show/timing/arrangements, and creates project entry | Fetch hit the catalog `bundleUrl`; save callbacks received `show-remote`; project shows include imported song metadata | Pass |
| EP16-PLAN-005 | Catalog miss | Campus operator | Plan references not present in catalog fail closed | Loader threw `Catalog does not contain missing@1.0.0` before import | Pass |

## Defects surfaced + fixed

None in this pass.

## Network / data layer observations

The loader calls the catalog-provided `bundleUrl` only for songs that are not already local. Bundle bytes are passed through the existing ZIP/hash validation path before timing maps and arrangements are saved. A missing catalog entry fails closed rather than creating a partial project with unresolved shows.

## Cumulative defect tally (if multi-pass)

| Pass | Critical | High | Medium | Low | Info |
|---|---:|---:|---:|---:|---:|
| 2026-06-06 EP-16 project-plan loading | 0 | 0 | 0 | 0 | 0 |

## Recommendations before production shipping

1. **HIGH** Run the same load path against a deployed Worker/R2 catalog and a second install to prove publish-to-subscribe behavior.
2. **MEDIUM** Add an Electron operator smoke once the Project Source Picker is wired to the production library loader in the sister app.

## Final verdict

EP-16 is locally stronger: the core project-plan load behavior is now proven beyond pure schema validation. It is still not production-certified until a real Worker catalog update and two-install campus flow pass.
