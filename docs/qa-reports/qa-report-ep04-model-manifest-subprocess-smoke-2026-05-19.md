# EP-04 Model Manifest Subprocess Smoke QA Report — 2026-05-19
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** Fixture model manifest, JSON-RPC `ensure_models` subprocess smoke, local mirror install/cached round-trip, and regression coverage around the host/sidecar model-download contract.
**Environment:** Local dev; `/Users/njabulomnisi/Projects/Dojo/worshipsync`; Python sidecar subprocess tests; TypeScript manifest tests; sister-mode Vite bundles.
**Status:** Pass

## Executive summary
The model manifest/download path now has a real subprocess smoke test. A spawned sidecar installs two fixture model artifacts from a local `file://` mirror into `LYRICUE_MODELS_DIR`, emits progress notifications, and reports both artifacts as cached on a second request.

No defects were surfaced in this pass. The test deliberately avoids external model mirrors and heavyweight ML artifacts while exercising the real JSON-RPC transport and cache layout.

## Test environment + persona setup
- PASS: Repo was clean at start; branch `main`; starting HEAD `370811c`.
- PASS: Sidecar subprocess spawned from `python -m lyricue_sidecar`.
- PASS: `LYRICUE_MODELS_DIR` isolated to a temp directory.
- PASS: Fixture mirror used `file://` URLs; no outbound network involved.
- N/A: No login persona, DB, migrations, Redis, MinIO, or browser session apply to this sidecar subprocess smoke.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| TC-01 | Sidecar ready capabilities | Host controller | Ready notification advertises `ensure_models` | `ready.params.methods` included `ensure_models` | PASS |
| TC-02 | Fixture model install | Host controller | First `ensure_models` request installs both fixture artifacts | Response statuses were `downloaded`, `downloaded` | PASS |
| TC-03 | Cache idempotency | Host controller | Second identical request performs no download and reports cache hits | Response statuses were `cached`, `cached` | PASS |
| TC-04 | Progress notifications | Host controller / operator UI | Download/start/progress/install/cache events are emitted through JSON-RPC notifications | Observed two each of `model_download_start`, `model_download_progress`, `model_installed`, and `model_cached` | PASS |
| TC-05 | Cache bytes | Host controller | Installed artifact bytes match fixture mirror bytes | Cached Demucs and WhisperX fixture files matched source bytes | PASS |
| TC-06 | TS fixture manifest | Host/test harness | Fixture manifest remains schema-valid and resolves to sidecar specs | `model-manifest.test.ts` validates fixture manifest and expected specs | PASS |

## Defects surfaced + fixed
None.

## Network / data layer observations
- Network boundary: the test uses a local `file://` mirror and therefore proves downloader behavior without external HTTP dependencies.
- Cache layout: artifacts land at `<modelsDir>/fixture-demucs-v1/fixture-demucs-v1.bin` and `<modelsDir>/fixture-whisperx-v1/weights.bin`.
- Idempotency: the second `ensure_models` request returns cache hits and emits `model_cached` notifications instead of reinstalling.
- IPC contract: subprocess traffic uses the same JSON-RPC stdout/stdin framing as Electron's `SidecarController`.
- Privacy boundary: no identity, org, or operator data is present in the fixture manifest or sidecar requests.

## Cumulative defect tally (if multi-pass)
| Pass | Defects | CRITICAL | HIGH | MEDIUM | LOW | INFO |
|---|---:|---:|---:|---:|---:|---:|
| EP-04 model manifest subprocess smoke | 0 | 0 | 0 | 0 | 0 | 0 |

## Recommendations before production shipping
1. **HIGH:** Replace fixture artifacts with a controlled real model manifest and run one external mirror smoke in a release-prep environment.
2. **MEDIUM:** Add CI artifact upload for the fixture cache directory if this smoke ever becomes flaky, so download/cache state can be inspected.
3. **MEDIUM:** Surface `model_download_*` progress labels in the operator UI when production learning mode is exposed.

## Final verdict
Ship this verification increment. The host/sidecar model manifest path now has an end-to-end subprocess proof for download, checksum install, progress notification, and cache idempotency without relying on external services.
