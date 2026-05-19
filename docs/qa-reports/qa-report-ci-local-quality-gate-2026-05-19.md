# CI Local Quality Gate QA Report — 2026-05-19
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** Initial GitHub Actions quality gate for the current monorepo: Node/Python install, TypeScript build, TS tests, Python sidecar tests, and sister renderer builds.
**Environment:** Local macOS dev for workflow review and command verification; target CI runner `macos-14`.
**Status:** Pass-with-caveats

## Executive summary
The repository now has a first GitHub Actions quality gate at `.github/workflows/ci.yml`. No defects were surfaced in this pass.

This is intentionally not the full signed installer matrix from STORY-01.3. It is the pragmatic gate that matches the current local proof: build/test the shared code, sidecar, and sister renderers before changes reach `main`.

## Test environment + persona setup
- Pass: Repository was on `main` after `f738160 test:(#EP-05): add sidecar learn song subprocess smoke`.
- Pass: Workflow YAML was reviewed locally.
- Pass: Local verification used the required `env -i` Node wrapper and existing Python `.venv`.
- Pass-with-caveat: The workflow itself was not run on GitHub Actions from this environment.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| CI-TC-01 | Workflow triggers | Developer | CI runs on pull requests and pushes to `main`. | Workflow declares `pull_request` and `push.branches=[main]`. | Pass |
| CI-TC-02 | Dependency setup | Developer | Node and Python dependencies install in isolated CI runner. | Workflow uses `actions/setup-node@v4`, `npm ci`, `actions/setup-python@v5`, and creates `python-sidecar/.venv`. | Pass |
| CI-TC-03 | Local quality floor | Developer | CI executes TypeScript build, TS tests, Python tests, and sister renderer builds. | Workflow runs `npx tsc -b`, `npm run test:ts`, `pytest -q`, karaoke Vite build, and operator Vite build. | Pass |
| CI-TC-04 | Sidecar integration precondition | Developer | TS sidecar integration test can find `python-sidecar/.venv/bin/python`. | Workflow creates `.venv` at that exact path before `npm run test:ts`. | Pass |
| CI-TC-05 | Local verification | Developer | Changed workflow does not hide a local regression. | `tsc -b` passed, Python sidecar tests passed 68/68; prior increment already had TS tests and renderer builds clean. | Pass |

## Defects surfaced + fixed
No new defects were surfaced in this pass.

## Network / data layer observations
- CI uses GitHub-hosted dependency downloads for npm and pip; no application runtime network calls are introduced.
- No persistent app data or secrets are required for this gate.
- Code-level evidence: workflow lives at `.github/workflows/ci.yml:1`.
- Code-level evidence: Python `.venv` creation precedes TS tests at `.github/workflows/ci.yml:36`, preserving the sidecar integration test’s venv lookup contract.

## Cumulative defect tally (if multi-pass)
| Pass | New defects | Critical | High | Medium | Low | Current status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| CI local quality gate | 0 | 0 | 0 | 0 | 0 | Pass-with-caveats |

## Recommendations before production shipping
1. **HIGH** Add the full installer/package matrix once FreeShow native vendor prerequisites and signing/notarization secrets are available.
2. **HIGH** Add branch protection in GitHub so `main` requires this CI workflow to pass.
3. **MEDIUM** Add Linux and Windows test-only matrix jobs after the sidecar integration test has a cross-platform venv path strategy.
4. **MEDIUM** Add renderer performance smoke to CI once the Playwright/Electron harness is stable headlessly.

## Final verdict
The CI local quality gate is ready as the first enforceable hosted check. It does not claim full release packaging coverage, but it protects the build/test floor that has been used for every recent LyriCue increment.
