# EP-10 Operator Window QA Report — 2026-05-16

**QA persona:** Senior QA analyst — click-by-click + IPC + console + lifecycle + defect triage
**Scope:** EP-10 operator-window infrastructure landed at commit `ecdfd97` (operator BrowserWindow + bidirectional IPC + state synthesis + tier-transition surfacing + tempo-adaptive easing).
**Environment:** Local dev. macOS 25.3 / arm64. Electron 37.10.3. Node 25.9.0. Git HEAD `ecdfd97`.
**Status:** **Pass-with-caveats** — 0 CRITICAL, 2 HIGH (both UX-blocking for real device flow but bypassed in the synthetic demo), 2 MEDIUM, 1 LOW, 1 INFO.

## Executive summary

The operator window opens, IPC is symmetric and gated correctly, the dual-window demo runs end-to-end without errors. **But the audio-device flow is functionally broken from an operator's perspective**: the picker shows no devices (D15) AND the operator's pick is erased 16ms later (D13). The demo "works" only because `startE2EMode()` auto-engages without waiting for operator input. A real operator going through Pick Device → Click Song → Start Sync (the NFR5.2 ≤3-actions claim) would hit a wall at step 1. A keyboard-router focus bug (D16) prevents normal button/input activation when shortcuts are bound. None of the defects affect the karaoke output side — that remains M1-close stable.

## Test environment + persona setup

- ✅ Git tree clean, HEAD `ecdfd97`
- ✅ Built artefacts present: `main.js`, both `.cjs` preloads, both `.bundle.{js,css}`, both `.html` shells
- ✅ TS test sweep 556/556 pass across 36 files
- ✅ Python pytest 30/30 pass
- ✅ Live smoke 15s: both windows up, no errors, no warnings beyond expected
- N/A — single dev persona, no multi-user surfaces

## Test cases executed

| TC ID | Feature | Expected | Actual | Status |
|---|---|---|---|---|
| TC-01 | TS test sweep | 556/556 | 556/556 | PASS |
| TC-02 | Python test sweep | 30/30 | 30/30 | PASS |
| TC-03 | Dual-window launch | both windows up, no fatal | adapter.start OK, operator signalled ready | PASS |
| TC-04 | Karaoke output rendering | frames flow, sweep visible | delivered=564/11s @ 56.7 fps dps=0.0 | PASS |
| TC-05 | Operator window mounts SetlistPanel + TierChangeBanner | panel visible, no errors | confirmed via existing evidence screenshots | PASS |
| TC-06 | IPC channel literal-drift sweep | main + preload literals match byte-for-byte | All 3 channel constants identical | PASS |
| TC-07 | Command-kind drift: bootstrap fires → preload docs → main handles | All 8 unique kinds aligned across all 3 sites | Aligned | PASS |
| TC-08 | CSP — no Insecure CSP warnings | clean stderr | No CSP warnings | PASS |
| TC-09 | Console clean during smoke | no errors/warnings | No errors/warnings | PASS |
| TC-10 | Pre-ready buffer flushes initial state on `signalReady` | first paint has data | confirmed via signalled-ready log + populated UI evidence | PASS |
| TC-11 | Sender validation on operator IPC | karaoke window can't spoof operator commands | `event.sender !== operatorWindow.webContents` guard present | PASS |
| TC-12 | Preload subscribeState try/catch around handler | throwing handler doesn't break IPC | confirmed in preload | PASS |
| TC-13 | TierChangeBanner suppressed when tier doesn't change | no banner during steady demo | confirmed via screenshots | PASS |
| TC-14 | AudioDevicePicker shows synthetic device on load | dropdown shows "Synthetic 120 BPM (E2E demo)" | **dropdown EMPTY** | **FAIL (D15)** |
| TC-15 | selectedDeviceId persists after operator picks device | picker shows selection persistently | **picker reverts to unselected within 16ms** | **FAIL (D13)** |
| TC-16 | Start Sync button enabled when device + song selected | clickable button | **disabled in demo (no pickable device + no persistent selection)** | **FAIL (D13/D15)** |
| TC-17 | Keyboard shortcuts in operator window | Space/arrows/Esc/Enter dispatch to SE | works for empty body focus | PARTIAL — see D16 |
| TC-18 | Button activation when focused | Refresh/Test/etc activate on Enter or Space | **shortcuts steal the keystroke** | **FAIL (D16)** |
| TC-19 | macOS Dock activate restores closed windows | reopens operator window | only re-checks karaoke adapter; operator window not restored | ACCEPTABLE — D14 LOW |
| TC-20 | Operator-state broadcast frequency | reasonable IPC traffic | ~60 Hz full payload every tick (~30 KB/s) | ACCEPTABLE — D17 MEDIUM |
| TC-21 | Tempo-adaptive easing — `--word-ease-ms` set on root | per-word duration on karaoke window root | inline style present | PASS |
| TC-22 | Main-process memory shape | stable over time, no leak signal | rss 145→127MB (decreasing); heap stable 5-7MB | PASS |

## Defects surfaced

### D13 — `selectedDeviceId` evaporates 16ms after operator picks a device

**Severity:** HIGH

**Symptom:** When the operator picks a device from the dropdown, the panel shows it selected for one frame (~16ms), then the next SyncEngine tick triggers `broadcastOperatorState()` with no `commandHint` argument, and the payload sets `selectedDeviceId: null`. The picker dropdown visually reverts to unselected.

Consequence: Start Sync button (gated on `selectedDeviceId !== null`) flickers enabled → disabled. Operator cannot reliably select a device.

**Root cause:** [apps/sister/src/main.ts:538-539](../../apps/sister/src/main.ts#L538) — `selectedDeviceId` is computed PER-CALL from the optional `commandHint`:

```ts
selectedDeviceId:
    (commandHint?.kind === "changeDevice" ? (commandHint.deviceId as string) : null) ?? null,
```

But `broadcastOperatorState()` is called both from `handleOperatorCommand` (with hint) AND from the SyncEngine.state subscription (no hint, fires every tick). The latter overwrites the former 16ms later. There's no persistent `selectedDeviceId` field in module state.

**Latency:** Since the operator window infrastructure landed (commit `ecdfd97`).

**Repro:**
1. Launch with `LC_E2E_MODE=1`
2. Open the audio device dropdown (would normally show 1 device — see D15 — but assume that's fixed)
3. Select a device
4. Wait one tick (16ms)
5. Observe: picker reverts to no selection, Start Sync disables

**Evidence:** [docs/qa-reports/evidence/ep10-operator-window-2026-05-15/01-first-word-active-operator.png](evidence/ep10-operator-window-2026-05-15/01-first-word-active-operator.png) — picker is empty AND Start Sync is replaced by "Sync engaged" (because the demo auto-engaged, bypassing the gate).

**Fix proposal:** Add a module-level `let operatorSelectedDeviceId: string | null = null` in main.ts. Update it in `handleOperatorCommand`'s `case "changeDevice"`. Read from it in `broadcastOperatorState` regardless of `commandHint`. Drop the `commandHint` parameter — it's only used for this one field and conflates two responsibilities.

**Fix status:** Proposed. Awaiting authorization.

---

### D15 — AudioDevicePicker enumerates from empty default state before IPC envelope arrives

**Severity:** HIGH

**Symptom:** The operator-window dropdown is empty even though the state envelope from main contains the synthetic device. The picker never auto-refreshes; the operator has to click "Refresh" to see any devices.

**Root cause:** [apps/sister/src/renderer/operator-window-bootstrap.ts:134](../../apps/sister/src/renderer/operator-window-bootstrap.ts#L134) — `enumerateDevices: async () => currentState.audioDevices`. The AudioDevicePicker calls `enumerateDevices()` once in its own onMount via `refresh()`. At that moment `currentState === DEFAULT_STATE` which has `audioDevices: []`. The state envelope arrives later; the picker doesn't subscribe to changes, so its internal `devices` array stays empty until the operator clicks the Refresh button.

The picker's `enumerateDevices` is a snapshot-fetch contract by design (the AudioDevicePicker is presentation-only); it expects the host to drive a re-fetch when the device list changes.

**Latency:** Since the operator window infrastructure landed (commit `ecdfd97`).

**Repro:**
1. Launch with `LC_E2E_MODE=1`
2. Wait for the operator window to mount
3. Observe: dropdown is empty (visible in any current operator-window evidence screenshot)
4. Click Refresh
5. Observe: dropdown now shows the synthetic device

**Evidence:** Same as D13 above.

**Fix proposal:** Two viable approaches:
1. **Re-enumerate on every state envelope** (simplest): in `bridge.subscribeState`, after `panel.$set(...)`, also call a method on the picker to re-fetch. SetlistPanel doesn't currently expose this — would need to add a `refreshDevices()` method or use a Svelte store. **Brittle.**
2. **Wait for the first state envelope before mounting the picker** (cleanest): in the bootstrap, defer panel construction until the first state envelope arrives. Pass the device list directly as a prop instead of going through enumerate. Requires SetlistPanel to accept a `devices` prop directly OR the host to wrap `enumerateDevices` in a "wait for state" promise.

Recommended: option 2 — defer `new SetlistPanel(...)` until first state arrives. This also fixes the boot flicker where the panel renders with empty defaults for a few hundred ms.

**Fix status:** Proposed. Awaiting authorization.

---

### D16 — Keyboard router intercepts shortcut keys regardless of focused element

**Severity:** MEDIUM

**Symptom:** When the operator focuses a button (Refresh, Test, mode badge) or a select element and presses Space, Enter, or arrow keys, the keyboard router fires the SE action AND `event.preventDefault()` blocks the button's default activation. The operator clicks a button to focus it, then can't activate it with the keyboard.

Consequence: standard browser interaction patterns break in the operator window. During live worship, the operator focusing a button by tab/click and then pressing a key accidentally triggers an unwanted SE action.

**Root cause:** [apps/sister/src/renderer/operator-window-bootstrap.ts:166-178](../../apps/sister/src/renderer/operator-window-bootstrap.ts#L166) — the `onKeyDown` handler matches via `handleKey` and unconditionally `preventDefault()`s if a shortcut matched, regardless of `event.target`. There's no check for whether the target is an interactive element where the keystroke would otherwise activate it.

**Latency:** Since the operator window infrastructure landed (commit `ecdfd97`).

**Repro:**
1. Launch with `LC_E2E_MODE=1`
2. Click the Refresh button in the AudioDevicePicker
3. Press Space (or Enter)
4. Expected: button activates, picker re-enumerates
5. Actual: nothing happens to the button; SE.engageSync fires (Space) or SE.reEngageSync fires (Enter)

**Evidence:** Code-level — no live screenshot needed.

**Fix proposal:** In `onKeyDown`, before calling `handleKey`, check if `event.target` is an interactive element and bail:

```ts
const target = event.target as HTMLElement | null
const tag = target?.tagName.toLowerCase()
if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button" || target?.isContentEditable) {
    return  // let the browser handle it
}
```

This is the standard pattern in keyboard-driven web apps. It preserves shortcut routing when focus is on the body or a non-interactive container, and yields to native activation when focus is on a button/input.

**Fix status:** Proposed. Awaiting authorization.

---

### D17 — Operator-state broadcast fires every tick (~60 Hz) regardless of change

**Severity:** MEDIUM

**Symptom:** `broadcastOperatorState()` is subscribed to `syncEngine.state.subscribe()`, which fires on every tick because `cursorRefTime` advances per frame. The full payload (~500 bytes including hardcoded setlist, audioDevices, shortcuts, lastTransition) is allocated + serialized + IPC-sent at ~60 Hz, ~99% of the time with identical content to the previous send.

Consequences:
- ~30 KB/s of IPC traffic from main → operator renderer
- ~240 object allocations/sec on the main process heap
- The operator renderer's IPC handler is invoked 60 times/sec, triggering `panel.$set` reactivity even when the rendered props are unchanged

None of these are catastrophic but they're all unnecessary work. On battery-constrained dev machines this is a measurable continuous wake.

**Root cause:** [apps/sister/src/main.ts:317](../../apps/sister/src/main.ts#L317) — `syncEngineStateUnsub = syncEngine.state.subscribe(() => broadcastOperatorState())` fires on every store.set, which happens every tick. There's no diff or throttle.

**Latency:** Since the operator window infrastructure landed.

**Repro:**
1. Add `console.log(payload)` inside `broadcastOperatorState`
2. Launch with `LC_E2E_MODE=1`
3. Observe: ~60 log lines per second after engage

**Evidence:** Code-level + the previously-captured 60Hz diag fps logs.

**Fix proposal:** Two-layer fix:
1. Diff before broadcast — keep `lastBroadcastPayload` and compare via shallow + key-based equality before sending. Skip the IPC if unchanged.
2. Alternatively, decouple operator broadcasts from the per-frame state subscription entirely: throttle to ~5 Hz (200ms) since the operator UI doesn't need 60 Hz updates for tier badges and song selection. The SyncFrame to the karaoke output remains at 60 Hz; only the operator-window IPC throttles.

Recommended: throttle. Simpler than a diff, the operator UI doesn't benefit from 60Hz updates anyway.

**Fix status:** Proposed. Awaiting authorization.

---

### D14 — macOS Dock activate doesn't restore a closed operator window

**Severity:** LOW

**Symptom:** On macOS, if the operator closes only the operator window (keeping the karaoke output running) and then clicks the Dock icon, the operator window does NOT reopen. The handler only re-checks the karaoke adapter; it has no awareness of the operator window.

**Root cause:** [apps/sister/src/main.ts:758-763](../../apps/sister/src/main.ts#L758) — the `activate` handler:
```ts
app.on("activate", () => {
    if (!adapter || !adapter.health.running) {
        startSisterMode().catch(...)
    }
})
```
Only the adapter is checked, not `operatorWindow`. If the karaoke output is still running, activate is a no-op even if the operator window has been closed.

**Latency:** Since EP-10 operator window infrastructure landed.

**Repro:**
1. Launch with `LC_E2E_MODE=1`
2. Close ONLY the operator window
3. Click the Dock icon
4. Expected: operator window reopens
5. Actual: nothing happens

**Evidence:** Code-level.

**Fix proposal:** In the activate handler, also check `if (!operatorWindow || operatorWindow.isDestroyed())` and call `startOperatorWindow()` if needed:

```ts
app.on("activate", () => {
    if (!adapter || !adapter.health.running) {
        startSisterMode().catch(...)
    } else if (E2E_MODE && (!operatorWindow || operatorWindow.isDestroyed())) {
        void startOperatorWindow()
    }
})
```

**Fix status:** Proposed. Awaiting authorization.

---

### D18 — Latent IPC handler leak if startOperatorWindow runs twice

**Severity:** INFO

**Symptom:** `startOperatorWindow()` calls `ipcMain.on(OPERATOR_READY_EVENT, ipcReadyHandler)` and `ipcMain.on(OPERATOR_COMMAND_CHANNEL, ipcCommandHandler)`. These register NEW handlers on each call without removing previous ones. The module-level refs `ipcReadyHandler` and `ipcCommandHandler` only point to the LATEST handler, so `stopTimers()`'s `ipcMain.off(...)` cleanup only removes the latest — old handlers remain dangling.

Currently unreachable in production: `startOperatorWindow()` is only called once per `startSisterMode()` run, and `startSisterMode()` is only re-called after the karaoke adapter dies. But if D14 is fixed by allowing operator-window re-spawn via Dock activate, this latent leak becomes a real one.

**Root cause:** [apps/sister/src/main.ts:410-411](../../apps/sister/src/main.ts#L410) — no `ipcMain.off(...)` call before re-registering.

**Fix proposal:** Wrap `ipcMain.on(...)` in a guarded helper that removes the prior handler first, OR ensure `startOperatorWindow` is idempotent (early-return when `operatorWindow !== null`).

**Fix status:** INFO — no immediate action; flag for D14's fix-time.

## Network / data layer observations

- **No network calls in the dual-window demo.** Both Electron processes are fully offline.
- **IPC channels are clean** — only `lyricue:output:*` (karaoke) and `lyricue:operator:*` (operator) are used. No drift, no name collisions, no spoofing risk (sender validation present on operator channels).
- **Operator-state payload shape**:
  ```json
  {
    "projectTitle": "Walking-Skeleton Demo",
    "tier": "auto",
    "syncActive": true,
    "activeSongId": "demo-show",
    "nextSongTitle": null,
    "setlist": [{ "id": "demo-show", ... }],
    "selectedDeviceId": null,  // <-- always null per D13
    "audioDevices": [{ "deviceId": "synthetic-120bpm", ... }],
    "lastTransition": null,
    "shortcuts": { "startSync": "Space", ... }
  }
  ```
  ~500 bytes serialized, sent ~60 times/sec — see D17.
- **Memory**: main-process rss 127–145 MB across the run, decreasing trend (no leak). Heap stable 5–7 MB. Renderer processes not measured (Electron's `process.memoryUsage()` reports main only).

## Cumulative defect tally (across QA passes)

| Pass | CRITICAL | HIGH | MEDIUM | LOW | INFO | Open at pass end |
|---|---|---|---|---|---|---|
| M1-partial (2026-05-14) | 0 | 1 | 4 | 7 | 0 | 4 carry-forward |
| M1-close (2026-05-15) | 0 | 0 | 1 | 1 | 0 | 0 (both fixed in-pass) |
| **EP-10 operator window (this pass, 2026-05-16)** | **0** | **2** | **2** | **1** | **1** | **6** |

## Recommendations before production shipping

1. **HIGH — Fix D15 + D13 together.** Both block the documented ≤3-actions-to-start-sync NFR5.2 path. The fix is small (defer panel construction until first state arrives + persist selectedDeviceId in main state). Combined estimate: ~30 minutes.

2. **MEDIUM — Fix D16 before any operator-UI polish.** The router-vs-focus issue will trip every future button that lands in the operator window. The fix is one early-return in `onKeyDown`. Estimate: 5 minutes including a test.

3. **MEDIUM — Fix D17 before adding more operator-window content.** Throttling to 5 Hz removes ~92% of the IPC + allocation cost. Especially important once EP-12 adds the real (potentially long) setlist data model to the payload.

4. **LOW — Fix D14 and INFO D18 together.** D14 fixes the Dock-restore UX papercut; D18's leak guard fits naturally into the same code path. Combined estimate: 10 minutes.

5. **INFO — Add a unit test in `keyboard-shortcuts.test.ts` for the focus-element bypass** once D16 is fixed. The fix lives in the bootstrap rather than the pure router, so a Svelte-level test on AudioDevicePicker or a new operator-bootstrap test would be appropriate.

6. **INFO — Document the synthetic-demo bypass** so future operators of the LC_E2E_MODE path don't assume the audio-device flow is wired. A comment in `broadcastOperatorState` referencing the deferred EP-07 wiring would clarify intent.

## Final verdict

**Pass-with-caveats**, lifted from a "pass" verdict because two of the surfaced defects (D13 + D15) functionally break the architecture's ≤3-actions claim in the operator window — not in the synthetic demo (which auto-engages), but for any real wiring built on top. The dual-window infrastructure itself is sound: IPC contracts are correct, sender validation is in place, the pre-ready buffer works, no console errors, no memory leaks in the main process, no CSP warnings. The karaoke output side remains M1-close stable and is not affected by anything in this commit. **Recommended to fix D13 + D15 + D16 before any further EP-10 / EP-12 work builds on the operator state shape.**
