# Gate D Sidecar Packaging QA Report — 2026-06-05

**QA persona:** Senior QA analyst — build artifact + subprocess smoke + launch-path verification
**Scope:** Local Gate D sidecar packaging slice: PyInstaller build script, packaged sidecar binary smoke, Electron production resource path resolution, and sister-app resource inclusion.
**Environment:** Local macOS arm64 development host; `/Users/njabulomnisi/Projects/Dojo/worshipsync`; clean Node wrapper; Python sidecar `.venv`.
**Status:** Pass-with-caveats

## Executive summary

The local macOS arm64 sidecar packaging path is now proven beyond code correctness: PyInstaller produces a `lyricue-sidecar` executable, the executable answers JSON-RPC `ping`, and Electron production path resolution now targets `process.resourcesPath/sidecar/<platform>-<arch>`.

One **MEDIUM** packaging defect surfaced during QA: the root `build:sidecar` script originally invoked a bare `python`, which fails under the project's clean environment. It was fixed to use the sidecar `.venv` interpreter. This is not a production release sign-off: multi-platform binaries, signing/notarization, and a Python 3.11 ML-runtime packaged binary remain release gates.

## Test environment + persona setup

- Branch/worktree: local working tree on `main`; local agent artifact directory ignored.
- Python build environment: `python-sidecar/.venv` with PyInstaller available.
- Node environment: clean wrapper with Homebrew Node 25 and workspace binaries.
- Packaged binary output: `/Users/njabulomnisi/Projects/Dojo/worshipsync/build/sidecar/darwin-arm64/lyricue-sidecar`.
- Personas: not applicable; this pass verifies release packaging and subprocess contracts.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| G-D-01 | Build-plan generation | Release engineer | Build plan targets `build/sidecar/<platform>-<arch>/lyricue-sidecar` | `python-sidecar/tests/test_build.py` passed | Pass |
| G-D-02 | PyInstaller build | Release engineer | Local macOS arm64 executable is produced | `python-sidecar/.venv/bin/python build.py` produced `build/sidecar/darwin-arm64/lyricue-sidecar` | Pass |
| G-D-03 | Packaged sidecar smoke | Runtime host | Binary emits `ready`, responds to `ping`, handles `shutdown`, exits 0 | JSON-RPC smoke passed with `pong: true` and clean shutdown | Pass |
| G-D-04 | Root script smoke | Release engineer | `npm run build:sidecar -- --dry-run` works under clean wrapper | Initially failed on bare `python`; fixed and rerun passed via `.venv/bin/python` | Pass after fix |
| G-D-05 | Electron production path resolver | Sister app host | Production launch resolves sidecar under Electron `resourcesPath` | Focused Vitest path resolver tests passed | Pass |
| G-D-06 | Regression floor | Developer | TS and Python suites remain green | `703` Vitest tests passed; Python sidecar `79 passed, 1 skipped` | Pass |

## Defects surfaced + fixed

### D-GD-01 — **MEDIUM**

Symptom: `npm run build:sidecar -- --dry-run` failed under the required clean Node wrapper with `sh: python: command not found`.

Root cause: The root `build:sidecar` script used a bare `python` command. The validated LyriCue environment intentionally isolates PATH and does not guarantee a `python` alias.

Latency: Introduced with the first packaging script. Unit tests covered the Python build plan but did not execute the root npm script under the clean wrapper.

Repro steps:

1. Run `env -i HOME="$HOME" PWD="$PWD" PATH="/opt/homebrew/opt/node@25/bin:$PWD/node_modules/.bin:/usr/bin:/bin" npm run build:sidecar -- --dry-run`.
2. Observe `sh: python: command not found`.

Evidence: Command output captured during this pass; fixed rerun prints the `.venv/bin/python -m PyInstaller` command and exits 0.

Fix proposal: Use the project sidecar venv interpreter in the root `build:sidecar` script.

Fix status: Fixed locally in `package.json`.

## Network / data layer observations

- No network was required for this packaging pass.
- No database or persistent application data was touched.
- PyInstaller emitted platform/library warnings during the actual build, including hidden-import suggestions and Windows-only library references while building on macOS. The resulting macOS arm64 executable still passed the JSON-RPC smoke.
- The packaged binary was built from the regular sidecar `.venv`, not the Python 3.11 ML venv with full Demucs/WhisperX runtime dependencies. That is a release-packaging caveat, not a local protocol smoke failure.

## Cumulative defect tally

| Pass | Critical | High | Medium | Low | Info | Status |
|---|---:|---:|---:|---:|---:|---|
| Gate D sidecar packaging local slice | 0 | 0 | 1 | 0 | 0 | Fixed locally |

## Recommendations before production shipping

1. **HIGH** Build the release sidecar from the Python 3.11 ML environment and run `learn_song` against the EP-05 production fixture from the packaged executable.
2. **HIGH** Add CI jobs that build and smoke sidecar binaries for macOS arm64/x64, Windows x64, and Linux x64/arm64.
3. **HIGH** Run the packaged sister app, not just the raw sidecar binary, and verify the Electron host launches the bundled sidecar from `process.resourcesPath`.
4. **MEDIUM** Decide whether PyInstaller warning noise should be suppressed or tracked as release-build hygiene once platform CI is live.

## Final verdict

The local Gate D sidecar-packaging slice is ready to commit. It proves the packaging script, darwin-arm64 binary smoke, and Electron resource-path wiring. Gate D as a production release gate remains open until multi-platform binaries, signing/notarization, packaged-app smoke, and full ML-runtime packaging are proven.
