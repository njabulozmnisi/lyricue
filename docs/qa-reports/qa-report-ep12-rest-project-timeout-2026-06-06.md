# EP12 REST Project Timeout QA Report — 2026-06-06
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP-12 FreeShow REST active-project adapter refresh behavior, timeout aborts, invalid timeout configuration, and subscriber preservation.
**Environment:** Local dev workspace at `/Users/njabulomnisi/Projects/Dojo/worshipsync`; pure core adapter verification with Node 25 via the required isolated shell wrapper.
**Status:** Pass-with-caveats

## Executive summary

The REST project adapter now supports an opt-in timeout so a dead FreeShow endpoint cannot hang active-project refresh indefinitely. One **MEDIUM** network-boundary robustness defect was surfaced and fixed. No **CRITICAL** defects were found.

The remaining EP-12 caveat is still external: project ingestion needs a live FreeShow REST endpoint for end-to-end verification.

## Test environment + persona setup

- Pass: Repository workspace was local `main`; only current EP-12 adapter hardening changes and ignored `.claude/` were present.
- Pass: Node commands used the documented `env -i` Node 25 wrapper.
- Pass: No live FreeShow server was used; fetch behavior was mocked at the adapter boundary.
- Pass: Persona was the sister-mode host refreshing the active FreeShow project before driving setlist state.
- Pass: Network boundary check focused on bounded failure behavior, not visual operator UI.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP12-REST-01 | Active project normalization | Sister host | `/v1/projects/active` response normalizes and notifies subscribers. | Existing normalization/subscriber test still passes. | Pass |
| EP12-REST-02 | Non-2xx response | Sister host | Non-2xx refresh rejects with status text. | Existing 500 response test still passes. | Pass |
| EP12-REST-03 | Timeout abort | Sister host | A hanging fetch aborts after configured timeout and returns a clear timeout error. | Adapter rejected with `Project fetch timed out after 1ms`. | Pass |
| EP12-REST-04 | Timeout config validation | Sister host | Invalid timeout config rejects before fetch. | Adapter rejected `timeoutMs must be positive`. | Pass |

## Defects surfaced + fixed

**D40 — MEDIUM — REST active-project refresh had no bounded failure behavior**  
Symptom: `createRestProjectAdapter().refresh()` awaited `fetch()` with no timeout option. If a FreeShow REST endpoint accepted a connection but never responded, the operator project refresh path could hang indefinitely.  
Root cause: The adapter covered successful normalization and non-2xx responses but had no abort/timeout control for a stalled network boundary.  
Latency: Present since the REST adapter was introduced; earlier tests mocked immediate responses only.  
Repro steps: Provide a fetch implementation that never resolves and call `refresh()`; previous code never rejected.  
Evidence: Timeout behavior is covered in [project-adapter.test.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/setlist/project-adapter.test.ts:123), and the timeout support lives in [project-adapter.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/setlist/project-adapter.ts:80). Focused verification passed: `tsc -b` and `project-adapter.test.ts` 8/8. Full local verification passed: `tsc -b`, root Vitest 755/755, Python sidecar 88 passed/1 skipped, Python sidecar ML 88 passed/1 skipped, `svelte-check` 0 errors/warnings, and Worker Vitest 11/11.  
Fix proposal: Add optional `timeoutMs` support using `AbortController`, preserve one-argument fetch calls when no timeout is configured, and reject invalid timeout values.  
Fix status: Fixed and verified locally in this change.

## Network / data layer observations

- Network: Timeout is opt-in; callers that do not pass `timeoutMs` keep the existing fetch shape.
- Data layer: The adapter still updates `current` and subscribers only after a successful, normalized response.
- Console: Focused tests emitted no unexpected console errors.

## Cumulative defect tally (if multi-pass)

| Pass | Defects | Critical | High | Medium | Low | Fixed in pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| EP12 disk-backed setlist — 2026-05-19 | 0 | 0 | 0 | 0 | 0 | 0 |
| EP12 REST project timeout — 2026-06-06 | 1 | 0 | 0 | 1 | 0 | 1 |

## Recommendations before production shipping

1. **HIGH:** Run the adapter against a real FreeShow REST endpoint and capture request/response evidence for active-project ingestion.
2. **MEDIUM:** Configure a host-level timeout budget when wiring the sister-mode FreeShow endpoint.
3. **LOW:** Surface timeout failures in the operator diagnostics panel once REST project ingestion is exposed in the UI.

## Final verdict

EP-12's local REST adapter is safer after this pass because stalled FreeShow refreshes can be bounded by the host. Full EP-12 completion still depends on live FreeShow REST integration proof.
