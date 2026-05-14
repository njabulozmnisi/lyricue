# QA Reports

This directory holds milestone-level functional verification reports produced by the
`/qa-analyst` skill at the end of each BMAD milestone.

## Why this is here

Per the milestone-level Definition of Done in [`_bmad-output/epics.md` §4.1](../../_bmad-output/epics.md),
no milestone is "done" until a senior-QA-analyst live verification pass has exercised the
milestone's demo path and recorded the results here.

Story-level DoD checks **correctness** (compiles, types, unit tests). Milestone-level DoD
checks **functionality** — does the feature actually work end-to-end the way an operator
would experience it? The two are complementary, not redundant: correctness is necessary
but not sufficient.

## File naming

```
M<n>-<YYYY-MM-DD>.md
```

Examples:

- `M1-2026-06-15.md` — first /qa-analyst pass against the walking-skeleton demo
- `M4-2026-09-02.md` — live sync verification
- `M7-pre-pilot-2026-12-10.md` — pre-launch full regression

If a milestone gets multiple passes (defects found → fixed → re-verified), each new pass
gets a new file with a later date. The most recent file is authoritative.

## Report structure

Each report follows the `/qa-analyst` skill's standard output:

1. **Summary** — milestone, scope, verdict (pass / pass-with-deferrals / fail).
2. **Test environment** — platform, hardware, build SHA, model versions.
3. **Scenarios executed** — list of demo / verification scenarios from the milestone's spec.
4. **Defects** — severity-tagged (critical / major / minor / cosmetic), each with:
   - Reproduction steps
   - Expected vs. actual behaviour
   - Evidence (screenshot path, console excerpt, network trace, data state)
   - Recommended disposition (fix before milestone / fix in next milestone / accept)
5. **Performance measurements** — when relevant NFRs apply (e.g., NFR1.1 song-learning time,
   NFR1.3 frame rate, NFR1.6 manual-override latency).
6. **Decisions** — which defects are accepted, which are deferred, which block the milestone.
7. **Sign-off** — name + date of the human who reviewed the report.

## When `/qa-analyst` runs

- **End of every milestone** (M1 through M7).
- **Before pilot deployment** (M7 is the gate).
- **On a re-verification pass** after defects from a prior milestone are fixed.

Not run on individual stories — most stories produce module-level changes that have no
user-facing surface in isolation. Story-level testing is unit + integration tests inside
the codebase. See `_bmad-output/epics.md` §4.1 for the rationale.

## Pre-EP-02 note

EP-01 (project foundation) produces only module scaffolding — no Electron app to exercise,
no UI to click. The first `/qa-analyst` pass is end-of-M1, when EP-02 (OutputAdapter walking
skeleton) lands a runnable demo path.
