# EP11 Model Manifest Status QA Report — 2026-06-07
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP-11 Learn Song production-learning controls and operator-visible model manifest/configuration status.
**Environment:** Local dev workspace at `/Users/njabulomnisi/Projects/Dojo/worshipsync`; UI component and sister renderer/main boundary verification with Node 25 via the required isolated shell wrapper.
**Status:** Pass-with-caveats

## Executive summary

The Learn Song wizard now surfaces whether production learning has a configured, missing, or optional model manifest before the operator starts the expensive sidecar path. One **MEDIUM** operator-visibility defect was fixed. No **CRITICAL** or **HIGH** defects were found.

The remaining EP-11 caveat is unchanged: a real production learning pass still depends on the release-owned model manifest and ML artifacts.

## Test environment + persona setup

- Pass: Repository workspace was local `main`; only current EP-11 status-surface changes and ignored `.claude/` were present.
- Pass: Node commands used the documented `env -i` Node 25 wrapper.
- Pass: Persona was a live operator choosing Production Demucs + WhisperX from the Learn Song wizard.
- Pass: No DB, login, Redis, MinIO, or external network services apply to this UI/host status pass.
- Pass: Literal-drift check applied to the status literals by pinning them in sister host tests and UI tests.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP11-MANIFEST-01 | Configured manifest | Live operator | Production mode shows a configured manifest status with detail. | Wizard rendered `Model manifest configured` and host resolver returned `configured`. | Pass |
| EP11-MANIFEST-02 | Required manifest missing | Live operator | Production mode clearly blocks operator confidence when the install requires a manifest path. | Wizard rendered `Model manifest missing`; host resolver returned `missing` with `LC_MODEL_MANIFEST_PATH` guidance. | Pass |
| EP11-MANIFEST-03 | Configured path unavailable | Live operator | Broken configured path is reported as missing rather than optional. | Host resolver returned `Model manifest path is not available`. | Pass |
| EP11-MANIFEST-04 | Optional manifest | Live operator | Installs that do not require a manifest show the fallback posture. | Host resolver and UI default returned optional sidecar-default messaging. | Pass |
| EP11-MANIFEST-05 | Existing production options | Live operator | Existing model selections still reach the learning callback. | Existing production model-choice test still passes. | Pass |
| EP11-MANIFEST-06 | Type and Svelte diagnostics | Developer | Renderer/main/UI contracts compile cleanly. | `tsc -b` and `svelte-check` passed. | Pass |

## Defects surfaced + fixed

**D43 — MEDIUM — Production learning did not show install/model-manifest posture before start**  
Symptom: The wizard exposed Production Demucs + WhisperX controls, but the operator could not tell whether the current install had a configured manifest, required a missing manifest, or would fall back to sidecar defaults until starting learning.  
Root cause: Production options were UI-local and the sister host did not broadcast model-manifest status into the operator state.  
Latency: Present since production learning controls landed; earlier tests verified selected model values and sidecar request shaping, not operator-visible environment posture.  
Repro steps: Open Learn Song, select a reference audio file, switch Learning mode to Production Demucs + WhisperX. Before this change, only static hint text was shown regardless of install configuration.  
Evidence: Host status resolution is covered in [model-manifest-status.test.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/apps/sister/src/model-manifest-status.test.ts:4). UI rendering is covered in [LearnSongWizard.test.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/ui/src/LearnSongWizard.test.ts:243). The operator state broadcast includes the status in [main.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/apps/sister/src/main.ts:1026), and the renderer passes it to the wizard in [operator-window-bootstrap.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/apps/sister/src/renderer/operator-window-bootstrap.ts:605). Focused verification passed: `model-manifest-status.test.ts` 4/4, `LearnSongWizard.test.ts` 11/11, `tsc -b`, and `svelte-check`.  
Fix proposal: Add a tested sister-host manifest-status resolver, include its result in the operator state payload, and render that state in the production Learn Song controls.  
Fix status: Fixed and verified locally in this change.

## Network / data layer observations

- Network: No network calls are made by the status display. It intentionally avoids model downloads or external manifest fetches.
- Data layer: No DB writes. The host checks only whether the configured manifest path is present at the filesystem boundary.
- Console: Focused tests emitted no unexpected console errors.

## Cumulative defect tally (if multi-pass)

| Pass | Defects | Critical | High | Medium | Low | Fixed in pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| EP11 production learning UI — 2026-05-19 | 0 | 0 | 0 | 0 | 0 | 0 |
| EP11 production learning evidence — 2026-05-19 | 0 | 0 | 0 | 0 | 0 | 0 |
| EP11 model manifest status — 2026-06-07 | 1 | 0 | 0 | 1 | 0 | 1 |

## Recommendations before production shipping

1. **HIGH:** Run one production-mode learning pass with a real release-owned model manifest and ML artifacts.
2. **MEDIUM:** Replace the static manifest-path detail with installer-managed display names once installer configuration is finalized.

## Final verdict

This EP-11 status slice is locally ready. It improves operator decision-making before production learning starts, but does not certify real model accuracy or release manifest availability.
