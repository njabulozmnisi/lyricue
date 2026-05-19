# EP-04 Model Download Manager QA Report — 2026-05-19
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** STORY-04.6 sidecar model cache/download manager, production `learn_song` model preflight, JSON-RPC method registration, checksum/resume/progress behavior.
**Environment:** Local dev; `/Users/njabulomnisi/Projects/Dojo/worshipsync`; Python sidecar unit/subprocess tests; TypeScript monorepo quality gate; sister-mode Vite bundles.
**Status:** Pass-with-caveats

## Executive summary
The model download manager contract is locally shippable. It validates model manifests, resolves per-install mirror URLs, resumes `.part` files, verifies SHA256 before cache install, emits JSON-RPC progress notifications, and lets production `learn_song` preflight required models before Demucs/WhisperX.

No product defects were surfaced in this pass. One test-harness defect class appeared during QA: the new fake downloader did not match the production `urlopen(..., timeout=30)` call shape. That was fixed before commit.

## Test environment + persona setup
- PASS: Repo was clean at start except the ignored agent-artifact directory; branch `main`; starting HEAD `9ab5e5c`.
- PASS: Sidecar model manager code exercised without real network by substituting deterministic fake downloader responses.
- PASS: Python venv available and testable through the required isolated shell wrapper.
- PASS: TypeScript workspace built through the required Node `env -i` wrapper.
- N/A: No user login, browser persona, DB, migrations, Redis, MinIO, or mail services apply to this sidecar-only contract.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| TC-01 | Manifest validation | Host controller | Missing/invalid `models` params fail with JSON-RPC invalid params | `parse_ensure_models_params` rejects missing list and malformed specs | PASS |
| TC-02 | Mirror URL resolution | Host controller | Model URL derives from `mirrorUrl/<name-version>/<artifact>` when explicit URL is absent | `https://mirror.example/models/htdemucs-v1/htdemucs-v1.bin` requested | PASS |
| TC-03 | SHA256 install gate | Host controller | Download installs only after digest matches expected SHA256 | Valid payload moved to `<modelsDir>/htdemucs-v1/htdemucs-v1.bin`; metadata written | PASS |
| TC-04 | Cache hit | Host controller | Existing matching artifact skips network and reports cached | Fake downloader was not called; result status `cached` | PASS |
| TC-05 | Resumable partial | Host controller | Existing `.part` sends `Range` and appends remaining bytes | Request used `Range: bytes=4-`; final cache artifact matched full payload | PASS |
| TC-06 | Checksum mismatch | Host controller | Bad payload is rejected and not installed | JSON-RPC model error returned with expected/actual digest data | PASS |
| TC-07 | Production learning preflight | Song-learning caller | `learn_song` production mode checks `requiredModels` before Demucs/WhisperX | `ensure_models` called with resolved models dir, mirror URL, and request context | PASS |
| TC-08 | Protocol registration | Electron main equivalent | Sidecar advertises and handles `ensure_models` | `__main__.py` registers `ensure_models` with request context and ready capabilities | PASS |

## Defects surfaced + fixed
- D1 — **LOW** — Test harness fake downloader did not accept the same keyword argument shape as production `urlopen`.
  - Symptom: Three new model-manager tests failed with `unexpected keyword argument 'timeout'`.
  - Root cause: Test doubles in `python-sidecar/tests/test_model_download.py` accepted positional `_timeout` while production calls `urlopen(request, timeout=30)` from `python-sidecar/lyricue_sidecar/model_download.py:199`.
  - Latency: Introduced in this pass; caught on first sidecar QA run.
  - Repro steps: Run `cd python-sidecar && .venv/bin/pytest -q` after the initial implementation.
  - Evidence: Pytest reported failures in `test_ensure_models_resumes_partial_download`, `test_ensure_models_rejects_checksum_mismatch`, and `test_ensure_models_handler_returns_protocol_shape`.
  - Fix proposal/status: Fixed in this increment by matching fake downloader signatures to production call shape; verified by `76 passed`.

## Network / data layer observations
- Network shape is explicit and bounded: `ensure_models` only opens a configured artifact URL or a URL derived from `mirrorUrl` / `LYRICUE_MODEL_MIRROR_URL`; no background or implicit download path was added.
- Resume behavior uses HTTP `Range` only when a partial file exists, and restarts from byte 0 when the server ignores the range and returns a full `200`.
- Cache layout now matches the architecture target: `<modelsDir>/<modelName>-<version>/<artifact>`, with `.downloads/*.part` used for interrupted downloads.
- Data integrity gate is SHA256-first: mismatched downloads are deleted and rejected before install.
- IPC/protocol surface is aligned: `ensure_models` is registered as a context handler, included in `ready.params.methods`, and emits standard `progress` notifications.

## Cumulative defect tally (if multi-pass)
| Pass | Defects | CRITICAL | HIGH | MEDIUM | LOW | INFO |
|---|---:|---:|---:|---:|---:|---:|
| EP-04 model download manager | 1 | 0 | 0 | 0 | 1 | 0 |

## Recommendations before production shipping
1. **HIGH:** Add host-side manifest ownership before enabling real model downloads by default. The sidecar now enforces URL/checksum/cache behavior, but Electron still needs to supply the canonical Demucs/WhisperX model manifest.
2. **MEDIUM:** Add a real mirror smoke test once Cloudflare R2 or Hugging Face model mirrors are configured. Current QA intentionally avoids external network and large model downloads.
3. **MEDIUM:** Surface `ensure_models` progress in the operator song-learning UI when production model manifests are wired, reusing the existing learn-song progress channel.

## Final verdict
Ship this increment as a local sidecar contract. STORY-04.6 is not fully production-complete until the host owns a real model manifest and mirror configuration, but the load-bearing sidecar behaviors needed for safe first-use model download are implemented and verified.
