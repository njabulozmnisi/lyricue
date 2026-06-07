# EP-04 Installer Model Manifest Fixture QA Report — 2026-06-08
**QA persona:** Senior QA analyst — file contract + schema drift + defect triage
**Scope:** Host-side model-manifest fixture used by installer/release jobs, specifically the production `loadModelManifestFile` parser path and downstream Demucs/WhisperX/Whisper.cpp model requirement resolution.
**Environment:** Local dev; `/Users/njabulomnisi/Projects/Dojo/worshipsync`; Vitest with the required isolated Node shell wrapper.
**Status:** Pass

## Executive summary
The model-manifest contract now has a real JSON fixture loaded through the production file parser, not only an in-memory object. No defects were surfaced in this pass.

The external production caveat remains unchanged: a real controlled model manifest with actual artifact URLs and SHA256 hashes is still required before production certification.

## Test environment + persona setup
- PASS: Working tree had only the known pre-existing `package-lock.json` modification and ignored `.claude/` artifact before this slice.
- PASS: Branch `main`; starting HEAD `70e40d2`.
- PASS: Focused Vitest run used the project-required `env -i` Node wrapper.
- N/A: No DB, login persona, browser, Redis, MinIO, mail, or external mirror service applies to this local file-contract pass.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| TC-01 | Installer manifest fixture file | Release host | JSON fixture loads through `loadModelManifestFile` | Loaded file equals the typed fixture manifest | PASS |
| TC-02 | Song-learning model resolution | Release host | Fixture resolves one Demucs and one WhisperX requirement | Returned two required models from the loaded file | PASS |
| TC-03 | Live STT model resolution | Release host | Fixture resolves one Whisper.cpp requirement | Returned one required model from the loaded file | PASS |
| TC-04 | Literal/schema drift sweep | Release host | Fixture literals match production parser enums and selected model names | `demucs`, `whisperx`, `whispercpp`, and fixture model names all parsed and resolved | PASS |

## Defects surfaced + fixed
None.

## Network / data layer observations
- Network posture stayed offline: the fixture uses a `file://` mirror URL and does not fetch artifacts.
- Data layer: no database applies.
- Schema-drift check: the JSON file is validated by the same Zod schema used by production manifest loading.
- Literal-drift check: model `kind` literals and selected model names are resolved through production lookup logic.

## Cumulative defect tally (if multi-pass)
| Pass | Defects | CRITICAL | HIGH | MEDIUM | LOW | INFO |
|---|---:|---:|---:|---:|---:|---:|
| EP-04 installer manifest fixture | 0 | 0 | 0 | 0 | 0 | 0 |

## Recommendations before production shipping
1. **HIGH:** Publish the real controlled model manifest with actual Demucs, WhisperX, and Whisper.cpp artifact URLs and SHA256 hashes.
2. **HIGH:** Run one external mirror smoke test against the real manifest and release-owned model artifacts.

## Final verdict
Ship this fixture increment. It closes the local CI gap for the installer manifest file shape, while keeping production model-mirror proof explicitly external.
