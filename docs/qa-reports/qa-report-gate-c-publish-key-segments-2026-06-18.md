# Gate C Publish Key Segment QA Report — 2026-06-18
**QA persona:** Senior QA analyst — Worker object-key boundary verification
**Scope:** Cloudflare publish Worker validation for bundle and project identifiers before they are used in R2 object keys.
**Environment:** Local Vitest Worker harness with in-memory KV/R2/rate-limit stores.
**Status:** Pass-with-caveats

## Executive summary
The Worker now rejects unsafe song IDs, bundle versions, project IDs, and project song references before constructing R2 keys. This prevents malformed publish payloads from writing unexpected object paths.

No critical/high defects remain locally. Real R2 deployment still needs Gate C proof.

## Test environment + persona setup
- PASS: Local Worker suite passed: 2 files, 16 tests.
- PASS: Unsafe bundle `songId` is rejected with 400 and no object writes.
- PASS: Unsafe project plan `id` is rejected with 400 and no object writes.
- PASS: Existing valid song/project publish paths still pass.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| TC-GC-KEY-001 | Unsafe bundle manifest key | Publisher | Worker rejects unsafe `songId` before R2 write | Returned 400 and in-memory R2 stayed empty | PASS |
| TC-GC-KEY-002 | Unsafe project plan key | Publisher | Worker rejects unsafe project `id` before R2 write | Returned 400 and in-memory R2 stayed empty | PASS |
| TC-GC-KEY-003 | Valid publish paths | Central publisher | Existing song/project publish behavior remains intact | Existing Worker tests passed | PASS |

## Defects surfaced + fixed
- D-GC-KEY-001, **HIGH**: Bundle and project identifiers from publish payloads were interpolated directly into R2 object keys without safe-segment validation. Root cause: `infra/publish-worker/src/index.ts` validated required fields but not whether IDs/versions contained slashes, traversal-like segments, or other unsafe characters. Latency: present since Worker publish/project publish paths were added; tests used only safe fixture IDs. Fix: added a `SAFE_KEY_SEGMENT` guard for bundle manifest `songId`/`bundleVersion`, project plan `id`, and each project song reference. Verification: Worker suite passed with unsafe bundle and project regressions.

## Network / data layer observations
- No external network calls were required.
- Rejected unsafe payloads left the in-memory R2 object map empty, confirming validation occurs before writes.
- The validation allows common version/id characters: letters, digits, dot, underscore, and hyphen.

## Cumulative defect tally (if multi-pass)
| Pass | Critical | High | Medium | Low | Info |
|---|---:|---:|---:|---:|---:|
| Gate C tenant-boundary hardening | 0 | 1 fixed | 0 | 0 | 0 |
| Gate C credential metadata hardening | 0 | 0 | 1 fixed | 0 | 0 |
| Gate C key-segment hardening | 0 | 1 fixed | 0 | 0 | 0 |

## Recommendations before production shipping
1. **HIGH**: Re-run unsafe-key publish attempts against the deployed Worker and verify R2/KV remain unchanged.
2. **MEDIUM**: Align any future admin tooling with the same safe key-segment grammar before generating credentials or project IDs.

## Final verdict
Gate C local publish input validation is stronger. The Worker now rejects unsafe object-key segments before write, but production certification still requires a real Cloudflare deployment.
