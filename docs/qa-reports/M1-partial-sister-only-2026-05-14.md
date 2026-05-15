# LyriCue M1 Partial QA Report — Sister-Mode Surface Only — 2026-05-14

**QA persona:** Senior QA analyst — runtime verification + visual capture + network/data observation + cross-cut heuristics
**Scope:** Sister-mode rendering surface only, as produced by EP-02 STORY-02.3. Fork mode, FirstRunWizard, SettingsTab, real audio, real timing maps, and multi-output are explicitly out of scope for this pass.
**Environment:** macOS arm64 (Darwin 25.3.0), Apple Silicon, Electron 37.10.3, Node 25.9.0, local development build
**Status:** **Pass-with-caveats** — STORY-02.3 acceptance criteria all functionally verified end-to-end. 1 HIGH-severity defect in the renderer's gradient semantic (D6) that does not block STORY-02.3 close but is a known carry-forward into EP-06 (full Karaoke Renderer).

---

## Executive summary

The sister-mode app launches, opens a karaoke output BrowserWindow, mounts the `KaraokeOutput.svelte` Svelte component, and renders synthetic SyncFrames at a sustained ~52 fps with zero frame drops over 60 seconds. The IPC bridge (preload → renderer) is correctly scoped via `contextBridge.exposeInMainWorld`, and the renderer never receives `ipcRenderer` directly. The OutputAdapter contract's NFR2.1 zero-crash guarantee holds at runtime against 12 pathological frame inputs (NaN, Infinity, null, malformed shapes) without throwing.

**Defects surfaced:** 7 total — 0 CRITICAL, 1 HIGH (gradient semantic inversion), 2 MEDIUM (frame rate drift + adapter pass-through of malformed frames), 4 INFO.

**Architectural risk retired by this pass:** Sister-mode rendering path works end-to-end with real BrowserWindow + Electron IPC + Vite-built IIFE renderer + Svelte 3 component. The dual-mode parity claim (the architectural risk EP-02 is designed to retire) is **half-verified** — sister mode confirmed, fork mode pending STORY-02.4.

**Block status:** None of the surfaced defects block STORY-02.3 close. D6 is the only one that warrants follow-up before EP-06 begins, and it's a 2-line fix in the Svelte gradient stops.

---

## Test environment + persona setup

| Check | Status | Notes |
|---|---|---|
| Electron binary installed at `node_modules/electron/dist/Electron.app` | ✅ | v37.10.3 |
| Sister app artifacts present (main.js, preload, bundle, HTML, CSS) | ✅ | All present at expected paths |
| `tsc -b` clean across the monorepo | ✅ | No errors |
| `vitest run` clean — 82/82 tests pass | ✅ | 9 test files, 82 tests, including 20 OwnWindowOutputAdapter tests + 9 ForkOutputAdapter tests + 16 OutputAdapter contract/fixture tests |
| Wire-literal drift sweep (`OWN_WINDOW_CHANNEL`, `OWN_WINDOW_READY_EVENT`, `LC_SYNC_FRAME`, `LC_LOAD_MAP`) — preload vs adapter vs core | ✅ | All four literals match canonical sources in `@lyricue/core/output/sync-frame.ts` |
| Build SHA / working-tree state captured | ✅ | HEAD: `6e24472` (EP-02 STORY-02.2); STORY-02.3 source files uncommitted (recorded as D2) |

Persona: single developer-operator launching the sister-mode Electron app from a terminal. No multi-user scenarios.

---

## Test cases executed

| TC ID | Feature | Expected | Actual | Status |
|---|---|---|---|---|
| TC-01 | App launches with `LC_DEPLOYMENT_MODE=sister` | Process boots; `adapter.start() OK; running=true` logged within 1s | Confirmed. Log emitted within ~600ms of `app.whenReady()`. | PASS |
| TC-02 | App rejects wrong-mode launch | `LC_DEPLOYMENT_MODE=fork` against sister entry → exit code 1 + clear message | Confirmed earlier in STORY-02.3 implementation (re-verified at build) | PASS |
| TC-03 | Karaoke window opens at expected bounds (100, 100, 1280×720), transparent + frameless + alwaysOnTop | Window visible on the projector with the right config | Confirmed via `webContents.capturePage()` — see evidence/screenshot-progress-*.png | PASS |
| TC-04 | KaraokeOutput.svelte renders "Hello, LyriCue" + metadata line | Word displayed center-screen; metadata at bottom showing tier/vad/slide/word | Confirmed. Metadata line reads `tier: auto · vad: active · slide 0 · word 0` correctly. | PASS |
| TC-05 | Sweep effect — wordProgress drives left→right colour fill | At progress=0, word in unfilled colour; progress=50, half-filled; progress=100, fully highlighted | Sweep mechanics work (left→right, mid-point bisects the word correctly), **but semantic is inverted** — unfilled state is `#666666` (sungColor) instead of `#CCCCCC` (upcomingColor). See **D6**. | PARTIAL PASS |
| TC-06 | Synthetic frames push at 60 fps for sustained operation | ≥30 fps (NFR1.3) over 60s, zero drops | ~52 fps sustained over 60s (12 health probes), zero drops. Above NFR1.3 floor but ~13% short of nominal 60 fps. See **D3**. | PASS |
| TC-07 | NFR2.1 — `pushSyncFrame` never throws | Adapter rejects/drops pathological frames silently; adapter.running stays true | 12 pathological inputs accepted without throwing; adapter remained running; lastError stays `none`. See **D7**. | PASS |
| TC-08 | App lifecycle: window-closed event fires | `adapterClosed` event + `window-all-closed` event both fire when the karaoke window is closed | Both events fired; `adapter.health.running` flipped to `false`; `BrowserWindow.getAllWindows().length === 0`. | PASS |
| TC-09 | macOS-specific behaviour: app stays alive after all windows closed | `process.platform === "darwin"` → no auto-quit | App process stayed alive after the karaoke window was programmatically closed. | PASS |
| TC-10 | `LC_VERBOSE=1` env var enables detailed logging | dom-ready, did-finish-load, renderer console messages all forwarded to stderr | Confirmed. 6 distinct log prefixes seen including `[lyricue:sister:dom-ready]`, `[lyricue:sister:did-finish-load]`, `[lyricue:sister:renderer:info]`. | PASS |
| TC-11 | Default verbosity is quiet | Without `LC_VERBOSE`, no per-frame or lifecycle noise; only adapter.start + health probes | Confirmed. Default log shows 1 startup line + 1 health probe every 5s. | PASS |
| TC-12 | Preload IPC surface is narrow (`contextBridge` only) | Renderer can only call `subscribe()` and `signalReady()`; cannot reach `ipcRenderer` directly | Confirmed by code inspection. `window.lyricueOutput` exposes exactly two functions. Handler errors are caught in the preload wrapper so a buggy renderer can't crash the IPC bridge. | PASS |

---

## Defects surfaced

### D1 — INFO — Preload bundle older than other artifacts (literal-drift sweep cleared it)

**Symptom:** Compiled preload script timestamped 03:51:14; main.js / renderer bundle / HTML timestamped 04:02–04:09. 18-minute drift.

**Root cause:** `tsc -b` does not re-run `tsconfig.preload.json` because the preload is a separate root tsconfig not referenced by the main composite build. The preload only rebuilds when `npm run build:preload` is invoked explicitly.

**Latency:** Introduced in STORY-02.3b when the preload was split into its own tsconfig.

**Risk assessment:** No risk under current literal set — the literal-drift sweep confirmed all wire constants (`OWN_WINDOW_CHANNEL`, `OWN_WINDOW_READY_EVENT`, `LC_SYNC_FRAME`, `LC_LOAD_MAP`) still match the canonical sources. But a future contract change (adding a new channel, renaming an event) would silently mismatch unless the preload is rebuilt.

**Fix proposal:** Either (a) reference `tsconfig.preload.json` from the root composite tsconfig so `tsc -b` always rebuilds it, or (b) document the manual `npm run build:preload` requirement in the README. Option (a) is cleaner. Not a blocker for STORY-02.3 close; carry into STORY-02.4 polish.

**Status:** Open. INFO only.

---

### D2 — INFO — Working tree contains STORY-02.3 work uncommitted

**Symptom:** `git status --short` shows ~12 modified/untracked files representing STORY-02.3 implementation. HEAD is `6e24472` (STORY-02.2).

**Root cause:** Per user's commit cadence preference, story commits are batched.

**Latency:** N/A — intentional.

**Risk assessment:** None. Captured in the QA report so evidence ties to the right code state.

**Status:** Informational only. Expected to be cleared by the STORY-02.3 commit batch.

---

### D3 — MEDIUM — Synthetic frame stream sustains ~52 fps, not the configured 60 fps

**Symptom:** Health probes over 60 seconds show ~262 frames delivered per 5-second window, yielding ~52 fps. The synthetic stream is configured with `setInterval(..., 1000/60)` = 16.67 ms; the actual interval is closer to 19 ms (52 fps).

**Root cause:** `setInterval` in Node/Electron main process on macOS cannot reliably hit a 16.67 ms interval — kernel scheduling and JS event loop overhead drift to ~19 ms. This is a known JavaScript timer-resolution limit, not a bug in the LyriCue code.

**Latency:** Inherent in `setInterval` approach. Has existed since STORY-02.3d's `startSyntheticFrameStream` was written.

**Risk assessment:**
- ✅ **Above NFR1.3 floor (≥30 fps)** so does not block STORY-02.3.
- ⚠️ **Inconsistency** between configured cadence (60 fps) and observed cadence (52 fps) is a measurement / spec-vs-reality gap.
- ✅ EP-09's real Sync Engine uses `requestAnimationFrame` per architecture.md §4.8 / ADR-6, which IS sync'd to display refresh and will hit 60 fps consistently. So this defect is **limited to the synthetic frame stream used for the walking skeleton**; the production sync engine is unaffected.

**Fix proposal:** Two options:
1. Switch the synthetic stream from `setInterval` to a `requestAnimationFrame`-based pump (would need a `BrowserWindow`-attached rAF, since main-process Node doesn't have rAF). More work.
2. Document the synthetic-stream cadence honestly (it targets "as fast as setInterval permits, approximately 60 fps") and accept the drift. Aligns with the walking-skeleton scope.

Recommend option 2 for STORY-02.3 close; revisit if EP-09 needs a more faithful synthetic source.

**Status:** Open. MEDIUM but does not block close.

---

### D4 — INFO — Renderer frame-counter log skip pattern (artefact, not a defect)

**Symptom:** Verbose-mode log shows `frame #1, frame #60, frame #120, frame #180, frame #240, frame #300` with wordIndex sequence 0 → 1 → 3 → 5 → 7 → 9 (apparent skip of even-indexed words).

**Root cause:** The renderer logs only every 60th frame. With the synthetic stream's 500 ms/word, 60 frames @ 60 fps = 1 second wall-clock = 2 words. Each sample falls inside an odd-indexed word by coincidence. Math is correct.

**Status:** Informational only. Not a defect; logging cadence not misleading on closer inspection. No action.

---

### D5 — HIGH (resolved by workaround) — Cannot capture macOS screenshots from this shell

**Symptom:** `screencapture -R 100,100,1280,720` returns "could not create image from rect"; `screencapture -x` returns "could not create image from display". macOS Screen Recording permission is not granted to the shell/Electron context that QA runs in.

**Root cause:** macOS Sequoia (Darwin 25) requires explicit Screen Recording permission per-application. The shell that launched the QA pass does not have it.

**Latency:** N/A — environmental.

**Risk assessment:** Blocked initial attempt to gather visual evidence. **Mitigated** by switching to `webContents.capturePage()` from the Electron main process, which uses Electron's own GPU buffer (does not go through macOS's screen-capture API). This worked perfectly and produced three high-fidelity screenshots showing the renderer state at progress = 0, 0.5, 1.0.

**Fix proposal:** None for the project itself. For future QA passes, document that the in-app `capturePage()` approach is the preferred path — it's permissionless, mode-agnostic, and produces pixel-perfect captures of the renderer surface.

**Status:** Resolved via workaround. Evidence captured.

---

### D6 — **HIGH** — KaraokeOutput.svelte gradient inverts the karaoke semantic at endpoints

**Symptom:** At `wordProgress = 0`, the entire word displays in `#666666` (sungColor / "already-sung" grey). It should display in `#CCCCCC` (upcomingColor / "not-yet-sung" light grey). At `wordProgress = 1`, the entire word displays in `#FFCC00` (highlightColor / "actively-being-sung" gold) — which is also questionable; once a word is sung it should transition to sungColor, not stay highlighted.

**Evidence:** Three screenshots in `docs/qa-reports/evidence/M1-partial-sister-only-2026-05-14/`:
- `screenshot-progress-000pct.png` — word entirely in dark grey (should be light grey)
- `screenshot-progress-050pct.png` — left half gold, right half dark grey (sweep direction correct; colour semantic for the unfilled side wrong)
- `screenshot-progress-100pct.png` — word entirely in gold (should transition to sung-grey)

**Root cause:** `packages/ui/src/KaraokeOutput.svelte:105-109` defines the gradient as:
```css
background: linear-gradient(
    to right,
    #ffcc00 calc(var(--progress, 0) * 100%),    /* highlight (hard-coded) */
    #666666 calc(var(--progress, 0) * 100%)     /* sungColor (hard-coded) */
);
```
Two issues:

1. **Wrong colour for the unfilled portion.** The right-side gradient stop is `#666666` (sungColor), making the unfilled portion look like already-sung text. It should be `#CCCCCC` (upcomingColor) so unfilled = upcoming.

2. **Hard-coded colours don't respect settings.** The component bypasses the `LyriCueSettings.display.highlightColor`, `sungColor`, `upcomingColor` operator-configurable colours entirely. Per architecture.md §4.9 and FR4.3/4.4, colours must be configurable. Hard-coding them violates that contract.

**Latency:** Introduced when KaraokeOutput.svelte was first written (STORY-02.2 stub). Latent because there was no visual QA pass before this one.

**Why no test caught it:** The component is rendered via Svelte; unit tests verify the SyncFrame pipeline reaches the component (frame count increments) but do not assert pixel values. svelte-check passes because the gradient is syntactically valid CSS. This is the class of defect only a visual QA pass surfaces.

**Risk assessment:**
- ✅ **Not a runtime bug.** The component renders, the sweep moves, no errors thrown.
- ⚠️ **Semantic UX defect.** An operator looking at the screen sees the wrong story about what's been sung vs. what's coming. In a live worship context this would actively mislead the congregation.
- ✅ **STORY-02.3 scope is "stub renderer"** — the story spec explicitly defers "full per-word rendering, line transitions, and parallel lyrics" to **EP-06 (Karaoke Renderer)**. So this defect is in code that the architecture marked as a placeholder.

**Fix proposal:** Two-line fix to the gradient:
```css
background: linear-gradient(
    to right,
    var(--highlight-color, #FFCC00) calc(var(--progress, 0) * 100%),
    var(--upcoming-color, #CCCCCC) calc(var(--progress, 0) * 100%)
);
```
And add CSS custom properties driven from settings:
```svelte
<div class="word"
     style="--progress: {progress};
            --highlight-color: {settings.display.highlightColor};
            --upcoming-color: {settings.display.upcomingColor};">
```
The full word transition (active → sung after `progress === 1`) is a different concern that belongs in EP-06's full state-machine renderer (KaraokeOutput accepts a stream of frames; the "this word is now sung" state is a stream transition, not a single-frame property).

**Decision proposal:** Do NOT fix in STORY-02.3. Mark as a known carry-forward into EP-06 and add an entry to EP-06's acceptance criteria explicitly calling out:
- Use `LyriCueSettings.display.{highlightColor, upcomingColor, sungColor}` instead of hard-coded values
- Use `upcomingColor` for the unfilled portion of the active word
- Transition active words to `sungColor` once `wordProgress` crosses 1 and `wordIndex` increments

**Status:** Open. HIGH severity but not blocking STORY-02.3 close. Must be addressed in EP-06.

---

### D7 — MEDIUM — Adapter accepts and forwards malformed frames without validation

**Symptom:** `OwnWindowOutputAdapter.pushSyncFrame` accepts pathological inputs (NaN, Infinity, null, string-where-number-expected, entirely-null frames, etc.) without throwing — which is the NFR2.1 contract — but it also forwards them to the renderer untouched. A buggy upstream caller could push garbage into the renderer's state.

**Evidence:** Crash-helper test inputs (12 pathological frames). All accepted without throwing; all forwarded; renderer correctly filtered out by `frame.outputId === outputId` check at the Svelte-component level. Adapter `framesDropped` stayed at 0 (the frames weren't dropped — they were forwarded, but the renderer's filter rejected those that didn't match `PLACEHOLDER_OUTPUT_ID`).

**Root cause:** The adapter is intentionally a thin pass-through per ADR-16's "OutputAdapter abstraction is the entire bet" principle. Input validation is not the adapter's responsibility — it belongs to the upstream Sync Engine (EP-09) that produces real frames.

**Latency:** Inherent in the design. Not a regression.

**Why this is in the report:** The NFR2.1 zero-crash contract is honoured (no throws), but a future operator or developer might assume the adapter validates input. It does not. Worth documenting so EP-09's Sync Engine knows to validate before pushing, and so EP-06's renderer doesn't assume well-formed frames.

**Fix proposal:** Two non-mutually-exclusive options:
1. **Defensive renderer:** In `KaraokeOutput.svelte`, clamp `wordProgress` to `[0, 1]` and coerce non-numeric values to a safe default before driving the CSS gradient. Cheap; happens at the visual surface where bad values would otherwise produce undefined CSS behaviour.
2. **Validate at EP-09 SE boundary:** When Sync Engine pushes frames, run a Zod-light validation. Catches bugs earlier.

Both are good. Recommend (1) in EP-06 and (2) in EP-09.

**Status:** Open. MEDIUM. Not a blocker.

---

## Network / data layer observations

- **No persistent state written during a sister-mode run.** STORY-02.3 has no settings load, no library access, no timing-map storage. Observed: no files written to `$HOME/Library/Application Support/lyricue` or equivalent. Expected.
- **No outbound network calls.** Sister mode in STORY-02.3 scope makes zero network requests. Observed via main-process logs (no network events fired).
- **IPC channel traffic confined to `lyricue:output` and `lyricue:output:ready`.** No other IPC channels used. Verified by grep against the codebase.

---

## Performance measurements

| Metric | Target (NFR) | Observed | Verdict |
|---|---|---|---|
| Frame rate (synthetic stream) | ≥30 fps (NFR1.3) | ~52 fps | **PASS** with caveat (D3) |
| Frames dropped over 60 s | 0 | 0 | PASS |
| Startup time (app launch → first frame delivered) | <10 s (NFR1.7) | ~1.0 s | PASS (significant headroom) |
| Adapter health.lastError after 60 s | none | none | PASS |
| Memory growth over 60 s | <500 MB above baseline (NFR1.8) | Not measured this pass | DEFER to STORY-02.5 (Diagnostics) |
| Crashes during 60 s run | 0 (NFR2.1) | 0 | PASS |

---

## Decisions

| Defect | Severity | Blocks STORY-02.3 close? | Owner / next step |
|---|---|---|---|
| D1 — Preload tsbuild not in composite chain | INFO | No | Carry to STORY-02.4. Add `tsconfig.preload.json` to root composite references. |
| D2 — STORY-02.3 work uncommitted | INFO | No | User commits as planned per their cadence. |
| D3 — Synthetic stream cadence ~52 fps vs nominal 60 fps | MEDIUM | No | Accept for walking-skeleton. EP-09's rAF-based real engine is unaffected. |
| D4 — Renderer log skip pattern | INFO | No | No action. |
| D5 — macOS Screen Recording permission | HIGH (env) | No (workaround used) | Document `capturePage()` as the preferred QA path. |
| **D6 — Gradient semantic inversion + hard-coded colours** | **HIGH** | **No** | **Must fix in EP-06. Adding explicit ACs to EP-06 in epics.md.** |
| D7 — Adapter passes through malformed frames | MEDIUM | No | EP-06: defensive renderer clamping. EP-09: SE-boundary validation. |

**STORY-02.3 is approved for close** with the above carry-forwards into STORY-02.4 (D1), EP-06 (D6, D7), and STORY-02.5 (memory measurement).

---

## Cross-cut heuristics — full sweep

| Heuristic | Applicable? | Result |
|---|---|---|
| Literal-drift sweep | YES | ✅ All wire literals match canonical sources |
| SSR / CSR contract diff | NO | Electron renderer is always CSR |
| Form hydration round-trip | NO | No forms in STORY-02.3 scope |
| Privacy boundary check | YES (IPC surface) | ✅ `window.lyricueOutput` exposes exactly two narrow functions |
| Idempotency sweep | YES | ✅ Covered by existing unit tests (start/stop idempotency) |
| Production-code literal vs seed | NO | No seed data in scope |
| Schema-drift vs migrations | NO | No DB schema in scope |
| **NFR2.1 zero-crash contract** (project-specific) | YES | ✅ Verified at runtime against 12 pathological inputs |
| **Renderer visual fidelity vs spec** (project-specific) | YES | ❌ **D6** — gradient inverted |

---

## Recommendations before further milestone work

1. **HIGH** — Add explicit AC to EP-06 STORY-06.1 in `_bmad-output/epics.md`: "Per QA pass M1-partial-sister-only-2026-05-14 §D6, the per-word gradient MUST use `display.upcomingColor` for the unfilled portion (currently hard-coded to `#666666` sungColor in the walking-skeleton stub). Colours MUST be driven by CSS custom properties bound to `LyriCueSettings.display.*` so operators can re-skin."

2. **MEDIUM** — Add `tsconfig.preload.json` to root composite tsconfig references so `tsc -b` always rebuilds the preload alongside main and renderer. Prevents future wire-literal drift between adapter and preload.

3. **MEDIUM** — In EP-06, add a renderer-side clamp for `wordProgress`: `Math.max(0, Math.min(1, frame.wordProgress))` before driving the CSS gradient. Defensive coding against D7-class upstream bugs.

4. **MEDIUM** — In EP-09 STORY-09.1 (SyncEngine state model), add input validation at the SE → OutputAdapter boundary. Zod schema for SyncFrame; refuse non-conforming frames at the SE level so adapters get well-formed input.

5. **LOW** — Add an `npm run qa:capture` script that invokes the in-app `webContents.capturePage()` helper used in this pass. Codifies the visual-evidence workflow for future QA passes.

6. **LOW** — In STORY-02.5 (Adapter health + diagnostics), surface the actual measured frame rate in the diagnostics panel alongside `framesDelivered` / `framesDropped`. Would have caught D3 at-a-glance instead of via post-hoc log arithmetic.

7. **INFO** — Memory growth measurement deferred to STORY-02.5 because the diagnostics panel is the right surface for it. Note in STORY-02.5's ACs.

---

## Final verdict

**STORY-02.3 (OwnWindowOutputAdapter) is approved for close.**

The sister-mode rendering surface works end-to-end at the level the architecture demands: real BrowserWindow, real IPC, real Svelte component, real frame delivery. Zero crashes over 60 s. Zero frame drops. The ADR-16 zero-crash contract holds at runtime under adversarial input. The IPC privacy boundary is correctly scoped.

**One HIGH-severity carry-forward (D6 — gradient inversion + hard-coded colours)** that lives in code the architecture explicitly designated as a stub. The fix belongs in EP-06's Karaoke Renderer where the full per-word rendering, line transitions, and settings-driven colours land.

**Half of the M1 dual-mode parity claim is now retired:** sister mode confirmed. Fork mode awaits STORY-02.4. The full M1 QA pass (per `epics.md` §4.1) will exercise both modes side-by-side and verify they produce visually identical output for the same SyncFrame stream.

---

**Evidence archived at:** `docs/qa-reports/evidence/M1-partial-sister-only-2026-05-14/`

- `screenshot-progress-000pct.png` — KaraokeOutput at wordProgress = 0
- `screenshot-progress-050pct.png` — KaraokeOutput at wordProgress = 0.5 (sweep mid-point)
- `screenshot-progress-100pct.png` — KaraokeOutput at wordProgress = 1.0
- `smoke-60s.log` — 60-second smoke test main-process stderr
- `verbose-mode-8s.log` — `LC_VERBOSE=1` lifecycle event sequence

---

**Sign-off:** QA pass executed 2026-05-14, ~50 minutes wall-clock. Author: senior QA analyst (Claude `claude-opus-4-7`, /qa-analyst skill).
