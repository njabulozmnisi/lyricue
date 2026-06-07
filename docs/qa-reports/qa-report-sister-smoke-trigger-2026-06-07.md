# Sister Smoke Trigger QA Report — 2026-06-07
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** Sister-mode Electron smoke trigger semantics for `LC_SMOKE_TEST=1`.
**Environment:** Local sister-mode Electron app at `/Users/njabulomnisi/Projects/Dojo/worshipsync`; `LC_DEPLOYMENT_MODE=sister LC_E2E_MODE=1 LC_VERBOSE=1 LC_SMOKE_TEST=1`; isolated `LC_USER_DATA_DIR` under `/tmp`.
**Status:** Pass

## Executive summary

`LC_SMOKE_TEST=1` now runs the full Electron smoke exercise path by itself. One **HIGH** release-harness defect was surfaced and fixed: before this change the smoke flag launched the app but did not execute capture/operator/rehearsal assertions unless `LC_CAPTURE_EVIDENCE=1` was also set.

No **CRITICAL** defects were found.

## Test environment + persona setup

- Pass: Sister app was rebuilt before the smoke run.
- Pass: Node/Electron commands used the documented `env -i` Node 25 wrapper.
- Pass: Smoke run used isolated user data: `/tmp/lyricue-smoke-*`.
- Pass: Persona was the release engineer invoking the documented `LC_SMOKE_TEST=1` smoke path.
- Pass: Network and DB checks are not applicable; this is local Electron process control plus sidecar subprocess smoke.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| SMOKE-TRIGGER-01 | E2E smoke trigger | Release engineer | `LC_SMOKE_TEST=1` starts capture/smoke exercises without requiring `LC_CAPTURE_EVIDENCE=1`. | Smoke wrote capture logs, ran operator persistence, stale-payload guard, rehearsal capture, and exited pass. | Pass |
| SMOKE-TRIGGER-02 | Stale-payload guard | Release engineer | Smoke includes the EP18/EP19 stale-payload assertion. | Logged `stale-payloads-guarded`. | Pass |
| SMOKE-TRIGGER-03 | Rehearsal sidecar boundary | Release engineer | Smoke reaches sidecar `segment_rehearsal` and approves a matched segment. | Logged `captured-approved` and sidecar clean shutdown. | Pass |
| SMOKE-TRIGGER-04 | Sister build | Developer | Trigger change compiles into the Electron main bundle. | `npm run build:sister` passed. | Pass |

## Defects surfaced + fixed

**D45 — HIGH — `LC_SMOKE_TEST=1` did not trigger the smoke exercises by itself**  
Symptom: Launching the app with `LC_SMOKE_TEST=1` opened the E2E app and exited cleanly, but did not print capture, operator persistence, stale-payload, rehearsal, or `[smoke] complete: pass` lines unless `LC_CAPTURE_EVIDENCE=1` was also set.  
Root cause: `captureEp06Evidence()` was gated only by `LC_CAPTURE_EVIDENCE=1`. `SMOKE_TEST_MODE` affected assertions inside the capture path but did not enter that path.  
Latency: Present since the smoke harness split capture behavior from release-smoke assertions. The packaged smoke wrapper happened to set both flags, masking the defect for that script while leaving direct `LC_SMOKE_TEST=1` misleading.  
Repro steps: Before this fix, run `LC_DEPLOYMENT_MODE=sister LC_E2E_MODE=1 LC_VERBOSE=1 LC_SMOKE_TEST=1 electron apps/sister/dist-electron/main.js`; observe normal frame logs but no smoke exercise lines.  
Evidence: The trigger fix lives in [main.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/apps/sister/src/main.ts:282). Verified command without `LC_CAPTURE_EVIDENCE`: `LC_DEPLOYMENT_MODE=sister LC_E2E_MODE=1 LC_VERBOSE=1 LC_SMOKE_TEST=1 ... electron apps/sister/dist-electron/main.js`. The run logged `stale-payloads-guarded`, `captured-approved`, `[smoke] complete: pass`, and clean sidecar shutdown.  
Fix proposal: Treat `SMOKE_TEST_MODE` as sufficient to enter the capture/smoke path in both E2E and demo modes.  
Fix status: Fixed and verified locally in this change.

## Network / data layer observations

- Network: No outbound network calls are required for the smoke trigger.
- Data layer: Smoke used isolated `/tmp` user data and wrote no shared production state.
- Console: Renderer lifecycle and karaoke frame logs were expected. No smoke failure lines were emitted.

## Cumulative defect tally (if multi-pass)

| Pass | Defects | Critical | High | Medium | Low | Fixed in pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| EP18/EP19 stale IPC smoke — 2026-06-07 | 1 | 0 | 1 | 0 | 0 | 1 |
| Sister smoke trigger — 2026-06-07 | 1 | 0 | 1 | 0 | 0 | 1 |

## Recommendations before production shipping

1. **MEDIUM:** Keep release scripts on `LC_SMOKE_TEST=1`; `LC_CAPTURE_EVIDENCE=1` can remain only when screenshot artifacts are desired.
2. **MEDIUM:** Run the same direct smoke command on every platform where GUI automation is available before signing.

## Final verdict

This release-harness trigger slice is ready. Direct `LC_SMOKE_TEST=1` now means what it says: run the smoke assertions, report pass/fail, and quit.
