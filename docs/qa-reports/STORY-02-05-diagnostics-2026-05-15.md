# STORY-02.5 — Adapter health monitoring + diagnostics — Acceptance Summary

**Date:** 2026-05-15
**Epic:** EP-02 (Walking-skeleton OutputAdapter)
**Story:** STORY-02.5
**Status:** Implementation complete. AC1–AC4 verified. AC5 (in-renderer panel mount) deferred to operator-control-window epic (EP-06+).

## Scope

Build the diagnostics surface that combines the `OutputAdapter.health` snapshot with derived metrics (fps, dps, time-since-frame, memory, uptime) and exposes it to:

1. The main-process operator log (`stderr`)
2. A Svelte component (`@lyricue/ui/DiagnosticsPanel`) ready to be mounted in the operator's main control window when that lands

## Deliverables

| Artefact | Path | Status |
|---|---|---|
| `DiagnosticsSnapshot` type | `packages/core/src/diagnostics/diagnostics-snapshot.ts` | ✅ |
| `createDiagnosticsObserver` | `packages/core/src/diagnostics/diagnostics-observer.ts` | ✅ |
| Observer unit tests (13) | `packages/core/src/diagnostics/diagnostics-observer.test.ts` | ✅ All pass |
| `DiagnosticsPanel.svelte` | `packages/ui/src/DiagnosticsPanel.svelte` | ✅ |
| Panel unit tests (16) | `packages/ui/src/DiagnosticsPanel.test.ts` | ✅ All pass |
| Evidence snapshot generator (6 visual states) | `packages/ui/src/DiagnosticsPanel.evidence.test.ts` | ✅ |
| Sister main-process wiring | `apps/sister/src/main.ts` | ✅ |
| `@lyricue/core/diagnostics` subpath export | `packages/core/package.json` | ✅ |
| Diagnostics barrel | `packages/core/src/diagnostics/index.ts` | ✅ |

## Acceptance criteria

| AC | Description | Status | Evidence |
|---|---|---|---|
| AC1 | AdapterHealth updates in real time as frames flow | ✅ Pass | `delivered=0 → 239 → 480` in [diag log](evidence/story-02-05-diagnostics-2026-05-15/00-sister-mode-diag-log.txt) |
| AC2 | Diagnostics observer derives fps + dps + msSinceLastFrame | ✅ Pass | `fps=48.7 dps=0.0 since-frame=0ms` in diag log |
| AC3 | Memory + uptime captured for leak detection | ✅ Pass | `rss=125.7MB heap=5.2MB uptime=5s/10s` in diag log |
| AC4 | DiagnosticsPanel renders all observer states correctly | ✅ Pass | [6 HTML snapshots](evidence/story-02-05-diagnostics-2026-05-15/) covering healthy / waiting / drops / stalled / error / fork-mode |
| AC5 | Panel mounted in operator's main control window | 🟡 Deferred | The operator control window itself is part of EP-06 (renderer epic) and EP-04 (settings). Panel is ready to import. |

## Cross-cut checks

- **Frozen snapshot invariant** — verified in test "emits a frozen adapter snapshot": mutating `latest.adapter.framesDelivered` throws `TypeError`. Adapter state cannot leak through the observer.
- **dtMs = 0 defensive** — verified: forcing two samples with no clock advance produces `null` fps/dps, not `NaN` or division-by-zero.
- **Idempotent start** — verified: `obs.start()` twice does not double-fire the interval.
- **Stop detaches cleanly** — verified: after `obs.stop()` further `vi.advanceTimersByTime` produces no new emissions.
- **First-sample handling** — verified: first snapshot has `instantaneousFps = null` and `instantaneousDps = null` (no previous interval to delta against). Subsequent snapshots have full data. The panel renders these as em-dashes (`—`).

## Real-world observation

The diag log shows `fps=48.7` against a nominal 60fps target. This is a property of the **DemoSyncEngine** (which uses `setInterval(16.67ms)` and is bounded by Node main-thread scheduling), not the diagnostics observer. EP-09 (Sync Engine) will replace the demo engine with a rAF-driven loop in the renderer process; at that point fps should hit 60. The current measurement is correct — the diagnostics surface is doing its job by exposing the actual rate.

## Defect carry-forwards from M1 partial pass

| ID | Description | Status |
|---|---|---|
| D3 | Surface actual measured fps in diagnostics | ✅ **Closed by this story.** `instantaneousFps` is computed from delivered-frame deltas and exposed in both the stderr log and the Svelte panel. |
| D6 | KaraokeOutput gradient semantic inversion | Still open — slated for EP-06 STORY-06.1 |
| D7 | Defensive frame-shape validation | Still open — slated for EP-06 / EP-09 |
| D10 | Hardcoded outputId placeholder | Still open — slated for EP-06 |

## Test sweep results

```
 Test Files  13 passed (13)
      Tests  132 passed (132)
```

Full sweep run after wiring:
- `@lyricue/core`: 81 tests across 10 files
- `@lyricue/ui`: 22 tests across 2 files (16 behavioural + 6 evidence)
- `@lyricue/sister`: 20 tests
- `@lyricue/fork`: 9 tests

## Ship-readiness

STORY-02.5 is ready to merge. The diagnostics observer + panel form a complete operator surface for adapter health. The remaining UI integration (mounting `DiagnosticsPanel` in a real operator window) lives in the operator-control-window epic and does not block EP-02 closure.

EP-02 (the walking-skeleton OutputAdapter) is functionally complete at this point. Stories 02.1–02.5 have all landed. M1 close requires one final /qa-analyst pass against the full dual-mode demo path.
