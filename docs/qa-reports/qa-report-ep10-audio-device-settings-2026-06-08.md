# EP-10 Audio Device Settings QA Report — 2026-06-08
**QA persona:** Senior QA analyst — settings hydration + operator command persistence + Electron smoke
**Scope:** Sister-mode operator audio input selection persistence through `LyriCueSettings.sync.audioInputDeviceId` and the Settings Sync panel display.
**Environment:** Local dev; `/Users/njabulomnisi/Projects/Dojo/worshipsync`; focused Vitest; TypeScript build; sister renderer build; Electron E2E smoke with temporary `LC_USER_DATA_DIR`.
**Status:** Pass

## Executive summary
The operator audio-device picker now persists through SettingsStore instead of living only in process memory. Startup hydrates the selected device from `settings.sync.audioInputDeviceId`, and the Settings Sync panel now shows the persisted device id without stale EP-07 copy.

One **MEDIUM** persistence defect was fixed. No **CRITICAL** or **HIGH** defects were found.

## Test environment + persona setup
- PASS: Branch `main`; starting HEAD `0abe31d`.
- PASS: Focused `SettingsTab` and packaged-smoke-summary tests passed.
- PASS: TypeScript build passed.
- PASS: `npm run build:sister` passed with the existing `svelte-dnd-action` Vite warning.
- PASS: Electron E2E smoke ran with a temp user-data directory and ended with `[smoke] complete: pass`.
- N/A: No DB, login persona, Cloudflare, GitHub, or physical microphone applies to this local persistence pass.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| TC-01 | Startup hydration | Operator | Main process uses persisted `sync.audioInputDeviceId` for operator state on startup | `startSisterMode()` loads settings and initializes `operatorSelectedDeviceId` from settings outside E2E synthetic mode | PASS |
| TC-02 | Device command persistence | Operator | `changeDevice` updates SettingsStore atomically | Electron smoke sent `changeDevice` and verified `api.getSettings().sync.audioInputDeviceId` became `synthetic-120bpm` | PASS |
| TC-03 | Settings Sync hydration | Operator | Sync settings panel renders the selected device id from settings | Component test renders `mic-1` and rejects stale EP-07 copy | PASS |
| TC-04 | Existing smoke paths | Operator | Settings bridge, stale payload, Learn Song, arrangement, translation, and rehearsal smoke still pass | Electron smoke ended with `[smoke] complete: pass` | PASS |

## Defects surfaced + fixed
**D-EP10-ADS-01 — MEDIUM**

Symptom: Selecting an audio device in the sister operator updated the live picker state, but the value was not saved to `LyriCueSettings.sync.audioInputDeviceId`; restart would lose the selection.

Root cause: `handleOperatorCommand("changeDevice")` only updated the module-level `operatorSelectedDeviceId` and broadcast state. The settings schema had an audio-device field, but sister mode did not write to it or hydrate from it on startup.

Latency: Present since D13 moved selected-device state into main process memory. Existing QA verified the selection no longer evaporated during tick broadcasts, but not restart persistence.

Repro steps: Select an audio device, quit, relaunch, and inspect `settings.json` or the Settings Sync panel. Before this fix, `sync.audioInputDeviceId` stayed `null`.

Evidence: The live smoke log shows `operator command: changeDevice` followed by `operator settings bridge result={"status":"settings-bridge-persisted"}`; that bridge now requires device persistence before returning pass.

Fix status: Fixed locally by hydrating startup state from SettingsStore and saving `changeDevice` through `saveOperatorSelectedDeviceId`.

## Network / data layer observations
- Network: none.
- Data layer: settings writes continue through the existing atomic JSON SettingsStore.
- IPC boundary: the device update still enters through the validated operator command channel; renderer code does not write settings directly for this action.

## Cumulative defect tally (if multi-pass)
| Pass | Defects | CRITICAL | HIGH | MEDIUM | LOW | INFO |
|---|---:|---:|---:|---:|---:|---:|
| EP-10 audio device settings | 1 | 0 | 0 | 1 | 0 | 0 |

## Recommendations before production shipping
1. **HIGH:** Run physical microphone QA to verify the persisted device id still resolves after OS device enumeration changes.
2. **MEDIUM:** Add a recovery path for stale device ids once physical hardware QA defines the desired operator prompt.

## Final verdict
Ship this EP-10 persistence increment. The selected operator audio device now survives through the settings layer, with focused component coverage and a live Electron smoke assertion on the command path.
