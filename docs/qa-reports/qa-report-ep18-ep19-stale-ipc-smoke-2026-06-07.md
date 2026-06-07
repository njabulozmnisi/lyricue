# EP18/EP19 Stale IPC Smoke QA Report — 2026-06-07
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** Electron smoke coverage for stale operator arrangement and translation IPC payloads.
**Environment:** Local sister-mode Electron app at `/Users/njabulomnisi/Projects/Dojo/worshipsync`; `LC_DEPLOYMENT_MODE=sister LC_E2E_MODE=1 LC_VERBOSE=1 LC_SMOKE_TEST=1 LC_CAPTURE_EVIDENCE=1`; isolated `LC_USER_DATA_DIR` under `/tmp`.
**Status:** Pass

## Executive summary

The Electron smoke harness now sends stale arrangement and translation payloads through the real operator preload bridge and verifies the main process persists only authoritative timing-map sections/data. One **HIGH** QA coverage gap was closed. No **CRITICAL** defects were found.

This pass protects against the exact class of stale renderer draft and full-map overwrite defects previously found in EP-18 and EP-19.

## Test environment + persona setup

- Pass: Sister app was rebuilt before the Electron smoke run.
- Pass: Node/Electron commands used the documented `env -i` Node 25 wrapper.
- Pass: Smoke run used isolated user data: `/tmp/lyricue-smoke-*`.
- Pass: Personas were the live operator window and the main-process command handler receiving renderer IPC.
- Pass: Network and DB checks are not applicable; this is local Electron IPC plus filesystem-backed timing-map storage.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP18-SMOKE-01 | Stale arrangement section | Live operator | Arrangement save with one stale and one valid section persists only the valid section. | Smoke observed `stale-payloads-guarded`. | Pass |
| EP19-SMOKE-01 | Stale translation timing map | Live operator | Translation save cannot overwrite authoritative BPM/sections and drops stale parallel section IDs. | Smoke observed `stale-payloads-guarded`. | Pass |
| EP18/19-SMOKE-02 | Packaged smoke parser | Release engineer | Release summary fails if stale-payload guard did not run. | Parser now requires the `stale-payloads-guarded` signal. | Pass |
| EP18/19-SMOKE-03 | Existing persistence path | Live operator | Normal arrangement/translation persistence still passes before stale-payload assertions. | Smoke logged `operator persistence exercise result=persisted`. | Pass |
| EP18/19-SMOKE-04 | Type boundary | Developer | Main-process smoke harness and summary parser compile. | `npx tsc -b` passed. | Pass |

## Defects surfaced + fixed

**D44 — HIGH — Electron smoke did not prove stale arrangement/translation IPC guards**  
Symptom: Unit tests covered stale arrangement and translation payload normalization, but the live Electron smoke path only tested normal operator persistence. A regression in renderer preload wiring, command dispatch, or main-process state rebroadcast could bypass those guards without failing release smoke.  
Root cause: `exerciseOperatorPersistence()` clicked the real modals and saved valid payloads, but no smoke step sent intentionally stale payloads through `window.lyricueOperator.sendCommand()`. The packaged smoke summary parser also had no required signal for this data-integrity assertion.  
Latency: Present since the stale-payload helper fixes landed; earlier QA reports explicitly recommended Electron smoke assertions for stale arrangement and translation payloads.  
Repro steps: Run the previous `LC_SMOKE_TEST=1 LC_CAPTURE_EVIDENCE=1` path. It would pass with normal operator persistence even if stale payload guard coverage was absent.  
Evidence: The new smoke step lives in [main.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/apps/sister/src/main.ts:1547). The release parser requires the guard in [packaged-smoke-summary.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/apps/sister/src/packaged-smoke-summary.ts:18), with regression coverage in [packaged-smoke-summary.test.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/apps/sister/src/packaged-smoke-summary.test.ts:35). Live smoke evidence line: `[lyricue:sister] [capture] stale operator payload guard result={"status":"stale-payloads-guarded"}` followed by `[lyricue:sister] [smoke] complete: pass`.  
Fix proposal: Extend the Electron smoke harness to subscribe to operator state, send intentionally stale arrangement and translation commands through the real preload bridge, verify normalized state after rebroadcast, and make packaged smoke summary parsing require the guard signal.  
Fix status: Fixed and verified locally in this change.

## Network / data layer observations

- Network: No network calls are made by this smoke assertion.
- Data layer: The smoke run used isolated userData under `/tmp`; no project library or shared production data was mutated.
- Console: Renderer console showed expected karaoke frame and `LC_LOAD_MAP` lifecycle logs. No smoke failure lines were emitted.

## Cumulative defect tally (if multi-pass)

| Pass | Defects | Critical | High | Medium | Low | Fixed in pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| EP18 arrangement IPC — 2026-06-06 | 1 | 0 | 1 | 0 | 0 | 1 |
| EP19 translation IPC — 2026-06-06 | 1 | 0 | 1 | 0 | 0 | 1 |
| EP18/EP19 stale IPC smoke — 2026-06-07 | 1 | 0 | 1 | 0 | 0 | 1 |

## Recommendations before production shipping

1. **MEDIUM:** Keep this stale-payload guard in every packaged release smoke run.
2. **MEDIUM:** Verify real FreeShow REST layout writeback once the sister-mode FreeShow control boundary is available.
3. **MEDIUM:** Add translated-primary timing-map learning before treating EP-19 as production-complete.

## Final verdict

This EP-18/EP-19 smoke slice is ready. The local Electron path now proves the stale-payload guards at the integration boundary rather than only in pure helper tests.
