# EP-04 Host Model Manifest QA Report — 2026-05-19
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** Electron/core host ownership of the production song-learning model manifest, manifest validation, required model injection into `learn_song`, and install-level mirror overrides.
**Environment:** Local dev; `/Users/njabulomnisi/Projects/Dojo/worshipsync`; TypeScript unit tests; Python sidecar regression tests; sister-mode Vite bundles.
**Status:** Pass-with-caveats

## Executive summary
The host now owns a typed model-manifest contract and can inject required Demucs/WhisperX model specs into production song-learning requests. The implementation avoids hard-coded fake checksums: real installs provide `LC_MODEL_MANIFEST_PATH`, with optional `LC_MODEL_MIRROR_URL` and `LC_REQUIRE_MODEL_MANIFEST`.

No product defects were surfaced. The remaining caveat is operational: production model downloading still needs a real signed/controlled manifest with actual artifact URLs and SHA256 hashes.

## Test environment + persona setup
- PASS: Repo was clean at start; branch `main`; starting HEAD `baf86b6`.
- PASS: TypeScript project compiled with the required isolated Node shell wrapper.
- PASS: Python sidecar regression suite remained clean after host changes.
- PASS: Sister karaoke and operator renderer bundles still build.
- N/A: No DB, migrations, login persona, Redis, MinIO, or mail services apply to this local host/sidecar boundary.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| TC-01 | Manifest parser | Host app | Accepts `lyricue-model-manifest-v1` with valid models and mirror URL | Parsed manifest with Demucs + WhisperX entries | PASS |
| TC-02 | Manifest checksum validation | Host app | Rejects malformed SHA256 before sidecar request | Invalid hash throws schema error | PASS |
| TC-03 | Required model resolution | Host app | Selected Demucs/WhisperX models map to sidecar `requiredModels` | Produced htdemucs + small specs with lowercase checksums | PASS |
| TC-04 | Mirror override | Installer/operator config | Install override beats manifest mirror | `LC_MODEL_MIRROR_URL` equivalent selected as `modelMirrorUrl` | PASS |
| TC-05 | Missing selected model | Host app | Missing manifest entry fails before sidecar request | Throws named missing model error | PASS |
| TC-06 | Deterministic learning path | Operator | Deterministic `learn_song` payload is unchanged | Helper returns the original payload | PASS |
| TC-07 | Optional manifest behavior | Operator | Production payload remains unchanged if no manifest is configured and manifest is optional | Helper returns original payload | PASS |
| TC-08 | Required manifest behavior | Installer/operator config | Production learning fails when manifest is required but absent | Helper throws model-manifest error | PASS |
| TC-09 | Electron wiring | Operator | Main process lazily loads manifest only for production learning and passes enriched payload to sidecar | `apps/sister/src/main.ts` calls manifest injection before `learn_song` request | PASS |

## Defects surfaced + fixed
None.

## Network / data layer observations
- Network posture stays explicit: no model download happens in Electron. Electron only injects model specs and mirror URL into the sidecar request.
- Literal-drift check: model names are sourced from operator payload/defaults and matched against manifest entries by `kind + model`; missing values fail locally rather than silently falling back.
- IPC contract check: payload enrichment preserves existing `learn_song` request shape and only adds `options.requiredModels` / `options.modelMirrorUrl` for `alignmentMode: "production"`.
- Privacy boundary: no user or organization identity is included in the manifest contract.
- Schema-drift check: no DB/ORM schema applies; manifest schema is Zod-validated in core.

## Cumulative defect tally (if multi-pass)
| Pass | Defects | CRITICAL | HIGH | MEDIUM | LOW | INFO |
|---|---:|---:|---:|---:|---:|---:|
| EP-04 host model manifest | 0 | 0 | 0 | 0 | 0 | 0 |

## Recommendations before production shipping
1. **HIGH:** Publish a real controlled model manifest with actual Demucs/WhisperX artifact URLs and SHA256 hashes, then run one external-network mirror smoke test.
2. **MEDIUM:** Add operator settings UI for model manifest path/mirror once installer configuration is finalized.
3. **MEDIUM:** Add an installer fixture manifest to CI so the host-side schema stays pinned without reaching external mirrors.

## Final verdict
Ship this host-manifest increment. It closes the code-side contract between Electron and the sidecar model downloader without inventing unverifiable model hashes. Production readiness still depends on provisioning the real manifest and mirror artifacts.
