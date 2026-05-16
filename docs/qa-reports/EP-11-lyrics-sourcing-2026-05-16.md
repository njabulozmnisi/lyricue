# EP-11 Lyrics Sourcing & Show Creation QA Report — 2026-05-16

**Scope:** Initial EP-11 implementation slice: pure lyrics parsing and file-text normalization for paste/import flows.
**Branch:** `codex/fix-ep10-operator-defects`
**Status:** **Partial pass** — unblocked parser foundation is implemented; wizard UI, FreeShow lyric search, audio attachment, and timing preview remain future work.

## Coverage

| Story | Status | Notes |
|---|---:|---|
| 11.1 LearnSongWizard scaffold | Not started | UI modal work deferred. |
| 11.2 FreeShow lyric search | Blocked | Requires FreeShow IPC/REST integration surface. |
| 11.3 Paste auto-section detection | Pass | Added `@lyricue/core/lyrics` parser for bracket, colon, numbered, blank-line, shorthand, and ChordPro markers. |
| 11.4 File import | Partial | `.txt`, `.chordpro`, `.opensong`, and XML text normalization landed. `.docx`/`.pdf` extraction deferred until parser dependencies are introduced. |
| 11.5 Section review/editing | Not started | Needs wizard UI. |
| 11.6 Audio attachment/learn trigger | Blocked | Depends on real `learn_song` sidecar method from EP-05. |
| 11.7 Timing preview/manual adjustment | Not started | Needs learned timing output and waveform UI. |

## Verification

- `npx vitest run packages/core/src/lyrics/parse-lyrics.test.ts` — 9 passing.
- `npx tsc -b` — clean.

## Parser Formats Covered

- CCLI-style bracket markers: `[Verse 1]`, `[Chorus]`.
- Colon markers: `Verse 1:`, `Bridge:`.
- Numbered plain text: `1.`, `2.`.
- Blank-line separated raw text.
- ChordPro section directives and inline chord stripping.
- OpenSong/OpenLyrics XML text extraction.
