# EP-17 Rehearsal Summary Hardening QA Report — 2026-05-19

**QA persona:** Senior QA analyst — stop-capture integration + summary normalization + local gate verification
**Scope:** Gate A EP-17 hardening for captured WAV stop → sidecar segmentation → operator summary.
**Environment:** Local dev, macOS arm64, Node 25 via isolated shell wrapper, Python sidecar venv.
**Status:** Pass

## Executive summary

The rehearsal stop path is hardened. Segmentation now builds setlist lyrics from disk-backed timing maps instead of only the in-memory demo cache, and the renderer surfaces explicit summary rows for sidecar failures or recordings with no detected song segments. No defects were surfaced in this pass.

This pass improves failure visibility and restart resilience; physical microphone and long-duration rehearsal QA remain hardware gates.

## Test environment + persona setup

- Local repository: pass, branch `main`.
- Node/Electron shell isolation: pass, all Node commands used the documented `env -i` wrapper.
- Python sidecar environment: pass, `.venv/bin/pytest` completed successfully.
- Persona: operator stopping a rehearsal capture and reviewing segmentation output.
- Persistence boundary: pass, segmentation can use locally persisted timing maps for active project songs.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| TC-E17-RS-001 | Matched/review segment normalization | Operator | Sidecar segment rows map to UI rows with timing, confidence, status, and source path. | `rehearsal-segments.test.ts` verified matched and review rows. | Pass |
| TC-E17-RS-002 | Segmentation failure summary | Operator | Sidecar error appears as a failed summary row, not a generic fallback. | `Segmentation failed: decode failed` is rendered as failed. | Pass |
| TC-E17-RS-003 | Empty segmentation summary | Operator | No detected segments produces an explicit review row with recording duration. | Empty result renders `No song segments detected in 2:05 recording`. | Pass |
| TC-E17-RS-004 | Summary metadata display | Operator | Segment rows show time range and confidence for triage. | `RehearsalSummary.test.ts` verifies `0:01-1:05` and `90%`. | Pass |
| TC-E17-RS-005 | Disk-backed lyrics for segmentation | Operator | Rehearsal segmentation can use timing maps loaded from disk-backed storage. | Main now calls `loadDemoTimingMap()` per active setlist song. | Pass |
| TC-E17-RS-006 | Full local gate | Developer/operator | Tests, type checks, Svelte diagnostics, Python tests, and renderer bundles remain clean. | 703 TS tests, 77 Python tests, `tsc -b`, `svelte-check`, and both sister bundles passed. | Pass |

## Defects surfaced + fixed

None.

## Network / data layer observations

- No outbound network calls are used by rehearsal segmentation.
- Stop-capture still discards the session before sidecar segmentation begins, so capture resources are released even if segmentation fails.
- Sidecar errors are transported as structured summary data instead of being hidden behind a generic review message.
- Disk-backed timing maps are now part of the segmentation input path, aligning EP-17 with the EP-12 local project store.

## Cumulative defect tally

| Pass | Critical | High | Medium | Low | Info |
| --- | ---: | ---: | ---: | ---: | ---: |
| EP-17 rehearsal summary hardening — 2026-05-19 | 0 | 0 | 0 | 0 | 0 |

## Recommendations before production shipping

1. **HIGH:** Run a physical microphone rehearsal QA pass with a 10+ minute capture, real silence gaps, and at least two songs.
2. **MEDIUM:** Include rehearsal capture in the Electron operator smoke harness: start, stream synthetic chunks, stop, display summary, approve a matched segment, and verify the rehearsal timing-map variant is selectable.

## Final verdict

The stop-capture-to-summary path is hardened enough for Gate A. Operators now get actionable summary rows for success, review, no-segment, and sidecar failure outcomes, and segmentation uses the durable timing-map source.
