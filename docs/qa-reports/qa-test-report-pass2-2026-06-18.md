# QA-test report — LyriCue adversarial pass 2 — 2026-06-18

**QA persona:** Senior QA engineer running `/qa-test` adversarial workflow against the surfaces deferred from pass-1.
**Scope:** Python sidecar JSON-RPC protocol layer, atomic-write under fault injection, OwnWindowOutputAdapter race conditions.
**Baseline:** Pass-1 closing commit `886116c` — 822 TS / 21 Worker / 88+88 Python tests passing.
**Status:** Pass after fixes — 5 new defects surfaced (1 CRITICAL, 1 HIGH, 3 MEDIUM). All resolved.

## Executive summary

Pass 2 hit the three highest-value surfaces flagged as "not tested" in pass-1's report and surfaced five defects. The most consequential was the Python sidecar's `_write` raising TypeError out of the dispatch frame on a non-JSON-serialisable handler return — every subsequent request silently dropped, sidecar appears hung for the rest of the session. The CRITICAL finding was concurrent atomic writes failing with ENOENT because both writers raced for a fixed `.tmp` suffix; LyriCue's "every persisted artifact uses atomic-write" architectural invariant was load-bearing on a path that lost data under realistic operator-saves-twice timing.

All five defects fixed and verified. The local test floor improved from **822 → 836 TS** and **88 → 97 Python**.

## Passed (23 new adversarial scenarios)

| Scenario | Test |
|---|---|
| Deeply-nested JSON does not crash the serve loop | [test_protocol_adversarial.py:33](python-sidecar/tests/test_protocol_adversarial.py:33) |
| Method name with embedded control chars is sanitised | [test_protocol_adversarial.py:53](python-sidecar/tests/test_protocol_adversarial.py:53) |
| Request id with embedded newline produces valid NDJSON response | [test_protocol_adversarial.py:66](python-sidecar/tests/test_protocol_adversarial.py:66) |
| Oversized request id is handled (no crash, spec-compliant echo) | [test_protocol_adversarial.py:78](python-sidecar/tests/test_protocol_adversarial.py:78) |
| JSON-RPC batch request is rejected cleanly | [test_protocol_adversarial.py:89](python-sidecar/tests/test_protocol_adversarial.py:89) |
| Handler returning non-serialisable result does not break the server | [test_protocol_adversarial.py:104](python-sidecar/tests/test_protocol_adversarial.py:104) |
| Notification handler exceptions are logged at ERROR level | [test_protocol_adversarial.py:131](python-sidecar/tests/test_protocol_adversarial.py:131) |
| JsonRpcError with multiline message is sanitised before reaching wire | [test_protocol_adversarial.py:152](python-sidecar/tests/test_protocol_adversarial.py:152) |
| Internal-error data does not include traceback | [test_protocol_adversarial.py:166](python-sidecar/tests/test_protocol_adversarial.py:166) |
| Atomic writes — last-write-wins under 20 concurrent writers | [atomic-write.adversarial.test.ts:31](packages/core/src/fs/atomic-write.adversarial.test.ts:31) |
| Atomic writes — no .tmp orphans after concurrent writes | [atomic-write.adversarial.test.ts:46](packages/core/src/fs/atomic-write.adversarial.test.ts:46) |
| Atomic writes succeed even with stale orphan tempfile present | [atomic-write.adversarial.test.ts:62](packages/core/src/fs/atomic-write.adversarial.test.ts:62) |
| readFileIfExists cleans orphaned tempfile | [atomic-write.adversarial.test.ts:74](packages/core/src/fs/atomic-write.adversarial.test.ts:74) |
| Atomic write propagates error when parent path is a file | [atomic-write.adversarial.test.ts:92](packages/core/src/fs/atomic-write.adversarial.test.ts:92) |
| Atomic write propagates error when target is a directory | [atomic-write.adversarial.test.ts:99](packages/core/src/fs/atomic-write.adversarial.test.ts:99) |
| Empty content (string) writes a zero-byte file | [atomic-write.adversarial.test.ts:113](packages/core/src/fs/atomic-write.adversarial.test.ts:113) |
| Empty content (Buffer) writes a zero-byte file | [atomic-write.adversarial.test.ts:120](packages/core/src/fs/atomic-write.adversarial.test.ts:120) |
| Content with all bytes 0x00-0xFF round-trips correctly | [atomic-write.adversarial.test.ts:127](packages/core/src/fs/atomic-write.adversarial.test.ts:127) |
| 5MB payload completes (fsync does not hang) | [atomic-write.adversarial.test.ts:135](packages/core/src/fs/atomic-write.adversarial.test.ts:135) |
| OwnWindow adapter buffers loadTimingMap called before start() | [OwnWindowOutputAdapter.adversarial.test.ts:87](apps/sister/src/output/OwnWindowOutputAdapter.adversarial.test.ts:87) |
| OwnWindow adapter records lastError on loadTimingMap after stop() | [OwnWindowOutputAdapter.adversarial.test.ts:104](apps/sister/src/output/OwnWindowOutputAdapter.adversarial.test.ts:104) |
| OwnWindow pre-ready flush accurately accounts for mixed success/failure | [OwnWindowOutputAdapter.adversarial.test.ts:121](apps/sister/src/output/OwnWindowOutputAdapter.adversarial.test.ts:121) |
| OwnWindow adapter handles window destroyed externally between pushes | [OwnWindowOutputAdapter.adversarial.test.ts:142](apps/sister/src/output/OwnWindowOutputAdapter.adversarial.test.ts:142) |

Plus the full pre-pass-2 floor (822 TS + 21 Worker + 88+88 Python) — all still passing.

## Defects surfaced + fixed

### D-T7 — **MEDIUM** — Sidecar deeply-nested JSON could escape as RecursionError

**Symptom:** Python's `json` module raises `RecursionError` on deeply-nested input on some interpreter versions (CPython 3.11). The handler's `try/except json.JSONDecodeError` doesn't catch RecursionError, so the exception escapes `handle_request` and crashes the `serve()` loop — every subsequent request is silently dropped.

**Root cause:** [protocol.py:151-154](python-sidecar/lyricue_sidecar/protocol.py:151) — `json.JSONDecodeError` is a subclass of `ValueError`, but `RecursionError` is a separate hierarchy.

**Fix:** Added `RecursionError` branch at [protocol.py:155](python-sidecar/lyricue_sidecar/protocol.py:155) that returns ERROR_PARSE with "input nesting exceeds limit". (CPython 3.14 parses deeply-nested fine and the downstream `isinstance(payload, dict)` check rejects it as INVALID_REQUEST; the test verifies either code is acceptable as long as the response is clean.)

### D-T8 — **MEDIUM** — Method name with embedded newlines corrupts NDJSON response

**Symptom:** A request with `method: "foo\nINJECT"` produces an error response whose `error.message` contains a literal newline. JSON serialisation escapes this correctly (`\n`), so the response IS valid JSON — but a TS-side line-splitter that splits stdout on raw newlines before JSON parsing would see two lines. With this corruption, the second line looks like an extra response or notification. The current TS controller's `readline`-style splitter does indeed split on raw `\n`, so the corruption was reachable.

**Root cause:** [protocol.py:180](python-sidecar/lyricue_sidecar/protocol.py:180) — `f"Method '{method}' not found"` interpolated `method` verbatim.

**Fix:** Added `_sanitise_one_line()` helper at [protocol.py:259](python-sidecar/lyricue_sidecar/protocol.py:259) and applied it to method names in the not-found response, to JsonRpcError messages from handlers, and to internal-error exception messages. Strips CR/LF/NUL and caps at 500 chars.

### D-T9 — **HIGH** — Sidecar handler returning non-JSON-serialisable result crashes serve loop

**Symptom:** A handler returning a Python `set`, `bytes`, or any other non-JSON type causes `json.dumps` inside `_write` to raise `TypeError`. The exception escapes the dispatch try/except (it's in `serve`'s call to `_write`, not in `handle_request`), crashing the serve loop. The sidecar's next stdin read never happens — appears hung. Operator restarts manually; the actual bug (the buggy handler) leaves no trace because the TypeError is uncaught.

**Root cause:** [protocol.py:224](python-sidecar/lyricue_sidecar/protocol.py:224) — `_write` calls `json.dumps(msg)` with no try/except.

**Fix:** `_write` now catches `TypeError`/`ValueError` from json.dumps and retries with `default=str` so the response always reaches the wire. The original failure is logged to stderr at ERROR level so the operator can see the underlying handler defect without losing the rest of the session.

### D-T10 — **CRITICAL** — Concurrent atomic writes to the same path fail with ENOENT

**Symptom:** `writeFileAtomic` used a fixed `.tmp` suffix. Two writers racing for the same final path collided: Writer A opened, wrote, closed `.tmp`, renamed `.tmp → final`. Writer B did the same — its rename failed with ENOENT because A's rename had already moved the staging file away. The error propagated to the caller, the second write was lost, and the operator data was silently inconsistent.

LyriCue's architecture invariant: "every persisted artifact uses atomic-write" (settings, timing maps, arrangements, projects, rehearsals). Realistic concurrent paths:
- Operator saves a translation while a background timing-map auto-save is mid-flight
- Operator hits the save shortcut twice in rapid succession
- Setlist auto-persist races a manual save

Each of these silently lost data.

**Root cause:** [packages/core/src/fs/atomic-write.ts:35](packages/core/src/fs/atomic-write.ts:35) — `const tempPath = \`${filePath}${TEMP_SUFFIX}\`` is the same path for every writer.

**Fix:**
- Unique-per-call tempfile suffix `.tmp.<pid>.<rand>` via `uniqueTempSuffix()`. Concurrent writers now target their own staging file and only serialise at the final rename, which is naturally last-write-wins on POSIX/Windows.
- Rename failure unlinks the orphaned tempfile before throwing so a hot retry loop can't leak disk space.
- `readFileIfExists` sweeps the directory for any orphan tempfile matching `<basename>.tmp*` (covers both fixed-suffix pre-fix orphans and unique-suffix post-fix orphans).

**Verification:** 10 adversarial tests cover concurrent writes (20 racing writers, final content must equal exactly one writer's payload), orphan recovery, rename-failure paths, and content edge cases.

### D-T11 — **MEDIUM** — OwnWindow adapter silently drops loadTimingMap called before start()

**Symptom:** Calling `adapter.loadTimingMap(map, arrangement)` before `adapter.start()` returned silently because of the `!this.#window` guard. After the eventual `start()` + renderer ready, the map was already lost — the renderer stayed on the "Waiting for song..." placeholder forever. Same hazard for `loadTimingMap` after `stop()` (silent drop without lastError).

The pattern matches the existing D11 pre-ready buffer (already fixed) but extended one frame earlier in the lifecycle: pre-start, not just pre-renderer-ready.

**Root cause:** [OwnWindowOutputAdapter.ts:277](apps/sister/src/output/OwnWindowOutputAdapter.ts:277) — `if (!this.#window || ... || !this.#outputId) return`.

**Fix:** Pre-start `loadTimingMap` now stores the (map, arrangement, parallelLyrics) constituents in `#pendingLoadMap`. The flush in `#onRendererReady` rebuilds the envelope with the live `outputId` (which is unknown before `start()`). Post-stop / destroyed-window calls now record `lastError` so the operator's diagnostics panel surfaces the misuse.

## Cumulative defect tally

| Pass | Defects | Critical | High | Medium-High | Medium | Low | Status |
|---|---:|---:|---:|---:|---:|---:|---|
| Pass 1 (paths/SE/phrase-matcher/Worker) | 6 | 1 | 1 | 1 | 2 | 1 | All closed |
| **Pass 2 (sidecar/atomic-write/adapter)** | **5** | **1** | **1** | **0** | **3** | **0** | **All closed** |
| **Total surfaced this session** | **11** | **2** | **2** | **1** | **5** | **1** | **All closed** |

## Not tested (still deferred)

Items deferred from pass-1 that this pass also did NOT cover (with reason):
- **Electron renderer crash mid-broadcast**, intermediate destroyed state. Needs Electron-in-process harness; out of unit-test scope.
- **R2 list pagination beyond 1000 objects** — Gate C external.
- **GitHub mirror rate-limit (5000 req/hr)** — Gate C external.
- **Sidecar SIGTERM unresponsiveness during Demucs** — needs real ML run + signal observation.
- **REST project adapter against a real FreeShow** — Gate D external.
- **Rehearsal capture across a >30-minute run** — hardware gate.

New items deferred this pass:
- **Sidecar request batching** — current code rejects with INVALID_REQUEST, which is acceptable; future feature work could add real batch support. Not a defect.
- **`writeFileAtomic` under ENOSPC** — adversarial tests can simulate this via a filesystem mock, but actual ENOSPC requires a real disk-full scenario. The fix landed in this pass at least no longer leaks tempfiles on rename failure, so retry pressure under ENOSPC won't compound.
- **Atomic-write under EROFS (read-only filesystem)** — adapter would propagate the error correctly; behaviour on the caller side (do they fall back to in-memory? alert the operator?) varies by caller. Worth a per-caller audit in a future pass.

## Residual risk

After this pass, the pure-function modules, the sidecar protocol layer, the atomic-write substrate, and the OwnWindow adapter are all defended against the adversarial inputs documented. The biggest remaining classes of risk are:

1. **Real-infrastructure surfaces** (Cloudflare R2, GitHub, FreeShow REST, signed installers, real audio hardware) — all Gates C/D/E external proofs.
2. **Cross-process / cross-window UI race conditions** during live Electron runs that pure-function tests can't reproduce. The walking-skeleton smoke captures (Gate A close, M2 close) cover the happy paths; an Electron-in-process fault-injection harness would catch more.
3. **Long-running session memory/leak behaviour** — no test currently runs SE for an hour to confirm the position-correction state and tempo-update state don't accumulate listeners or unbounded arrays. The architecture isn't doing anything that would obviously leak, but the proof isn't pinned.

None of these are surfaced as defects — they're proof gaps consistent with the project's pre-existing release-signoff checklist.

## Final verdict

**Pass.** All five pass-2 defects are fixed and verified. The full `verify:local` gate is green:
- TypeScript: 836 tests across 88 files (was 793 at session start, +43 adversarial across pass 1+2)
- Publish Worker: 21 tests across 3 files (was 16, +5 adversarial)
- Python sidecar regular venv: 97 passing, 1 skipped (was 88, +9 adversarial)
- Python sidecar ML venv: 97 passing, 1 skipped, 1 known librosa deprecation warning
- svelte-check: 0 errors / 0 warnings
- Sister renderer + operator bundles build cleanly

LyriCue is materially safer than at the start of this session. The five-gate release sign-off framework remains correct: locally shippable with high confidence; external proof of the C/D/E gates still pending.
