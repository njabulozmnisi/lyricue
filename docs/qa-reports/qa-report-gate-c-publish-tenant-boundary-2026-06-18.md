# Gate C Publish Tenant Boundary QA Report — 2026-06-18
**QA persona:** Senior QA analyst — Worker request contract + credential boundary verification
**Scope:** Cloudflare publish Worker handling for `X-LC-Org`, `X-LC-Campus`, `X-LC-Credential`, and `X-LC-Target` on song and project publish requests.
**Environment:** Local Vitest Worker harness with in-memory R2/KV/rate-limit stores.
**Status:** Pass-with-caveats

## Executive summary
The Worker now enforces that publish request org/campus headers match the resolved credential record. This closes a local tenant-boundary gap where the client sent identity headers but the Worker ignored them.

No critical defects surfaced. Full production certification still requires the same checks against a real Cloudflare Worker deployment with real credentials.

## Test environment + persona setup
- PASS: Local Worker suite passed: 2 files, 12 tests.
- PASS: Valid song publish, legacy JSON compatibility, rate limiting, GitHub mirror, project publish, and unsupported target tests still pass after adding org/campus enforcement.
- PASS: New mismatch regression rejects a request whose `X-LC-Campus` does not match the credential.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| TC-GC-TENANT-001 | Song publish with matching headers | Central publisher | Matching org/campus credential publishes bundle, regenerates catalog, appends audit log | Worker returned 200 and catalog/log assertions passed | PASS |
| TC-GC-TENANT-002 | Project publish with matching headers | Central publisher | Matching org/campus credential can publish campus-scoped project plan | Worker returned 200 and regenerated campus index | PASS |
| TC-GC-TENANT-003 | Mismatched campus header | Publisher with wrong campus header | Worker rejects request before write | Worker returned 403 with `Publish credential does not match X-LC-Campus.` | PASS |
| TC-GC-TENANT-004 | Existing publish safeguards | Release engineer | Unknown credentials, unsupported target, rate limit, and mirror failure behavior remain intact | Existing Worker tests passed | PASS |

## Defects surfaced + fixed
- D-GC-TENANT-001, **HIGH**: Publish requests carried `X-LC-Org` and `X-LC-Campus`, but the Worker ignored both and only used the credential record. Root cause: `infra/publish-worker/src/index.ts` called `requireCredential()` but did not compare request identity headers to the credential before writing to R2/KV. Latency: present since STORY-14.1 Worker implementation; tests asserted the app sent headers but Worker tests did not verify header enforcement. Fix: added `validateTenantHeaders()` and called it for song and project publish paths. Verification: Worker suite passed with a new mismatched-campus regression.

## Network / data layer observations
- No external network calls were required.
- In-memory R2/KV stores confirmed no write occurs in the mismatched-campus case.
- `GET /publish/whoami` remains credential-only; publish write endpoints enforce the stronger org/campus contract.

## Cumulative defect tally (if multi-pass)
| Pass | Critical | High | Medium | Low | Info |
|---|---:|---:|---:|---:|---:|
| Gate C tenant-boundary hardening | 0 | 1 fixed | 0 | 0 | 0 |

## Recommendations before production shipping
1. **HIGH**: Re-run this same mismatch check against the deployed Worker with real central and campus credentials.
2. **MEDIUM**: Add release-drill evidence that mismatched org/campus headers produce 403 and do not append to `meta/publish-log.jsonl`.

## Final verdict
Gate C local publish authorization is stricter after this pass. The Worker now honors the app’s identity headers as a boundary check, but real Cloudflare proof is still required before production certification.
