# EP20 Captions Word-Highlight Upstream QA Report — 2026-05-18

**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** FreeShow upstream discussion package, minimal PR plan, ADR-16 fallback amendment, and external-action stop conditions.
**Environment:** Local dev workspace at `/Users/njabulomnisi/Projects/Dojo/worshipsync`; documentation/process verification only.
**Status:** Pass-with-caveats

## Executive summary

EP20 is locally complete up to the external boundary: the maintainer discussion, PR scope, monitoring plan, and fallback amendment are prepared. No **CRITICAL** defects were found in the local artifacts.

The caveat is material: the actual GitHub Discussion, upstream PR, and 30-day response monitoring are not executed from this workspace because they require explicit operator approval and upstream credentials. ADR-16 now records that local decision and keeps `OwnWindowOutputAdapter` as the active sister-mode fallback.

## Test environment + persona setup

- Pass: Repository was on local `main`; EP20 work happened after `8f7ce58 feat:(#EP-19): add multilingual parallel lyrics`.
- Pass: No API, DB, migrations, seeds, Redis, MinIO, or mail services are required for this documentation/process pass.
- Pass: Persona was the project lead preparing a maintainer-safe upstream proposal.
- Pass: External mutation stop condition applied: no GitHub discussion, upstream branch, PR, or automation was created without explicit operator approval.
- Pass: ADR-16 was amended locally with the current EP20 status and fallback implication.

## Test cases executed

| TC ID      | Feature               | Persona            | Expected                                                          | Actual                                                                                          | Status           |
| ---------- | --------------------- | ------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------- |
| EP20-TC-01 | Maintainer discussion | Project lead       | Clear use case and proposed Captions extension are ready to post. | `docs/upstream/freeshow-captions-word-highlight.md` contains title, body, scope, and rationale. | Pass-with-caveat |
| EP20-TC-02 | PR scope              | Project lead       | Focused 3-4 file, ~150 LOC PR scope is defined.                   | PR section lists expected files, implementation steps, screenshots, and out-of-scope items.     | Pass             |
| EP20-TC-03 | Monitoring            | Project lead       | 30-day response plan exists.                                      | Monitoring plan defines Day 0, Day 7, Day 30 actions.                                           | Pass             |
| EP20-TC-04 | Fallback              | Project lead       | Rejection/silence path is documented.                             | Fallback amendment keeps `OwnWindowOutputAdapter` as production sister-mode path.               | Pass             |
| EP20-TC-05 | ADR traceability      | Developer/operator | ADR-16 reflects EP20 local status.                                | `_bmad-output/architecture.md` includes a 2026-05-18 EP20 local amendment.                      | Pass             |

## Defects surfaced + fixed

No local defects were surfaced in the EP20 documentation/process artifacts.

External caveat: STORY-20.1 AC1 and STORY-20.2 AC3 cannot be truthfully marked complete until the operator approves posting to GitHub and provides/uses credentials. This is not a local code defect; it is an external-action authorization boundary.

## Network / data layer observations

- Network: No network calls were made.
- Data layer: Not applicable.
- IPC: Not applicable.
- External mutation: No upstream GitHub discussion, branch, PR, issue, or monitoring automation was created.

## Cumulative defect tally (if multi-pass)

| Pass                       | Defects | Critical | High | Medium | Low | Fixed in pass |
| -------------------------- | ------: | -------: | ---: | -----: | --: | ------------: |
| EP20 local QA — 2026-05-18 |       0 |        0 |    0 |      0 |   0 |             0 |

## Recommendations before production shipping

1. **MEDIUM:** Operator should post the prepared discussion or explicitly authorize upstream posting from a GitHub-authenticated environment.
2. **MEDIUM:** Once a maintainer response exists, update `docs/upstream/freeshow-captions-word-highlight.md` and ADR-16 with the response URL, decision, and next action.
3. **LOW:** If the discussion is quiet after 30 days, either approve opening the small PR anyway or formally close EP20 to the documented `OwnWindowOutputAdapter` fallback.

## Final verdict

EP20 is locally ship-ready as a prepared upstream package and ADR fallback record. It is not externally complete until the maintainer discussion and any PR are posted with operator approval; the current project strategy remains safe because sister mode already has `OwnWindowOutputAdapter` and fork mode retains maximum rendering fidelity.
