# EP-05 Model Cache Hooks QA Report — 2026-06-05
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** Production song-learning model cache/offline controls for Demucs and WhisperX loaders.
**Environment:** Local dev, macOS arm64, Python regular venv and Python 3.11 ML venv.
**Status:** Pass-with-caveats

## Executive summary
The production stage now exposes explicit local-cache hooks for Demucs, WhisperX ASR, and WhisperX alignment. This closes the code-level gap where a production run could silently rely on package-managed network downloads even after LyriCue performed a manifest/cache preflight. Full release proof still requires real packaged model directories and a cache-only production fixture run.

## Test environment + persona setup
- Pass: Regular venv suite: `77 passed, 1 skipped in 5.66s`.
- Pass: ML venv suite: `77 passed, 1 skipped, 1 warning in 5.83s`.
- Pass: Ruff check passed for the touched sidecar modules and tests.
- Not applicable: No browser, DB, auth persona, SSR/CSR, or privacy boundary is involved in this offline sidecar pass.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| EP05-MCH-001 | Demucs local repo hook | Local operator | Production vocal isolation can pass a local repo to Demucs | `isolate_vocals(..., model_repo=...)` calls Demucs `get_model(..., repo=...)` | Pass |
| EP05-MCH-002 | WhisperX ASR cache hook | Local operator | Production alignment can pass a local Faster Whisper cache root and cache-only mode | `align_vocals` forwards `download_root` and `local_files_only` to `whisperx.load_model` | Pass |
| EP05-MCH-003 | WhisperX alignment cache hook | Local operator | Production alignment can pass alignment model/cache options | `align_vocals` forwards model name, model dir, and cache-only flag to `whisperx.load_align_model` | Pass |
| EP05-MCH-004 | `learn_song` option contract | Local operator | `learn_song.options` can carry cache/offline settings into production stages | `test_learn_song_production_mode_uses_vocal_isolation_and_forced_alignment` asserts all cache options | Pass |
| EP05-MCH-005 | Env fallback contract | Packaged runtime | Packaged host can set cache options without changing renderer payload shape | `learn_song_handler` reads `LYRICUE_*` env fallbacks when options are omitted | Pass |

## Defects surfaced + fixed
D1 — **HIGH** — Production learning could use package-managed model downloads outside LyriCue's manifest/cache strategy.
Symptom: The real EP-05.8 fixture run downloaded Demucs and wav2vec2 model assets into package/user caches while LyriCue's manifest/cache manager remained separate from the actual model loaders.
Root cause: `python-sidecar/lyricue_sidecar/vocal_isolation.py` called Demucs `get_model(model_name)` without a local repo, and `python-sidecar/lyricue_sidecar/forced_alignment.py` called WhisperX loaders without cache roots or cache-only mode.
Latency: Existing tests used injected runners and fixture model downloads through `ensure_models`, so they proved stage contracts and manifest parsing but not actual runtime loader ownership.
Repro steps: Run the EP-05.8 opt-in fixture in a fresh ML cache and observe model downloads into package/user caches.
Evidence: `docs/qa-reports/qa-report-ep05-production-fixture-2026-06-05.md` documents the real download behavior.
Fix proposal: Add explicit Demucs repo, WhisperX download root, alignment model dir/name, and cache-only controls via `learn_song.options` and `LYRICUE_*` environment fallbacks.
Fix status: Fixed locally; release-owned model directory proof remains pending.

## Network / data layer observations
- Network: No network access was required for the verification tests in this pass. The previous EP-05.8 opt-in run remains the evidence that runtime loaders can otherwise download externally.
- Data layer: No database or persisted app data was touched.
- IPC/contract: Renderer payloads remain backward-compatible because the new fields are optional under `learn_song.options`; packaged hosts can use environment variables instead.

## Cumulative defect tally (if multi-pass)
| Pass | Defects | CRITICAL | HIGH | MEDIUM | LOW | INFO |
|---|---:|---:|---:|---:|---:|---:|
| EP-05.8 production fixture | 1 | 0 | 1 | 0 | 0 | 0 |
| EP-05 model cache hooks | 1 | 0 | 1 | 0 | 0 | 0 |

## Recommendations before production shipping
1. **HIGH** Build a real release model directory and rerun the EP-05.8 fixture with `LYRICUE_MODEL_CACHE_ONLY=1`.
2. **HIGH** Extend the host model manifest to describe loader-specific cache targets, not just generic artifact downloads.
3. **MEDIUM** Add a packaged-sidecar smoke that sets the `LYRICUE_*` cache variables and fails if any model loader attempts network access.

## Final verdict
The code-level hooks needed for offline model ownership are now present and test-backed, but Gate B still cannot close until a real model artifact layout is provisioned and proven with cache-only production learning.
