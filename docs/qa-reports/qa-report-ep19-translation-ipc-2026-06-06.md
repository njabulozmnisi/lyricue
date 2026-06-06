# EP19 Translation IPC QA Report — 2026-06-06
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP-19 sister-mode operator `saveTranslation` IPC boundary, authoritative timing-map preservation, parallel-track normalization, rehearsal variant routing, and unknown-show rejection.
**Environment:** Local dev workspace at `/Users/njabulomnisi/Projects/Dojo/worshipsync`; pure sister-main helper verification with Node 25 via the required isolated shell wrapper.
**Status:** Pass-with-caveats

## Executive summary

The sister main process now treats translation saves as translation-only updates instead of trusting a renderer-provided full timing map. One **HIGH** IPC-boundary data-loss defect was surfaced and fixed. No **CRITICAL** defects were found.

The remaining EP-19 caveat is unchanged: translated-primary karaoke still needs a learned timing map per primary language before this epic is production-complete.

## Test environment + persona setup

- Pass: Repository workspace was local `main`; only current EP-19 IPC hardening changes and ignored `.claude/` were present.
- Pass: Node commands used the documented `env -i` Node 25 wrapper.
- Pass: No API, DB, migrations, Redis, MinIO, mail, or external worker services are in scope for this pure IPC-boundary helper pass.
- Pass: Persona was the sister-mode main process receiving operator translation save commands from the renderer.
- Pass: IPC/channel drift check: existing `saveTranslation` command kind is unchanged; the payload preparation happens behind the same main-process command handler.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP19-IPC-01 | Authoritative map preservation | Sister main process | Renderer-provided BPM/sections are ignored; only normalized parallel tracks are applied to the current map. | Helper preserved the current BPM/sections and normalized `zu-ZA` sections to `v1`/`c1`. | Pass |
| EP19-IPC-02 | Rehearsal variant routing | Sister main process | A rehearsal translation save updates the rehearsal timing-map variant, not the studio map. | Helper returned `variant: "rehearsal"` and preserved rehearsal BPM. | Pass |
| EP19-IPC-03 | Unknown show rejection | Sister main process | A translation save for a missing show is rejected before persistence. | Helper returned `unknown showId=missing`. | Pass |
| EP19-IPC-04 | Main-process wiring | Sister main process | `saveDemoTranslation` uses the preparation helper before state mutation and disk save. | [main.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/apps/sister/src/main.ts:837) now calls `prepareOperatorTranslationSave`. | Pass |

## Defects surfaced + fixed

**D38 — HIGH — Translation IPC could overwrite authoritative timing-map fields**  
Symptom: `saveTranslation` accepted a full renderer-provided `TimingMap`, validated its shape, and saved it. A translation edit could therefore overwrite BPM, sections, words, learned metadata, or timing data if the renderer held stale state or sent a malformed-but-schema-valid map.  
Root cause: `validateTimingMap` proves structural validity only. The main process did not separate trusted timing-map state from renderer-originated translation intent.  
Latency: Present since the translation editor was mounted and persisted through operator IPC. Component tests caught stale draft behavior, but no test covered the IPC boundary as a separate trust boundary.  
Repro steps: Send `saveTranslation` with `showId=show-1`, changed `bpm`, changed sections, and a valid `parallel` track; previous main-process code saved the full changed timing map.  
Evidence: The new helper is covered in [operator-translations.test.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/apps/sister/src/operator-translations.test.ts:35), and `saveDemoTranslation` now calls it from [main.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/apps/sister/src/main.ts:837). Focused verification passed: `tsc -b` and `operator-translations.test.ts` 3/3. Full local verification passed: `tsc -b`, root Vitest 752/752, Python sidecar 88 passed/1 skipped, Python sidecar ML 88 passed/1 skipped, `svelte-check` 0 errors/warnings, and Worker Vitest 11/11.  
Fix proposal: Add a pure IPC preparation helper that validates the renderer timing-map shape, resolves the authoritative current map by show and variant, applies only normalized `parallel` tracks, and rejects unknown shows before persistence.  
Fix status: Fixed and verified locally in this change.

## Network / data layer observations

- Network: No network calls are made by this IPC boundary.
- IPC: The command channel and command kind did not change; only server-side payload preparation was added.
- Data layer: Translation saves can no longer overwrite authoritative timing-map fields from renderer state. Disk writes now receive the current main-process map with normalized parallel tracks.
- Console: Focused tests emitted no unexpected console errors.

## Cumulative defect tally (if multi-pass)

| Pass | Defects | Critical | High | Medium | Low | Fixed in pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| EP19 translation editor refresh — 2026-06-06 | 1 | 0 | 1 | 0 | 0 | 1 |
| EP19 translation IPC — 2026-06-06 | 1 | 0 | 1 | 0 | 0 | 1 |

## Recommendations before production shipping

1. **HIGH:** Extend the Electron smoke harness to send a translation payload with altered timing fields and assert only `parallel` changes persist.
2. **MEDIUM:** Add translated-primary timing-map learning and QA for each selected primary display language.
3. **LOW:** Reuse this “renderer intent, main-owned authoritative object” pattern for future editor surfaces that submit full domain objects.

## Final verdict

The EP-19 translation save boundary is safer after this pass: translation IPC can update normalized parallel lyrics without overwriting timing data. The epic remains externally/product-gated on translated-primary timing-map learning.
