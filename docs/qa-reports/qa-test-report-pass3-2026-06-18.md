# QA-test report — LyriCue adversarial pass 3 — 2026-06-18

**QA persona:** Senior QA engineer running `/qa-test` adversarial workflow against the surfaces deferred from pass 2.
**Scope:** Three deferred items — (A) Electron renderer-crash / intermediate-destroyed-state, (B) long-running SyncEngine + adapter leak profile, (C) per-caller writeFileAtomic EROFS/ENOSPC audit.
**Baseline:** Pass-2 closing commit `e0d7642` — 836 TS / 21 Worker / 97+97 Python tests passing.
**Status:** Pass after fix — 1 defect surfaced (LOW-MEDIUM). All resolved.

## Executive summary

Pass 3 closed the three deferred items from pass-2's "not tested" section. The session ended with one new defect (D-T12: `adapterClosed` double-emit on OS-close re-fire) and two clean audits (SE/adapter long-running, writeFileAtomic-caller EROFS). The SE and adapter showed no leak under compressed hour-long churn, and every writeFileAtomic caller correctly degrades under EROFS without corrupting prior persisted state.

The session-total now sits at **12 defects across 3 passes (2 CRITICAL, 2 HIGH, 1 MEDIUM-HIGH, 5 MEDIUM, 2 LOW)**, all closed.

## Passed (14 new adversarial scenarios)

| # | Scenario | Test |
|---|---|---|
| 1 | send throws while isDestroyed() returns false → drop + lastError, subsequent pushes also drop cleanly | [crash-race:104](apps/sister/src/output/OwnWindowOutputAdapter.crash-race.test.ts:104) |
| 2 | lastError clears after a successful frame following send-throw burst | [crash-race:131](apps/sister/src/output/OwnWindowOutputAdapter.crash-race.test.ts:131) |
| 3 | onRendererReady fired after stop() is ignored without throwing | [crash-race:160](apps/sister/src/output/OwnWindowOutputAdapter.crash-race.test.ts:160) |
| 4 | onClosed double-fire emits adapterClosed exactly once (D-T12 fix) | [crash-race:185](apps/sister/src/output/OwnWindowOutputAdapter.crash-race.test.ts:185) |
| 5 | re-entrant pushSyncFrame from adapterClosed listener is a clean drop | [crash-race:210](apps/sister/src/output/OwnWindowOutputAdapter.crash-race.test.ts:210) |
| 6 | pre-start loadTimingMap flushes with live outputId after start+ready | [crash-race:233](apps/sister/src/output/OwnWindowOutputAdapter.crash-race.test.ts:233) |
| 7 | SE hour-long compressed session: no stale-handler ghosts, no array fields, no position-correction residue | [sync-engine.long-running.test.ts:127](packages/core/src/sync/sync-engine.long-running.test.ts:127) |
| 8 | Adapter 1000-frame pre-ready burst: buffer cap=60 holds, 940 dropped + 60 delivered after ready, all counters finite | [adapter.long-running:80](apps/sister/src/output/OwnWindowOutputAdapter.long-running.test.ts:80) |
| 9 | Adapter 3600-frame post-ready run delivers 100%, no array on health, lastError null | [adapter.long-running:96](apps/sister/src/output/OwnWindowOutputAdapter.long-running.test.ts:96) |
| 10 | 5 stop/start cycles: adapterClosed listener fires 0 times on stop, 1 time on final OS close | [adapter.long-running:113](apps/sister/src/output/OwnWindowOutputAdapter.long-running.test.ts:113) |
| 11 | lastError stays scalar across 100 cycles (no error-history array accumulates) | [adapter.long-running:135](apps/sister/src/output/OwnWindowOutputAdapter.long-running.test.ts:135) |
| 12 | writeFileAtomic under EROFS: propagates error, no tempfile orphans, prior content preserved | [caller-audit:50](packages/core/src/fs/atomic-write.caller-audit.test.ts:50) |
| 13 | JsonFileStore.save() failure does not advance in-memory observable | [caller-audit:79](packages/core/src/fs/atomic-write.caller-audit.test.ts:79) |
| 14 | TimingMapStorage.save() failure leaves prior persisted map intact | [caller-audit:118](packages/core/src/fs/atomic-write.caller-audit.test.ts:118) |

Plus pass-1/pass-2 floor: 836 TS, 21 Worker, 97+97 Python — all still passing.

## Defects surfaced + fixed

### D-T12 — **LOW-MEDIUM** — adapterClosed event re-fires on double OS-close

**Symptom:** `OwnWindowOutputAdapter.#onWindowClosed` reset internal state and emitted `adapterClosed`, but did not guard against re-entry. Some Electron versions re-fire the `closed` event during the app-shutdown teardown sequence; the handler ran twice, emitted the event twice, and any upstream re-spawn handler attempted a second window re-spawn after the app was already shutting down.

**Root cause:** [OwnWindowOutputAdapter.ts:376](apps/sister/src/output/OwnWindowOutputAdapter.ts:376) — no idempotency check on `#onWindowClosed`.

**Latency:** Present since EP-02 (OutputAdapter walking skeleton). The double-emit was only reachable under app-shutdown timing, which existing tests didn't simulate.

**Fix:** Added early-return at the top of `#onWindowClosed`: when `#window === null && !#health.running`, the adapter is already torn down — no-op. First call performs teardown + emit; subsequent re-fires are silent.

**Verification:** 6 crash-race adversarial tests pass; all 25 pre-existing adapter tests still pass.

## Audits with no defects

### SyncEngine long-running session

Compressed 1-hour worship session: 3600 ticks (1 tick = 60 wall-frames), 10 subscribers churning subscribe/unsubscribe every 100 frames, tempoUpdate every 60 frames, vadUpdate alternating, positionCorrection every 20 simulated seconds, loadSong every 4 simulated minutes.

Verified invariants:
- After all subscribers unsubscribe, a fresh handler is the ONLY one that fires on a final tick — no stale handler ghosts in the `syncFrameHandlers`/`songCompleteHandlers` Sets.
- Snapshot field shape unchanged: no field is an array (any array field would be a candidate unbounded-growth point).
- Position-correction animation settled and cleared — no accumulation of stale correction state.

No defects. The SE's `Set`-based handler management is correctly bounded.

### OwnWindow adapter long-running

Three workloads:
1. 1000-frame pre-ready burst → 60 buffered (CAP holds), 940 dropped, exact accounting.
2. 3600-frame post-ready burst → 100% delivered, lastError null, all counters finite.
3. 5 stop/start cycles → no event accumulation, OS-close emits adapterClosed exactly once.

No defects. The adapter's `#pendingFrames` array is correctly capped at `PENDING_FRAME_BUFFER_CAP=60` with oldest-drop semantics.

### writeFileAtomic caller audit

Mapped the 5 production call sites:
- `packages/core/src/settings/json-file-store.ts:132` — settings, identity, library config (JsonFileStore.save)
- `packages/core/src/timing/timing-map-storage.ts:159` — migrated-map re-save
- `packages/core/src/timing/timing-map-storage.ts:193` — primary timing-map save
- `packages/core/src/timing/timing-map-storage.ts:318` — arrangement save
- `packages/core/src/setlist/project-storage.ts:32` — active-project save

For each caller, verified under EROFS (chmod 0o555 on target directory):
- Promise rejection propagates with a real Node ErrnoException (caller can inspect `err.code`).
- In-memory observable / cached state stays at the last-known-good value — no silent advance to an unpersisted value.
- Prior persisted file on disk is intact — failed save does not truncate or corrupt.
- No `.tmp*` orphans left behind (pass-2 D-T10 fix verified end-to-end).

No defects in the storage layer.

**One observability flag (not a defect):** The operator IPC handler at [apps/sister/src/main.ts:772-774](apps/sister/src/main.ts:772) catches `saveOperatorSelectedDeviceId` errors with `.catch(log)` — the error is logged but not surfaced to the operator UI. Under EROFS, the operator sees the in-memory `operatorSelectedDeviceId` update + the broadcast state reflects the new device, but on next app launch the saved value is the OLD one. This is a UX gap (operator confusion), not a data-loss defect (the prior value is still intact). Worth fixing alongside other EP-10 polish: surface save failures to the diagnostics panel or as a transient operator banner.

## Cumulative defect tally across all 3 passes

| Pass | Defects | Critical | High | Medium-High | Medium | Low | Status |
|---|---:|---:|---:|---:|---:|---:|---|
| Pass 1 (paths/SE/phrase-matcher/Worker) | 6 | 1 | 1 | 1 | 2 | 1 | All closed |
| Pass 2 (sidecar/atomic-write/adapter) | 5 | 1 | 1 | 0 | 3 | 0 | All closed |
| **Pass 3 (crash-race/leak/EROFS)** | **1** | **0** | **0** | **0** | **0** | **1** | **All closed** |
| **Session total** | **12** | **2** | **2** | **1** | **5** | **2** | **All closed** |

## Session test-floor growth

| Suite | Start of session | Pass 1 | Pass 2 | Pass 3 |
|---|---:|---:|---:|---:|
| TypeScript (Vitest) | 793 | 822 (+29) | 836 (+14) | **850 (+14)** |
| Publish Worker (Vitest) | 16 | 21 (+5) | 21 | 21 |
| Python sidecar regular venv | 88 | 88 | 97 (+9) | 97 |
| Python sidecar ML venv | 88 | 88 | 97 (+9) | 97 |

## Not tested (still deferred / external)

All items remaining after pass 3 are either external-infrastructure proofs or genuinely impossible to test without specialised harnesses:
- Real Cloudflare R2 / GitHub mirror behaviour under load (Gate C external).
- Signed/notarised packaged installers (Gate D external).
- Physical microphone tempo accuracy, projector display QA, live operator drills (Gate E external).
- Sidecar SIGTERM unresponsiveness during real Demucs C-bound inference (needs real ML run).
- FreeShow REST adapter against a live FreeShow process (Gate D external).
- Long-running rehearsal capture across 30+ minute real audio (hardware gate).

These remain documented in `docs/release-signoff-checklist.md` as the canonical external-proof gates.

## Residual risk

After three adversarial passes, the local LyriCue surface — pure-function modules, sidecar protocol, atomic-write substrate, OwnWindow adapter, sync engine, publish worker — is defended against every reachable hostile input, race condition, and fault-injection scenario this skill's heuristics cover. The biggest remaining risk class is the **integration boundary to external systems** that local tests cannot exercise.

Local test floor has grown **793 → 850 TS** (+57, +7.2%) and **88 → 97 Python** (+9, +10.2%) across the session. Every new adversarial test was deliberately scoped to surface a defect class rather than mirror the implementation's assumptions — the value of pass-1's CRITICAL path-traversal and pass-2's CRITICAL atomic-write race finds validates this stance: those defects survived hundreds of existing tests precisely because the existing tests reflected the implementer's safe-input assumptions.

## Final verdict

**Pass.** All pass-3 defects fixed and verified. The full `verify:local` gate is green:
- TypeScript: 850 tests across 92 files (was 793 at session start, +57 adversarial across all three passes)
- Publish Worker: 21 tests across 3 files (was 16, +5)
- Python sidecar regular venv: 97 passing, 1 skipped (was 88, +9)
- Python sidecar ML venv: 97 passing, 1 skipped (was 88, +9)
- svelte-check: 0 errors / 0 warnings
- Sister renderer + operator bundles build cleanly

LyriCue is in the strongest locally-shippable state it has been in this session. The five-gate release sign-off framework remains the correct ship gate: locally shippable with very high confidence; external proof of the C/D/E gates still pending.
