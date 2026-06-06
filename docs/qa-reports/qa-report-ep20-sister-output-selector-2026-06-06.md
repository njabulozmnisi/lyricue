# EP20 Sister Output Selector QA Report — 2026-06-06
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP-20 sister-mode output adapter selection policy for OwnWindow fallback vs. FreeShow caption injection.
**Environment:** Local dev workspace at `/Users/njabulomnisi/Projects/Dojo/worshipsync`; pure core output verification with Node 25 via the required isolated shell wrapper.
**Status:** Pass-with-caveats

## Executive summary

The sister-mode output selection policy is now explicit and tested: OwnWindow remains the default, and caption injection is selected only when the operator opts in and FreeShow advertises word-sweep support. One **MEDIUM** integration-policy defect was surfaced and fixed. No **CRITICAL** defects were found.

The remaining EP-20 caveat is external: actual FreeShow word-sweep capability still depends on upstream support and live endpoint verification.

## Test environment + persona setup

- Pass: Repository workspace was local `main`; only current EP-20 selector changes, docs, and ignored `.claude/` were present.
- Pass: Node commands used the documented `env -i` Node 25 wrapper.
- Pass: No live FreeShow WebSocket endpoint was used; capability snapshots were modeled at the selector boundary.
- Pass: Persona was the sister-mode host deciding whether it can safely use caption injection.
- Pass: Privacy, DB, seed/literal drift, and SSR/CSR checks do not apply to this pure output policy function.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP20-SEL-01 | Default adapter | Sister host | OwnWindow is selected by default. | Selector returned `{ mode:"own-window", reason:"default" }`. | Pass |
| EP20-SEL-02 | Operator-disabled caption injection | Sister host | OwnWindow is selected even if FreeShow supports word-sweep. | Selector returned `operator-disabled`. | Pass |
| EP20-SEL-03 | FreeShow unreachable | Sister host | OwnWindow is selected when endpoint capability cannot be read. | Selector returned `freeshow-unreachable`. | Pass |
| EP20-SEL-04 | Missing word-sweep support | Sister host | OwnWindow is selected when captions exist but word-sweep is absent. | Selector returned `caption-word-sweep-missing`. | Pass |
| EP20-SEL-05 | Word-sweep support advertised | Sister host | Caption injection is selected only with opt-in plus word-sweep support. | Selector returned `caption-injection` with `wordSweepSupported:true`. | Pass |
| EP20-SEL-06 | Caption adapter regression | Sister host | Existing caption adapter payload and no-throw tests still pass. | Existing `CaptionInjectionOutputAdapter` suite passed 6/6. | Pass |

## Defects surfaced + fixed

**D43 — MEDIUM — Caption-injection runtime selection policy was implicit**  
Symptom: EP-20 had a tested `CaptionInjectionOutputAdapter`, but no host-neutral policy function that preserved OwnWindow as default and blocked caption injection unless FreeShow explicitly advertised the proposed word-sweep capability.  
Root cause: The previous implementation stopped at the adapter contract. Future sister-host wiring could have selected degraded caption injection too early, causing lower-fidelity output despite OwnWindow being available.  
Latency: Present since the caption adapter shell landed; the prior QA report explicitly recommended a runtime selector but no code pinned the selection contract.  
Repro steps: Search `@lyricue/core/output` for a selector that requires operator opt-in plus FreeShow word-sweep capability before returning `caption-injection`; none existed before this change.  
Evidence: Selector behavior is covered in [sister-output-selector.test.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/output/sister-output-selector.test.ts:4), and the selector lives in [sister-output-selector.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/output/sister-output-selector.ts:28). Focused verification passed: selector 5/5, caption adapter 6/6, and `tsc -b`. Full local verification passed: `tsc -b`, root Vitest 765/765, Python sidecar 88 passed/1 skipped, Python sidecar ML 88 passed/1 skipped, `svelte-check` 0 errors/warnings, and Worker Vitest 11/11.  
Fix proposal: Add a pure `selectSisterOutputAdapter()` policy function exported from `@lyricue/core/output`, returning OwnWindow reasons for default/disabled/unreachable/missing-support cases and caption injection only for explicit word-sweep support.  
Fix status: Fixed and verified locally in this change.

## Network / data layer observations

- Network: No live network calls are made by the selector. It consumes a capability snapshot supplied by future host probing.
- Data layer: Not applicable; adapter selection is volatile runtime policy.
- Console: Focused tests emitted no unexpected console errors.

## Cumulative defect tally (if multi-pass)

| Pass | Defects | Critical | High | Medium | Low | Fixed in pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| EP20 caption adapter shell — 2026-05-19 | 0 | 0 | 0 | 0 | 0 | 0 |
| EP20 sister output selector — 2026-06-06 | 1 | 0 | 0 | 1 | 0 | 1 |

## Recommendations before production shipping

1. **HIGH:** Probe a real FreeShow endpoint after upstream word-sweep support lands and feed that capability snapshot into this selector.
2. **MEDIUM:** Wire the sister-mode host to use this selector behind an operator setting once FreeShow capability probing exists.
3. **MEDIUM:** Capture render evidence for both selected paths: OwnWindow default and caption injection with word-sweep support.

## Final verdict

EP-20's local fallback strategy is safer after this pass because degraded caption injection cannot become the accidental sister-mode default. Production completion still depends on upstream FreeShow support and live endpoint evidence.
