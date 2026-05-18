# EP13-EP14 Fix Verification QA Report — 2026-05-18
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP13 `.lcbundle` ZIP export/import and EP14 publish-worker/setup hardening after D20/D21.
**Environment:** Local dev; Node commands run with the documented `env -i` wrapper; no real Cloudflare or GitHub resources mutated.
**Status:** Pass-with-caveats

## Executive summary
D20 is fixed locally: exported `.lcbundle` files are ZIP archives with `manifest.json`, `timing.json`, `show.json`, and `arrangements.json`, and import/download still enforce SHA256 integrity.
D21 is partially fixed locally: the Worker accepts ZIP bundles, rate-limits credentials, mirrors successful writes to GitHub when configured, tolerates mirror failure, and has a dry-run setup script that generates signing/trust artifacts. The remaining caveat is production verification against a real Cloudflare R2/KV/Worker deployment.
No **CRITICAL** defects were found in this pass.

## Test environment + persona setup
- Pass: Repo is on `main` with committed fixes `ad970b0` and `f2f66e1`; only untracked `.claude/` remains and is an ignored operator artifact.
- Pass: TypeScript workspace suite: `603 passed`.
- Pass: Publish-worker suite from `infra/publish-worker`: `9 passed`.
- Pass: Core build: `npx tsc -b --pretty false`.
- Pass: Setup dry-run: `node infra/publish-worker/setup-library.mjs --dry-run --org-id=hillside --org-name="Hillside Church" --account-id=cf-account --github-repo=hillside/lyricue-library`.
- Persona: Library administrator for setup/signing/trust artifact generation.
- Persona: Central publisher with `X-LC-Credential` for publish, catalog regeneration, rate limiting, and mirror flows.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| TC-01 | EP13 bundle export | Library administrator | Exported bundle starts with ZIP magic bytes and contains separate manifest/timing/show/arrangements entries. | `library-manager.test.ts` asserts `PK\x03\x04` and round-trips through `readBundle`. | Pass |
| TC-02 | EP13 bundle integrity | Library administrator | Download verifies catalog SHA256 before import. | Existing SHA mismatch test still rejects bad downloads. | Pass |
| TC-03 | EP14 publish ZIP bundle | Central publisher | Worker reads manifest from real ZIP `.lcbundle`, writes R2 object, regenerates catalog, appends audit log. | `index.test.ts` publishes a core-generated ZIP bundle and validates R2 objects/catalog/log. | Pass |
| TC-04 | EP14 legacy compatibility | Central publisher | Existing JSON-envelope test bundles do not break catalog regeneration during transition. | Worker accepts legacy JSON bundle and indexes it. | Pass |
| TC-05 | EP14 rate limit | Central publisher | Credential is limited by hourly counter. | Second publish with limit `1` returns `429`. | Pass |
| TC-06 | EP14 GitHub mirror success | Central publisher | Worker commits bundle to GitHub contents API with required message format. | Test observes `PUT /contents/songs/song-1/1.0.0.lcbundle` with `publish(song-1): version 1.0.0 by central`. | Pass |
| TC-07 | EP14 GitHub mirror failure | Central publisher | Mirror failure logs warning but does not fail authoritative R2 publish. | GitHub `500` still returns publish `200` and logs warning. | Pass |
| TC-08 | EP14 setup dry-run | Library administrator | Setup script prints R2/KV/Worker/mirror/trust commands without writing files or mutating Cloudflare. | Dry-run command exited `0` and printed the expected non-mutating plan. | Pass |

## Defects surfaced + fixed
D20 — **MEDIUM**  
Symptom: EP13 `.lcbundle` export/import used a deterministic JSON envelope instead of the ZIP container required by the epic.  
Root cause: `packages/core/src/library/library-manager.ts` serialized the whole bundle object with `stableJson` rather than writing a ZIP archive.  
Latency: Introduced in the first EP13 implementation; unit tests asserted round-trip behavior but not container shape.  
Fix PR(s): Fixed directly in commit `ad970b0 feat:(#EP-13): store library bundles as zip`.  
Verification: `packages/core/src/library/library-manager.test.ts` now asserts ZIP magic bytes; focused bundle tests and full TypeScript suite pass.

D21 — **HIGH**  
Symptom: EP14 had a local Worker core, but no setup script, GitHub mirror integration, signing/trust artifact automation, or rate-limit coverage. After D20, the Worker also would have rejected real ZIP bundles because it parsed request bodies as JSON.  
Root cause: `infra/publish-worker/src/index.ts` only handled JSON-envelope bundles and did not implement STORY-14.1 rate limiting or STORY-14.3 mirror behavior; setup documentation still described manual provisioning.  
Latency: Introduced in the initial EP14 skeleton; tests used JSON bundle fixtures and therefore missed ZIP/Worker drift.  
Fix PR(s): Fixed directly in commit `f2f66e1 feat:(#EP-14): harden library publish setup`.  
Verification: Publish-worker suite now covers ZIP publish, legacy JSON compatibility, rate limiting, GitHub mirror success/failure, and setup-plan idempotency; setup dry-run exits `0`.

## Network / data layer observations
- The Worker publish surface now uses `application/vnd.lyricue.bundle+zip` for stored bundles.
- GitHub mirror writes use the Contents API path `https://api.github.com/repos/{repo}/contents/{key}` and include branch, commit message, base64 content, and existing file SHA when present.
- Mirror failure is intentionally non-authoritative: R2/KV publish remains the source of truth and mirror failures are warning-only.
- Local R2/KV behavior is simulated with in-memory fakes; no Cloudflare account, R2 bucket, KV namespace, Worker route, or GitHub repo was mutated in this pass.
- No seed, schema, SSR/CSR, form hydration, or privacy-boundary surfaces apply to these infra/core changes.

## Cumulative defect tally (if multi-pass)
| Pass | Scope | Defects open before | Fixed in pass | Remaining |
|---|---|---:|---:|---:|
| 2026-05-17 | EP05-EP14 QA | 3 | 0 | D19, D20, D21 |
| 2026-05-18 | EP13-EP14 fixes | 3 | 2 | D19 plus real Cloudflare/GitHub production verification caveat |

## Recommendations before production shipping
1. **HIGH:** Run EP14 against a real Cloudflare R2/KV/Worker deployment with a real GitHub mirror token before calling library publishing production-ready.
2. **HIGH:** Add a deployed-environment QA drill that publishes a ZIP bundle, fetches from R2, disables the primary URL, and verifies client fallback to GitHub raw.
3. **MEDIUM:** Add an integration check that prevents Worker tests from reverting to JSON-only bundle fixtures.
4. **MEDIUM:** Keep D19 open until EP05 uses the intended production Demucs + WhisperX path rather than deterministic alignment.

## Final verdict
EP13 and EP14 are locally ship-ready for the walking-skeleton milestone. The previous D20 defect is closed, and the locally actionable parts of D21 are closed. The remaining EP14 risk is not a code-level blocker but an environment proof gap: production readiness still requires a real Cloudflare/GitHub deployment pass with credentials owned by the operator.
