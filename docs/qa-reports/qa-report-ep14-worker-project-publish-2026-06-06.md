# EP-14 Worker Project Publish QA Report — 2026-06-06

**QA persona:** Senior QA analyst — API boundary + auditability + defect triage
**Scope:** Publish Worker project-plan boundary: target validation, campus project publish, project index regeneration, and project publish audit logging.
**Environment:** Local dev, `/Users/njabulomnisi/Projects/Dojo/worshipsync/infra/publish-worker`.
**Status:** Pass-with-caveats

## Executive summary

The Worker now rejects unsupported publish targets and appends audit log entries for successful project-plan publishes, matching the Worker’s stated publish-audit contract. No defects remain in this local slice. Production proof still requires a real Cloudflare Worker/R2/KV deployment.

## Test environment + persona setup

- Repository state: local Worker simulation with in-memory R2/KV test doubles.
- TypeScript build: pass via root `npx tsc -b`.
- Worker suite: pass, 2 files / 11 tests.
- External services: not required; Cloudflare bindings were represented by local fakes.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| EP14-WORKER-001 | Campus project publish | Campus/central publisher | Worker writes project JSON and regenerates `projects/campuses/<id>/index.json` | Plan stored at campus project path; index contained published plan | Pass |
| EP14-WORKER-002 | Project audit logging | Operator/admin | Successful project publish appends audit entry | `meta/publish-log.jsonl` contained `projectId` and `target:"campus"` | Pass |
| EP14-WORKER-003 | Target validation | API client | Unsupported `X-LC-Target` fails closed | Worker returned 400 with explicit target validation message | Pass |

## Defects surfaced + fixed

None remain. The pass fixed one local contract gap: project-plan publishes did not append to the audit log even though the Worker publish contract says successful publishes are audited.

## Network / data layer observations

The in-memory R2 fake showed the expected writes: project JSON, project index JSON, and append-only JSONL audit content. The invalid-target test fails before any object write, which avoids polluting central or campus namespaces from malformed clients.

## Cumulative defect tally (if multi-pass)

| Pass | Critical | High | Medium | Low | Info |
|---|---:|---:|---:|---:|---:|
| 2026-06-06 EP-14 Worker project publish | 0 | 0 | 0 | 0 | 0 |

## Recommendations before production shipping

1. **HIGH** Re-run this suite against a deployed Worker with real R2/KV bindings and a real campus credential.
2. **MEDIUM** Add a disaster-recovery drill that fetches the project index from the primary R2 URL, then from the GitHub mirror after primary failure.

## Final verdict

The local Worker project-publish contract is stronger and internally consistent. It is not production-certified until the same behavior is verified against real Cloudflare and mirror infrastructure.
