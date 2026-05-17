# EP-11 Lyrics Sourcing & Show Creation QA Report — 2026-05-16

**Scope:** EP-11 implementation slice: pure lyrics parsing, file-text normalization for paste/import flows, host-neutral LearnSongWizard UI for source → section review → audio → progress → preview, and sister operator-window entry point.
**Branch:** `main`
**Status:** **Partial pass** — parser foundation and reusable wizard surface are implemented. Real FreeShow lyric search, DOCX/PDF extraction, sidecar `learn_song`, and waveform timing preview remain blocked/deferred behind host/runtime integrations.

## Coverage

| Story | Status | Notes |
|---|---:|---|
| 11.1 LearnSongWizard scaffold | Pass | Added `LearnSongWizard.svelte` with five-step navigation, gated Next actions, cancel confirmation hook, draft-change events for host persistence, and a sister operator-window "Learn Song" entry point. |
| 11.2 FreeShow lyric search | Partial / blocked | Wizard accepts an injected `searchLyrics()` callback and renders selectable results. Real fork IPC / sister REST wiring still requires FreeShow API availability. |
| 11.3 Paste auto-section detection | Pass | Added `@lyricue/core/lyrics` parser for bracket, colon, numbered, blank-line, shorthand, and ChordPro markers. |
| 11.4 File import | Partial | Wizard file picker accepts requested extensions and parses text/XML/ChordPro through injected or browser text readers. `.docx`/`.pdf` binary extraction still needs host/library wiring. |
| 11.5 Section review/editing | Partial pass | Wizard renders editable section labels/types/text and supports reorder, merge, and split actions. Full production polish can land with the host modal shell. |
| 11.6 Audio attachment/learn trigger | Partial / blocked | Wizard captures audio file metadata and accepts injected `learnSong()` callback. Real `SC.request('learn_song', ...)` depends on the EP-05 sidecar method. |
| 11.7 Timing preview/manual adjustment | Not started | Needs learned timing output and waveform UI. |

## Verification

- `npx vitest run packages/ui/src/SetlistPanel.test.ts packages/ui/src/LearnSongWizard.test.ts apps/sister/src/renderer/operator-shortcuts.test.ts` — 40 passing.
- `npx vitest run packages/ui/src/LearnSongWizard.test.ts packages/core/src/lyrics/parse-lyrics.test.ts` — 14 passing.
- `cd packages/ui && npx svelte-check --tsconfig tsconfig.json` — 0 errors, 0 warnings.
- `npx tsc -b` — clean.

## Parser Formats Covered

- CCLI-style bracket markers: `[Verse 1]`, `[Chorus]`.
- Colon markers: `Verse 1:`, `Bridge:`.
- Numbered plain text: `1.`, `2.`.
- Blank-line separated raw text.
- ChordPro section directives and inline chord stripping.
- OpenSong/OpenLyrics XML text extraction.

## Wizard Paths Covered

- Five-step scaffold renders Source lyrics, Review sections, Attach audio, Learn, and Preview.
- Next is disabled until pasted lyrics parse into at least one section.
- Search results from injected host callback populate the lyrics source step.
- Section review supports label/text editing.
- Dirty cancel calls the injected confirmation hook before emitting cancel.
- Skipping audio creates a manual-mode preview and emits complete.
- Operator SetlistPanel exposes a Learn Song command and dispatches `learn-song`; the sister operator bootstrap mounts the wizard in a modal with current host integrations stubbed.
