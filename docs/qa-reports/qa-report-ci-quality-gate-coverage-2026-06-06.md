# CI Quality Gate Coverage QA Report — 2026-06-06
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** Hosted CI local-quality-gate coverage vs. the current local release floor.
**Environment:** Local dev workspace at `/Users/njabulomnisi/Projects/Dojo/worshipsync`; workflow inspection plus local command verification with Node 25 and Python sidecar venvs.
**Status:** Pass-with-caveats

## Executive summary

The hosted CI workflow now runs the UI Svelte diagnostics and Publish Worker tests that were already part of the repeated local gate. One **MEDIUM** quality-gate coverage defect was surfaced and fixed. No **CRITICAL** defects were found.

The caveat is unchanged: this is still a local-quality CI gate, not the signed installer/release matrix.

## Test environment + persona setup

- Pass: Repository workspace was local `main`; only current CI/docs changes and ignored `.claude/` were present.
- Pass: Workflow inspected: `.github/workflows/ci.yml`.
- Pass: Local Svelte diagnostics were run through `packages/ui`.
- Pass: Local Publish Worker tests were run through `infra/publish-worker/vitest.config.ts`.
- N/A: DB, browser persona, auth, privacy, migrations, Redis, MinIO, mail, and seed/literal checks do not apply to this workflow-only pass.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| CI-QG-01 | Hosted TypeScript gate | Developer | CI still runs `npx tsc -b --pretty false` and TypeScript tests. | Existing workflow steps preserved. | Pass |
| CI-QG-02 | Hosted Python gate | Developer | CI still creates `python-sidecar/.venv` and runs `pytest -q`. | Existing workflow steps preserved. | Pass |
| CI-QG-03 | UI Svelte diagnostics | Developer | Hosted CI runs `svelte-check` for the shared UI package. | Added `UI Svelte diagnostics` step. | Pass |
| CI-QG-04 | Publish Worker tests | Developer | Hosted CI runs Worker Vitest tests. | Added `Publish Worker tests` step. | Pass |
| CI-QG-05 | Renderer builds | Developer | CI still builds karaoke and operator renderer bundles. | Existing Vite build steps preserved. | Pass |

## Defects surfaced + fixed

**D44 — MEDIUM — Hosted CI did not cover the full local quality floor**  
Symptom: The local release gate repeatedly ran `svelte-check` and Publish Worker Vitest, but `.github/workflows/ci.yml` only ran TypeScript build/tests, Python sidecar tests, and sister renderer builds. UI diagnostic or Worker regressions could pass hosted CI.  
Root cause: The original CI quality gate was created before Worker tests and Svelte diagnostics became part of every local hardening sweep.  
Latency: Present since the local gate expanded beyond the initial CI workflow; local passes caught these checks manually, but hosted CI did not enforce them.  
Repro steps: Inspect `.github/workflows/ci.yml`; before this change there were no steps invoking `npx svelte-check --tsconfig tsconfig.json` or `npx vitest run --config vitest.config.ts` under `infra/publish-worker`.  
Evidence: New CI steps live in [ci.yml](/Users/njabulomnisi/Projects/Dojo/worshipsync/.github/workflows/ci.yml:52). Local verification passed: `svelte-check` 0 errors/warnings and Worker Vitest 11/11. Full local verification also passed: `tsc -b`, root Vitest 765/765, Python sidecar 88 passed/1 skipped, and Python sidecar ML 88 passed/1 skipped.  
Fix proposal: Add explicit CI steps for UI Svelte diagnostics and Publish Worker tests after TypeScript tests and before Python/renderer build steps.  
Fix status: Fixed and verified locally in this change.

## Network / data layer observations

- Network: The added CI steps do not require external services.
- Data layer: Worker tests use local in-memory bindings/mocks, not live R2/KV.
- Console: Worker tests emit the known Vite CJS deprecation warning; it does not fail the suite.

## Cumulative defect tally (if multi-pass)

| Pass | Defects | Critical | High | Medium | Low | Fixed in pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Initial CI local quality gate — 2026-05-19 | 0 | 0 | 0 | 0 | 0 | 0 |
| CI quality gate coverage — 2026-06-06 | 1 | 0 | 0 | 1 | 0 | 1 |

## Recommendations before production shipping

1. **HIGH:** Keep the manual release matrix as the source of truth for installer/signing proof; do not treat this local CI gate as production certification.
2. **MEDIUM:** Add macOS Electron smoke to hosted CI only after the runner/display-server behavior is stable enough to avoid false failures.
3. **LOW:** Consider a root `verify:local` script that runs the exact full local gate once command runtime is acceptable for day-to-day use.

## Final verdict

The hosted CI local-quality gate is stronger after this pass because it now enforces the same UI and Worker checks that were already required locally. Production release certification still depends on the manual release matrix, signing, external infrastructure, and hardware QA.
