# EP13 Bundle Download Timeout QA Report — 2026-06-06
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP-13 library bundle download behavior and EP-16 project-plan remote bundle import propagation.
**Environment:** Local dev workspace at `/Users/njabulomnisi/Projects/Dojo/worshipsync`; pure core library verification with Node 25 via the required isolated shell wrapper.
**Status:** Pass-with-caveats

## Executive summary

The library bundle download path now supports an opt-in timeout so a stalled CDN, mirror, or project-plan import cannot hang indefinitely. One **MEDIUM** network-boundary robustness defect was surfaced and fixed. No **CRITICAL** defects were found.

The remaining caveat is external: real R2/GitHub mirror download and disaster-recovery proof still require production credentials.

## Test environment + persona setup

- Pass: Repository workspace was local `main`; only current EP-13 library hardening changes and ignored `.claude/` were present.
- Pass: Node commands used the documented `env -i` Node 25 wrapper.
- Pass: No live CDN, R2, or GitHub mirror was used; fetch behavior was mocked at the library boundary.
- Pass: Persona was a campus install importing a central library bundle, directly or through a project plan.
- Pass: Network-boundary check focused on bounded failure behavior and SHA-preserving import behavior.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP13-BDL-01 | Bundle export/read/download/import | Campus install | ZIP bundle downloads with one-argument fetch, passes SHA256, and imports timing/arrangements. | Existing happy path still passes. | Pass |
| EP13-BDL-02 | SHA256 mismatch | Campus install | Corrupt or unexpected bundle bytes reject before import. | Existing mismatch test still rejects before import. | Pass |
| EP13-BDL-03 | Timeout abort | Campus install | A hanging bundle fetch aborts after configured timeout and returns a clear timeout error. | `downloadBundle()` rejected with `Bundle download timed out after 1ms`. | Pass |
| EP13-BDL-04 | Timeout config validation | Campus install | Invalid timeout config rejects before fetch. | `timeoutMs: 0` rejected before any fetch call. | Pass |
| EP16-PLAN-01 | Project-plan bundle import | Campus install | Central project-plan loading passes the configured bundle timeout into remote bundle imports. | `loadProjectPlanBundles()` called fetch with an `AbortSignal` and imported the bundle successfully. | Pass |

## Defects surfaced + fixed

**D41 — MEDIUM — Library bundle downloads had no bounded failure behavior**  
Symptom: `downloadBundle()` awaited `fetch(entry.bundleUrl)` with no timeout option. A stalled CDN, R2 object URL, GitHub mirror, or remote project-plan bundle could leave the import flow waiting indefinitely.  
Root cause: The library manager covered successful downloads, non-2xx responses, and SHA mismatches, but had no abort/timeout control for a stalled network boundary.  
Latency: Present since EP-13 bundle download support was introduced; earlier tests mocked immediate responses only.  
Repro steps: Provide a fetch implementation that never resolves and call `downloadBundle()`; previous code never rejected.  
Evidence: Timeout behavior is covered in [library-manager.test.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/library/library-manager.test.ts:158), invalid timeout validation is covered in [library-manager.test.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/library/library-manager.test.ts:190), and project-plan propagation is covered in [library-manager.test.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/library/library-manager.test.ts:394). The implementation lives in [library-manager.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/library/library-manager.ts:272). Focused verification passed: `library-manager.test.ts` 14/14. Full local verification passed: `tsc -b`, root Vitest 758/758, Python sidecar 88 passed/1 skipped, Python sidecar ML 88 passed/1 skipped, `svelte-check` 0 errors/warnings, and Worker Vitest 11/11.  
Fix proposal: Add optional `timeoutMs` support to `downloadBundle()`, propagate it from `loadProjectPlanBundles()` as `downloadTimeoutMs`, preserve one-argument fetch calls when no timeout is configured, and reject invalid timeout values before network I/O.  
Fix status: Fixed and verified locally in this change.

## Network / data layer observations

- Network: Timeout is opt-in; existing callers that do not pass `timeoutMs` keep the previous one-argument fetch contract.
- Network: Timeout-enabled bundle downloads pass an `AbortSignal` to fetch so native fetch implementations can abort in-flight network I/O.
- Data layer: Bundle import still runs SHA256 verification before timing-map or arrangement persistence.
- Console: Focused tests emitted no unexpected console errors.

## Cumulative defect tally (if multi-pass)

| Pass | Defects | Critical | High | Medium | Low | Fixed in pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| EP13 library manager — prior local passes | 0 | 0 | 0 | 0 | 0 | 0 |
| EP13 bundle timeout — 2026-06-06 | 1 | 0 | 0 | 1 | 0 | 1 |

## Recommendations before production shipping

1. **HIGH:** Run bundle download/import against real R2 and GitHub mirror URLs with primary-failure fallback evidence.
2. **MEDIUM:** Configure a host-level timeout budget wherever the operator triggers library bundle import.
3. **LOW:** Surface timed-out bundle imports in the operator library UI once remote library browsing is fully wired.

## Final verdict

EP-13's local bundle download path is safer after this pass because stalled remote downloads can be bounded by the host and project-plan imports can inherit that protection. Full multi-campus library certification still depends on real Cloudflare/GitHub credentialed proof.
