# Gate A Local MVP Close QA Report — 2026-06-05
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** Sister-mode local MVP across Learn Song, timing review, disk-backed setlist, rehearsal capture/summary, operator IPC, karaoke output, and Electron smoke harness.
**Environment:** Local dev; macOS arm64; Node 25 via isolated shell wrapper; Python sidecar venv; Electron dual-window E2E mode with `LC_SMOKE_TEST=1`.
**Status:** Pass-with-caveats

## Executive summary

Gate A is locally closed. Zero **CRITICAL** defects and zero open local walking-skeleton defects were surfaced in this close pass. The sister-mode app passed full local CI plus a real Electron dual-window smoke run that exercised operator hydration, command IPC, Learn Song, persistence, rehearsal capture, sidecar segmentation, and karaoke output.

The caveats are external release gates, not local Gate A blockers: production ML accuracy, physical microphone QA, packaged installers, Cloudflare/GitHub publishing credentials, code signing, and fork-mode FreeShow vendor SDK verification remain pending.

## Test environment + persona setup

- Repository: pass, branch `main`; only the known ignored agent-artifact directory remains untracked.
- Node/Electron environment: pass, every Node/Electron command used the documented `env -i` wrapper.
- Python sidecar: pass, `.venv/bin/pytest -q` completed successfully.
- Operator persona: pass, local sister-mode operator using synthetic 120 BPM input.
- Project data: pass, smoke used isolated `LC_USER_DATA_DIR` and removed temporary runtime data after verification.
- Background services: not applicable for Gate A; no Redis, DB, MinIO, mail, or queue dependency exists in the local MVP.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| TC-GA-001 | Full TypeScript test gate | Developer/operator | All TS unit/integration tests pass. | 703 tests passed across 67 files. | Pass |
| TC-GA-002 | Python sidecar gate | Developer/operator | Sidecar tests pass. | 77 tests passed. | Pass |
| TC-GA-003 | Svelte diagnostics | Developer/operator | UI has no Svelte diagnostics. | `svelte-check` found 0 errors and 0 warnings. | Pass |
| TC-GA-004 | Sister renderer bundles | Developer/operator | Karaoke and operator bundles build. | Both Vite builds passed; existing dependency warning only. | Pass |
| TC-GA-005 | Electron dual-window hydration | Operator | Karaoke and operator windows render and receive state. | `LC_SMOKE_TEST=1` captured four karaoke/operator states. | Pass |
| TC-GA-006 | Karaoke output runtime | Operator | Real SyncEngine frames reach renderer with no smoke failure. | Smoke showed about 57-58 fps and `dropped=0`. | Pass |
| TC-GA-007 | Learn Song wizard | Operator | Wizard opens, accepts lyrics, reaches manual preview, and finishes. | Smoke result `learn-song-complete`. | Pass |
| TC-GA-008 | Timing review editor | Operator | Timing map boundaries can be edited and saved. | Component test adjusts word end/start and calls save callback. | Pass |
| TC-GA-009 | Disk-backed active setlist | Operator | Active project and learned timing maps persist through local storage. | `ProjectStorage` tests and smoke persistence path passed. | Pass |
| TC-GA-010 | Arrangement/translation persistence IPC | Operator | Operator commands persist and reload active state. | Smoke result `persisted`; main logged `saveArrangement` and `saveTranslation`. | Pass |
| TC-GA-011 | Rehearsal capture and segmentation | Operator | Synthetic WAV capture stops, sidecar segments, and approval succeeds. | Smoke result `captured-approved`; sidecar returned `segments_ready`. | Pass |
| TC-GA-012 | IPC/channel drift sweep | Operator/developer | Channel constants, sender validation, and pre-ready buffer align. | Main/preload constants match; privileged handlers validate `event.sender`; pre-ready state buffer remains. | Pass |

## Defects surfaced + fixed

None in this close pass.

Previously fixed during Gate A hardening:

- D13-D18 from the EP-10 operator pass were already closed before this close pass.
- EP-11 production controls and timing review gaps were closed.
- EP-12 demo-only active project state was replaced with disk-backed local project storage.
- EP-17 generic/noisy rehearsal summary fallbacks were hardened.
- The Electron smoke path now fails nonzero on smoke failures instead of producing screenshots only.

## Network / data layer observations

- Network: no outbound network calls are required for Gate A local MVP.
- IPC: `lyricue:operator:*` channel constants align across main and preload; renderer calls only through the exposed preload bridge.
- Sender validation: privileged `ipcMain.handle` paths reject calls not sent by the operator window webContents.
- Pre-ready buffering: operator state still uses last-write-wins buffering until the renderer signals ready.
- Data persistence: active project, timing maps, arrangements, and settings use atomic write paths.
- Runtime data: smoke-created WAV, project, arrangement, and timing-map files were isolated under `.tmp/smoke-user-data` and removed after the pass.

## Cumulative defect tally (if multi-pass)

| Pass | Critical | High | Medium | Low | Info |
| --- | ---: | ---: | ---: | ---: | ---: |
| EP-11 production learning evidence | 0 | 0 | 0 | 0 | 1 |
| EP-11 timing review editor | 0 | 0 | 0 | 0 | 1 |
| EP-12 disk-backed setlist | 0 | 0 | 0 | 0 | 0 |
| EP-17 rehearsal summary hardening | 0 | 0 | 0 | 0 | 0 |
| Electron operator smoke harness | 0 | 0 | 0 | 0 | 0 |
| Gate A local close | 0 | 0 | 0 | 0 | 0 |

## Recommendations before production shipping

1. **HIGH:** Gate B must run real Demucs/WhisperX learning with a pinned model manifest and public-domain audio fixture before claiming production timing accuracy.
2. **HIGH:** Run physical microphone/loopback QA with real silence gaps and live graceful-degradation drills before pilot use.
3. **HIGH:** Run packaged-app smoke using `LC_SMOKE_TEST=1` once installer builds and sidecar binary resources exist.
4. **MEDIUM:** Add CI support for the Electron smoke harness on macOS with a display server.
5. **MEDIUM:** Keep FreeShow REST project ingestion, Cloudflare/GitHub library proof, signing, and fork-mode SDK verification marked external-proof pending.

## Final verdict

Gate A is locally shippable for demos and continued development: the sister-mode walking skeleton is hardened, persistence-backed, smoke-tested through Electron, and clean on full local CI. It is not production-shippable for pilot churches until Gate B through Gate E external proofs are completed.
