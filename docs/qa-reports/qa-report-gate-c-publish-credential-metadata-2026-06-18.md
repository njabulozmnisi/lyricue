# Gate C Publish Credential Metadata QA Report — 2026-06-18
**QA persona:** Senior QA analyst — Worker credential-store boundary verification
**Scope:** Cloudflare publish Worker behavior when Workers KV contains malformed or invalid publish credential metadata.
**Environment:** Local Vitest Worker harness with in-memory KV/R2/rate-limit stores.
**Status:** Pass-with-caveats

## Executive summary
The Worker now fails closed when credential metadata in KV is malformed JSON or has an invalid shape. These cases return controlled 403 responses instead of falling through to the generic 500 handler.

No new critical/high defects remain locally. Real deployed KV data still needs external Gate C validation.

## Test environment + persona setup
- PASS: Local Worker suite passed: 2 files, 14 tests.
- PASS: `GET /publish/whoami` rejects malformed credential JSON with 403.
- PASS: `GET /publish/whoami` rejects credential metadata with an invalid role with 403.
- PASS: Existing publish, project, rate-limit, tenant-header, and mirror tests still pass.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| TC-GC-CREDMETA-001 | Malformed KV credential JSON | Library admin | Worker rejects without 500 | Returned 403 with `Publish credential metadata is invalid.` | PASS |
| TC-GC-CREDMETA-002 | Invalid credential role | Library admin | Worker rejects invalid role before publish | Returned 403 with `Publish credential metadata is invalid.` | PASS |
| TC-GC-CREDMETA-003 | Existing publish flows | Central publisher | Valid credentials still publish song/project and regenerate catalog/index | Existing Worker tests passed | PASS |

## Defects surfaced + fixed
- D-GC-CREDMETA-001, **MEDIUM**: Malformed or invalid credential metadata in Workers KV could cause publish authentication to fall through to a generic 500 response. Root cause: `infra/publish-worker/src/index.ts` parsed KV values directly as `Credential` without validating JSON parse errors, required fields, role literals, or `keyId` type. Latency: present since the Worker credential lookup was added; tests only covered valid/unknown credential tokens, not corrupt credential records. Fix: added `parseCredentialRecord()` and `validateCredentialRecord()`. Verification: Worker suite passed with malformed JSON and invalid-role regressions.

## Network / data layer observations
- No external network calls were required.
- In-memory KV fixtures now exercise bad credential metadata without mutating shared infrastructure.
- The public failure message stays generic enough for operators while avoiding an internal-error posture.

## Cumulative defect tally (if multi-pass)
| Pass | Critical | High | Medium | Low | Info |
|---|---:|---:|---:|---:|---:|
| Gate C tenant-boundary hardening | 0 | 1 fixed | 0 | 0 | 0 |
| Gate C credential metadata hardening | 0 | 0 | 1 fixed | 0 | 0 |

## Recommendations before production shipping
1. **HIGH**: Validate real Workers KV credential records during Gate C setup before issuing tokens to campuses.
2. **MEDIUM**: Add the same malformed-record check to the deployed Worker smoke once real Cloudflare credentials are available.

## Final verdict
The local Worker credential-store boundary is safer: bad KV metadata now fails as an authorization problem rather than an internal server error. Production proof still requires a real Cloudflare deployment.
