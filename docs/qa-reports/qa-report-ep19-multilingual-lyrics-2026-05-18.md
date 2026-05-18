# EP19 Multilingual Parallel Lyrics QA Report — 2026-05-18

**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** Parallel lyrics schema, timing-map persistence shape, per-section translation editor, display language settings, KaraokeOutput parallel rendering, language swap behavior, and auto-sizing for two or three displayed languages.
**Environment:** Local dev workspace at `/Users/njabulomnisi/Projects/Dojo/worshipsync`; component/unit verification with sister renderer bundle build.
**Status:** Pass-with-caveats

## Executive summary

EP19 is locally verified for the shared LyriCue codebase. The pass surfaced one **MEDIUM** rendering defect from the existing EP06 implementation: secondary lyric sizing was counted by parallel track count instead of displayed language count, so one translation would render at 75% instead of the required 60%.

No **CRITICAL** defects remain in the locally testable EP19 surface. The caveat is that language swap now visibly swaps the primary displayed text, but section-level translation tracks do not carry word timings, so translated-primary karaoke word highlighting requires a future learned timing map per primary language.

## Test environment + persona setup

- Pass: Repository was on local `main`; EP19 work happened after `5f3e943 feat:(#EP-18): add arrangement builder`.
- Pass: Node commands used the required `env -i` Node 25 wrapper.
- Pass: No DB, API health endpoint, Redis, MinIO, or mail services are required for the local EP19 component pass.
- Pass: Persona was the tech operator adding Zulu/Sotho/Spanish per-section lyrics and toggling display language settings.
- Pass: Literal drift checked against canonical BCP-47 language string usage in `TimingMap.language`, `ParallelLyricsTrack.language`, and display settings. No seed files are in scope.
- Caveat: Translation editor is a shared Svelte component; it is not yet mounted in the real sister operator window route.

## Test cases executed

| TC ID      | Feature               | Persona             | Expected                                                                                                       | Actual                                                                                            | Status           |
| ---------- | --------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------- |
| EP19-TC-01 | TimingMap schema      | Developer           | `TimingMap.parallel?: ParallelLyricsTrack[]` validates and round-trips.                                        | `validateTimingMap` accepts a map with `parallel: [{ language, sections }]`.                      | Pass             |
| EP19-TC-02 | Translation helper    | Tech operator       | Draft includes every timing-map section and preserves existing section text.                                   | `createParallelLyricsDraft` returns per-section rows and pre-fills existing translations.         | Pass             |
| EP19-TC-03 | Translation editor UI | Tech operator       | Original text appears beside translation textarea; Save returns a timing map with the translation track.       | `TranslationEditor.test.ts` edits `Verse 1` and verifies `parallel` on saved map.                 | Pass             |
| EP19-TC-04 | KR secondary display  | Congregation output | Parallel lyrics do not render when disabled and do render when enabled.                                        | Existing KR tests pass with enabled/disabled settings.                                            | Pass             |
| EP19-TC-05 | KR 2-language sizing  | Congregation output | Primary + one translation renders secondary at 60%.                                                            | `.parallel` inline style contains factor `0.6`.                                                   | Pass             |
| EP19-TC-06 | KR 3-language sizing  | Congregation output | Primary + two translations renders secondaries at 50%.                                                         | Two `.parallel-track` blocks render with factor `0.5`.                                            | Pass             |
| EP19-TC-07 | Language swap         | Tech operator       | Selecting a parallel language as primary changes the next render.                                              | `primaryLyricsLanguage: "zu-ZA"` renders Zulu in `.primary-translation` and English as secondary. | Pass-with-caveat |
| EP19-TC-08 | Build integration     | Developer/operator  | Shared UI/core additions do not break TypeScript, Svelte diagnostics, workspace tests, or sister bundle build. | `svelte-check`, `tsc -b`, `npm run test:ts`, and `npm -w @lyricue/sister run build` all pass.     | Pass             |

## Defects surfaced + fixed

**D23 — MEDIUM — Parallel lyric font sizing counted tracks, not displayed languages**  
Symptom: With one translation track enabled, KR would calculate `parallelFontFactor` as `0.75`, but FR10.8 requires secondary lyrics at 60% when two languages are displayed.  
Root cause: [KaraokeOutput.svelte](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/ui/src/KaraokeOutput.svelte:376) previously based sizing on `parallelLyrics.length`; the correct input is the number of rendered secondary blocks after primary-language swap and language filtering.  
Latency: Present since EP06 parallel lyric rendering; earlier tests only asserted two parallel tracks produced 60%, which was itself the wrong interpretation of FR10.8.  
Repro steps: Load a timing map with one `parallelLyrics` track, enable `parallelLyricsEnabled`, inspect `.parallel` inline font size.  
Evidence: EP19 test coverage now asserts one secondary track produces `0.6` and two secondary tracks produce `0.5` in [KaraokeOutput.test.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/ui/src/KaraokeOutput.test.ts:459).  
Fix proposal: Resolve actual rendered parallel blocks first, then compute factor from `parallelLines.length`.  
Fix status: Fixed locally and verified with `svelte-check`, `tsc -b`, `npm run test:ts`, and sister build.

## Network / data layer observations

- Network: No network calls are made by the EP19 shared components.
- Data layer: The timing-map schema now includes optional `parallel` tracks in [timing-map.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/types/timing-map.ts:102) and validates them in [timing-map-schema.ts](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/core/src/types/timing-map-schema.ts:135), so `TimingMapStorage.save()` will persist translations through the existing atomic validated path.
- Renderer: KR now resolves up to two secondary blocks per active section in [KaraokeOutput.svelte](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/ui/src/KaraokeOutput.svelte:342) and renders them as `.parallel-track` blocks in [KaraokeOutput.svelte](/Users/njabulomnisi/Projects/Dojo/worshipsync/packages/ui/src/KaraokeOutput.svelte:481).
- Console: Component-level jsdom tests did not emit unexpected console failures.
- IPC: EP19 does not add new IPC channels.

## Cumulative defect tally (if multi-pass)

| Pass                       | Defects | Critical | High | Medium | Low | Fixed in pass |
| -------------------------- | ------: | -------: | ---: | -----: | --: | ------------: |
| EP19 local QA — 2026-05-18 |       1 |        0 |    0 |      1 |   0 |             1 |

## Recommendations before production shipping

1. **MEDIUM:** Mount `TranslationEditor.svelte` in the operator shell and add a browser/Electron persistence test: edit translation, save through host storage, reload timing map, render KR with the saved track.
2. **MEDIUM:** Decide whether "translated language as primary" must mean word-level highlight. If yes, add a future model where each primary language can have its own word-timed `TimingMap`; section-level `ParallelLyricsTrack` cannot provide true translated-word karaoke timing.
3. **LOW:** Add visual regression evidence for two and three language layouts once a local harness or operator route exists.

## Final verdict

EP19 is locally ship-ready as a shared schema, helper, editor, settings, and renderer implementation. The shipped surface covers persisted section-level translations, side-by-side editing, toggleable secondary display, preferred secondary language ordering, visible primary-language swap, and corrected 2/3-language sizing. The remaining production-readiness caveat is host mounting and a product decision on whether translated-primary word highlighting is required beyond section-level display.
