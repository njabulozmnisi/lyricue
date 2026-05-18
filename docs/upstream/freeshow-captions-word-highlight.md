# FreeShow Captions Word-Highlight Upstream Package

**Status:** Ready for operator-approved upstream posting  
**Owner:** Project lead  
**Related epic:** EP-20  
**Architecture reference:** ADR-16, architecture §7.8  
**Last updated:** 2026-05-18

## Discussion

**Target repository:** `ChurchApps/.github` Discussions  
**Title:** Live word-highlight on Captions — would a small extension PR be welcome?

```markdown
Hi FreeShow maintainers,

I am building a companion live-lyrics tool on top of FreeShow and want to check whether a small Captions-item extension would be welcome before investing in a PR.

The use case is a local companion service, similar in integration shape to Caption.ninja, that listens to a live audio feed and drives lyric captions in FreeShow during live music performances. This is useful in worship services, karaoke venues, theater, touring music, and language-learning events.

Most of the integration works through the existing Captions item and WebSocket API. The companion can push the current lyric text and advance words. The missing piece is smooth left-to-right progress inside the active word, because the current Captions contract has no per-word progress signal.

The proposed extension is intentionally small:

- Optional `highlightMode: "word-sweep"` on the Captions item.
- Optional `wordProgress: number` on the active word/caption update payload.
- When `highlightMode === "word-sweep"` and `wordProgress` is present, the renderer wraps words in spans and applies a CSS gradient sweep keyed off `--progress`.
- When the option is off or the field is absent, existing Captions behavior is unchanged.

Expected PR shape is 3-4 files, around 150 LOC, centered on the Captions layer component and its types. The goal is to extend the existing Captions primitive rather than introduce a new item type or subsystem.

Would this kind of extension be something you would consider in principle? I am happy to adjust the API shape if there is a better fit with FreeShow conventions.
```

## Minimal PR Scope

Target: focused PR after maintainer signal, or after 30 days without response if the operator approves proceeding.

Expected files:

- `src/frontend/components/output/layers/Captions.svelte`
- Captions item/type definition file
- Captions payload/API type definition file
- One focused renderer/unit test or fixture file if the upstream repo has nearby test coverage

Expected implementation:

1. Add `highlightMode?: "none" | "word-sweep"` with default current behavior.
2. Add `wordProgress?: number` clamped to `[0, 1]` at the renderer boundary.
3. Render words as spans only for `word-sweep`; otherwise keep current text rendering.
4. Set `--progress` on the active word span and apply the same gradient sweep technique LyriCue uses in `KaraokeOutput.svelte`.
5. Add screenshot evidence showing default Captions unchanged and `word-sweep` active.

Out of scope:

- New FreeShow item type.
- LyriCue-specific branding or settings.
- Audio/STT/sync logic.
- Any broader Captions transport redesign.

## PR Description Template

```markdown
## Summary

Adds an optional word-sweep highlight mode to the existing Captions item for integrations that drive live captions over FreeShow's external API.

## Why

External caption companions can currently update text through the Captions item, but they cannot express progress through the active word. This adds a small optional field so integrations can render karaoke-style word progress without changing existing behavior.

## Scope

- Adds optional `highlightMode: "word-sweep"`.
- Adds optional `wordProgress` for the active word.
- Existing Captions behavior remains the default when the option is unset.
- No new item type or LyriCue-specific logic.

## Evidence

- Default Captions screenshot: unchanged.
- Word-sweep screenshot: active word gradient sweep at 50%.
- Tests/fixture: verifies missing `wordProgress` falls back to current behavior.

## Related discussion

Link to the maintainer discussion here.
```

## Monitoring Plan

- Day 0: Post discussion after operator approval.
- Day 7: If no response, add one concise follow-up with the PR scope and screenshot mock.
- Day 30: If still no response, decide between opening the small PR anyway or formally taking the ADR-16 fallback path.
- Record the outcome in this file and in ADR-16 notes before changing adapter strategy.

## Fallback Amendment

If the maintainer rejects the idea or the discussion remains unanswered beyond the operator-approved wait window:

- Treat `OwnWindowOutputAdapter` as the production sister-mode rendering path.
- Keep `CaptionInjectionOutputAdapter` as a future optional adapter only if FreeShow gains an equivalent capability.
- Document the user-facing implication: sister mode uses a LyriCue-owned projector window, so operators manage FreeShow plus LyriCue output instead of a single FreeShow-rendered output.
- Continue fork mode for maximum in-FreeShow rendering fidelity.

## Current Local Decision

The upstream discussion and PR are prepared but not posted from this workspace. Posting to GitHub, opening an upstream PR, or creating a monitoring automation requires explicit operator approval and credentials.
