# EP18-EP19 Operator Tools QA Report — 2026-05-18
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** Sister-mode operator mounting for Arrangement Builder and Translation Editor, in-memory demo persistence over operator IPC, dual-window E2E boot, evidence capture, and bundle-build integrity.
**Environment:** Local macOS dev; `LC_DEPLOYMENT_MODE=sister LC_E2E_MODE=1 LC_VERBOSE=1 LC_CAPTURE_EVIDENCE=1 LC_CAPTURE_OPERATOR_TOOLS=1`; no external API/DB/Cloudflare services.
**Status:** Pass-with-caveats

## Executive summary
EP18 and EP19 no longer stop at reusable component coverage: Arrange and Translate now open real operator-window modals against the active learned timing map. The pass surfaced one **HIGH** integration defect: the sister package build did not emit the operator bundle, so a normal app build could boot a blank operator window. That defect is fixed and verified live.

Remaining caveat: arrangement and translation saves are persisted in memory for the demo project only; durable host storage remains the next host-integration slice.

## Test environment + persona setup
- PASS — Repo was local `main`; commands used the required `env -i` Node wrapper.
- PASS — `npm -w @lyricue/sister run build` now emits main, preload, karaoke renderer, and operator renderer bundles sequentially.
- PASS — Live tech operator persona verified against the sister-mode operator window.
- PASS — No DB, migrations, Redis, MinIO, mail, or SSR/CSR surfaces are in scope for this Electron-local pass.
- PASS — IPC sender validation remains in main; new save/select commands still enter through the existing `lyricue:operator:command` handler.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP18/19-TC1 | Operator panel boot | Live tech operator | Operator bundle loads and renderer signals ready | `operator window: renderer signalled ready`; screenshot shows populated panel | PASS |
| EP18/19-TC2 | Arrangement modal | Live tech operator | Arrange opens `ArrangementBuilder` for active learned song | Screenshot `05-arrangement-builder-operator.png` shows active map sections and save surface | PASS |
| EP18/19-TC3 | Translation modal | Live tech operator | Translate opens `TranslationEditor` for active learned song | Screenshot `06-translation-editor-operator.png` shows section text, `zu-ZA` default, save surface | PASS |
| EP18/19-TC4 | IPC state enrichment | Live tech operator | Active timing map, arrangements, and selected arrangement are available to renderer without blank first paint | Initial operator screenshot is hydrated; no placeholder-only panel | PASS |
| EP18/19-TC5 | Bundle integrity | Developer/operator | Sister build emits both karaoke and operator bundles | `apps/sister/public/build/operator-window.bundle.js` and `.css` exist after `npm -w @lyricue/sister run build` | PASS |
| EP18/19-TC6 | Regression sweep | Developer/operator | TS, Svelte, TS tests, sidecar tests, and live E2E stay green | `tsc -b`, `svelte-check`, 655 TS tests, 52 Python tests, and E2E capture pass | PASS |

## Defects surfaced + fixed
D24 — **HIGH**  
Symptom: A clean `npm -w @lyricue/sister run build` could leave `apps/sister/public/build/operator-window.bundle.js` missing, and the live E2E operator capture rendered as a blank black window.  
Root cause: `apps/sister/package.json` only built `vite.config.mjs` for the karaoke renderer; the operator renderer required a separate manual command. Running the two renderer builds in the wrong order could also erase the operator bundle because both write to `public/build`. The fixed package script adds `build:operator` and sequences it after `build:renderer` in [package.json](/Users/njabulomnisi/Projects/Dojo/worshipsync/apps/sister/package.json:13).  
Latency: Present since EP10 introduced the operator bundle as a separate build step. Unit tests missed it because they run component/jsdom code, not the packaged Electron HTML loading from `public/build`.  
Repro steps: Build only with `npm -w @lyricue/sister run build`, launch `LC_E2E_MODE=1 LC_CAPTURE_EVIDENCE=1`, and inspect the operator evidence screenshot.  
Evidence: Before the fix, operator screenshots were blank black. After the fix, `01-first-word-active-operator.png`, `05-arrangement-builder-operator.png`, and `06-translation-editor-operator.png` render populated UI.  
Fix proposal: Make the sister package build own both renderer bundles, sequentially.  
Fix status: Fixed locally and verified by `npm -w @lyricue/sister run build` plus live E2E capture.

## Network / data layer observations
- Network: No outbound calls. The live pass stayed inside the Electron process and local synthetic-audio path.
- Data layer: New arrangement and translation commands validate payload shape through `validateArrangement` / `validateTimingMap` before updating the demo in-memory maps. No persisted files are mutated.
- IPC: Existing sender validation still gates `lyricue:operator:command`; new command kinds are handled in the same main-process switch. Pre-ready operator state buffering still hydrates the first panel render.
- Console: No operator renderer errors were emitted during the verified live run. Karaoke output delivered frames with `dropped=0`; diagnostics reported about 50fps during capture.

## Cumulative defect tally (if multi-pass)
| Pass | Defects | Critical | High | Medium | Low | Fixed in pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| EP18 local QA — 2026-05-18 | 1 | 0 | 0 | 1 | 0 | 1 |
| EP19 local QA — 2026-05-18 | 1 | 0 | 0 | 1 | 0 | 1 |
| EP18/19 operator tools — 2026-05-18 | 1 | 0 | 1 | 0 | 0 | 1 |

## Recommendations before production shipping
1. **MEDIUM:** Replace demo in-memory arrangement/translation saves with the real timing-map storage path and add a reload round-trip test.
2. **MEDIUM:** Add a browser/Electron test harness that clicks Arrange/Translate and asserts the modal DOM, not just screenshot evidence.
3. **LOW:** Track the `svelte-dnd-action` Svelte resolve warning before dependency upgrades; it did not break this bundle, but it is build noise worth eliminating.

## Final verdict
EP18 and EP19 are stronger than the prior component-only state: the sister operator can now open the arrangement and translation tools against the active learned song, and the app build now reliably ships the operator bundle. This is locally ship-ready for the walking skeleton with one explicit caveat: saves are demo-memory only until the host storage integration lands.
