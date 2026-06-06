# Local Verify Script QA Report — 2026-06-06
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** Root package scripts for reproducing LyriCue's current local verification gate.
**Environment:** Local dev workspace at `/Users/njabulomnisi/Projects/Dojo/worshipsync`; Node 25 via the required isolated shell wrapper; Python sidecar `.venv` and `.venv-ml`.
**Status:** Pass-with-caveats

## Executive summary

The project now has a root `npm run verify:local` command that executes the current local gate in one place. One **LOW** repeatability defect was surfaced and fixed. No **CRITICAL** or **HIGH** defects were found.

The caveat is that this command still depends on the operator's local venvs and Node wrapper; it is not a replacement for external release-matrix proof.

## Test environment + persona setup

- Pass: Repository workspace was local `main`; only current package-script/docs changes and ignored `.claude/` were present.
- Pass: Command was launched with the documented clean Node 25 `env -i` wrapper.
- Pass: Python sidecar regular and ML venvs were present.
- Pass: Persona was a developer/release engineer running the local pre-commit/pre-release gate.
- N/A: DB, auth, privacy, SSR/CSR, migrations, Redis, MinIO, mail, queues, and seed/literal checks do not apply to this package-script slice.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| LV-01 | TypeScript build | Developer | `verify:local` runs `npx tsc -b`. | Build completed cleanly. | Pass |
| LV-02 | TypeScript/Vitest | Developer | `verify:local` runs the workspace Vitest suite. | 78 files / 765 tests passed. | Pass |
| LV-03 | UI diagnostics | Developer | `verify:local` runs Svelte diagnostics. | `svelte-check` found 0 errors / 0 warnings. | Pass |
| LV-04 | Publish Worker tests | Developer | `verify:local` runs Worker tests. | Worker Vitest passed 11/11. | Pass |
| LV-05 | Python sidecar regular venv | Developer | `verify:local` runs regular sidecar tests. | 88 passed / 1 skipped. | Pass |
| LV-06 | Python sidecar ML venv | Developer | `verify:local` runs ML sidecar tests. | 88 passed / 1 skipped, with known `librosa` deprecation warning. | Pass |
| LV-07 | Sister renderer bundles | Developer | `verify:local` builds sister main/preload/karaoke/operator outputs. | Build completed; Vite emitted the known `svelte-dnd-action` resolve warning. | Pass |

## Defects surfaced + fixed

**D45 — LOW — Full local verification was not represented by a single root command**  
Symptom: The documented local gate required copying multiple commands from AGENTS.md and recent QA summaries. This increased the chance of omitting the Worker tests, ML Python suite, UI diagnostics, or sister renderer builds during future slices.  
Root cause: Root package scripts only covered partial `test` and build commands; the expanded release floor was procedural rather than encoded.  
Latency: Present since the local gate grew beyond the initial TypeScript/Python floor.  
Repro steps: Inspect `package.json`; before this change there was no script that ran the current local gate end to end.  
Evidence: New scripts live in [package.json](/Users/njabulomnisi/Projects/Dojo/worshipsync/package.json:32). Verification passed with the documented wrapper: `npm run verify:local` completed `tsc`, 765 root Vitest tests, UI diagnostics, Worker tests, both Python suites, and sister renderer builds.  
Fix proposal: Add root `check:ui`, `test:worker`, `test:py:ml`, and `verify:local` scripts, and point `test:py` at the project-managed sidecar venv for consistent local behavior.  
Fix status: Fixed and verified locally in this change.

## Network / data layer observations

- Network: No external services were required.
- Data layer: Worker tests use local mocks/bindings; Python and TypeScript tests use local fixtures.
- Console: Known warnings remain: npm `ENABLE_CLI`, Worker Vite CJS deprecation, ML `librosa` deprecation, and Vite's `svelte-dnd-action` resolve warning.

## Cumulative defect tally (if multi-pass)

| Pass | Defects | Critical | High | Medium | Low | Fixed in pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| CI quality gate coverage — 2026-06-06 | 1 | 0 | 0 | 1 | 0 | 1 |
| Local verify script — 2026-06-06 | 1 | 0 | 0 | 0 | 1 | 1 |

## Recommendations before production shipping

1. **MEDIUM:** Keep `verify:local` aligned with the release checklist whenever a new mandatory local gate is added.
2. **MEDIUM:** Add Electron smoke to a separate script once it is reliable enough to run without manual display setup.
3. **LOW:** Consider a CI job that calls equivalent named package scripts instead of duplicating command text, once runtime stays within the hosted timeout.

## Final verdict

The local verification floor is more repeatable after this pass because the full local gate is encoded in package scripts and proven by a live run. Production certification still depends on the external Gate C/D/E evidence.
