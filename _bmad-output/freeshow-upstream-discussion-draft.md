# FreeShow Upstream Discussion — Draft Post

**Status:** Draft, not yet sent.
**Target venue:** `ChurchApps/.github` Discussions, FreeShow category.
**Recipient:** Kristoffer Vassbø (vassbo) and other FreeShow maintainers.
**Purpose:** Open a low-commitment conversation about whether a small Captions-item extension would be welcome as a future PR, before investing in the PR itself.

## Sending guidance (for the project owner)

This draft is intentionally short and exploratory. The principle is **collaborative inquiry, not demanding a feature**. We're asking "would this shape of contribution be welcome?" before writing code. If vassbo's response is positive, we move toward STORY-20.2 (the actual PR). If neutral or negative, we proceed with the dual-adapter design — `OwnWindowOutputAdapter` already gives full fidelity, so nothing is lost.

Tone notes:
- Lead with appreciation that's specific (not generic flattery).
- Reference the Caption.ninja precedent he himself cited on issue #3227.
- Show we've read the codebase (the small details prove this isn't a drive-by request).
- Make it easy to say no.
- Keep under 300 words.

Title suggestion: **"Live word-highlight on Captions — would a small extension PR be welcome?"**

---

## Draft Post Body

Hi @vassbo and team,

I've been spending time in FreeShow's source over the last few weeks, and I wanted to float an idea before writing any code, since you've been clear (e.g., on #3227) that you prefer external integrations to compose from FreeShow's existing primitives rather than absorb new subsystems.

**The use case:** a companion service — similar in shape to Caption.ninja — that performs live word-level karaoke-style highlighting of song lyrics during live music performances. The companion runs locally, listens to a sound desk feed, and drives FreeShow externally via the existing Captions item + WebSocket API. This is genuinely useful in worship contexts and equally so in karaoke venues, theater, and live music in general.

**Most of this works today** through the existing Captions item — the companion can push text updates every few hundred ms and get clean word-level swap behaviour. What it can't do today is the smooth left-to-right sweep effect inside a word, because there's no per-word progress signal.

**The proposed extension** is small and focused: an optional `highlightMode: 'word-sweep'` setting on the Captions item, plus an optional `wordProgress: number` field on per-word updates. When `highlightMode === 'word-sweep'`, the renderer wraps each word in a `<span>` and applies a CSS gradient sweep keyed off `--progress`. When the mode is off or the field is absent, behaviour is unchanged for everyone else.

**Scope estimate:** 3–4 files in `src/frontend/components/output/layers/Captions.svelte` and its types — around 150 lines, similar in shape and size to #3144 (continuous loop scrolling).

Before I invest in the PR, would this kind of extension be something you'd be open to in principle? Happy to adjust the shape (e.g., I considered a dedicated item type instead, but extending the existing Captions item felt more in line with FreeShow's patterns).

Either way, thanks for FreeShow — it's a remarkable piece of work.

— Njabulo

---

## Why this is short and exploratory, not a full proposal

- **It costs vassbo ~2 minutes to read** and ~2 minutes to respond. A 2,000-word proposal would not increase the response rate.
- **It anchors on his own stated preference** (compose from primitives → use Caption.ninja-style external integration).
- **It cites #3144** — the strongest direct precedent for the size/shape we're proposing.
- **It doesn't lock us in.** If he says "yes, send the PR" → we send. If "no but I'd accept X" → we adjust. If silence → we proceed with the fallback `OwnWindowOutputAdapter` already in the architecture (ADR-16).

## What to do after posting

- Monitor for response over 2 weeks.
- One polite follow-up after week 1 if no engagement, no further bumps.
- Whatever the outcome (yes / no / silence), record it in an ADR-16 amendment so the architectural rationale stays current.

## Alternative if you don't want to post at all

The dual-adapter design already includes `OwnWindowOutputAdapter` (full fidelity, two-app operator workflow) as the working fallback. If you'd rather not start an upstream conversation at all — or want to defer it until the MVP is shipping and we have a stronger case to present — that's a fully valid choice. Nothing in the MVP critical path depends on this PR landing.
