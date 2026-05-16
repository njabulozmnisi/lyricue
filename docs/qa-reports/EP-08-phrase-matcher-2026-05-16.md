# EP-08 Phrase Matcher QA Report — 2026-05-16

**Scope:** STORY-08.4 pure phrase matcher for STT position correction.
**Branch:** `codex/fix-ep10-operator-defects`
**Status:** **Pass** for the matcher core. Whisper.cpp integration and rolling audio windows remain blocked by native addon/model work.

## Coverage

| Acceptance Criterion | Status | Notes |
|---|---:|---|
| AC1 — Build 3-word phrase index | Pass | `buildPhraseIndex()` indexes every consecutive 3-word phrase with section, slide, word, global ordinal, and reference time. |
| AC2 — Extract phrases from STT output | Pass | `findPhraseMatch()` tokenizes recognized text and evaluates every 3-word window. |
| AC3 — Fuzzy per-word threshold | Pass | Levenshtein similarity must be >=0.75 for every word in the window. |
| AC4 — Correction target data | Pass | Matches return slide index, section ID, word index, global word ordinal, and reference ms. |
| AC5 — Repeated phrase tie-breaking | Pass | Candidates sort by smallest forward jump from the current cursor. |
| AC6 — Unit coverage | Pass | Exact, fuzzy, no-match, repeated-phrase, and different-section correction cases covered. |

## Verification

- `npx vitest run packages/core/src/stt/phrase-matcher.test.ts` — 6 passing.
- `npx tsc -b` — clean.
