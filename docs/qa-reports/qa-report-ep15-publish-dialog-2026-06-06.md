# EP-15 Publish Dialog QA Report — 2026-06-06

**QA persona:** Senior QA analyst — UI contract + credential-boundary + defect triage
**Scope:** EP-15/EP-16 publish dialog behavior: song/project publish mode, central/campus target selection, per-target credential gating, publish payload shape, and confirmation URL display.
**Environment:** Local dev, `/Users/njabulomnisi/Projects/Dojo/worshipsync`.
**Status:** Pass-with-caveats

## Executive summary

The publish dialog now supports both song and project publishing and disables the publish action when the selected target lacks a credential. No defects were surfaced in this pass. The remaining caveat is external: real packaged safe-storage and deployed Worker credentials still need production proof.

## Test environment + persona setup

- Repository state: local UI/component verification.
- TypeScript build: pass via `npx tsc -b`.
- Focused publish-dialog suite: pass, 1 file / 3 tests.
- `svelte-check`: pass, 0 errors / 0 warnings.
- External services: not required; publish callback was stubbed.

## Test cases executed

| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| EP15-PUB-001 | Missing credential | Campus operator | Publish button disabled and clear error shown | Button disabled; copy names missing credential state | Pass |
| EP15-PUB-002 | Song publish payload | Central publisher | Song mode emits title, tags, attribution, target, anonymous flag | Payload included `mode:"song"` and expected metadata; returned bundle URL displayed | Pass |
| EP15-PUB-003 | Project publish payload | Campus publisher | Project mode uses selected campus target and only enables when campus credential exists | Central target disabled, campus target enabled, payload included `mode:"project"` and returned project URL displayed | Pass |

## Defects surfaced + fixed

None in this pass.

## Network / data layer observations

No network calls were made in this component pass. The wire-contract-facing payload now includes an explicit `mode` discriminator so hosts can route song bundles and project plans through different publish functions without inferring from title or target.

## Cumulative defect tally (if multi-pass)

| Pass | Critical | High | Medium | Low | Info |
|---|---:|---:|---:|---:|---:|
| 2026-06-06 EP-15 publish dialog | 0 | 0 | 0 | 0 | 0 |

## Recommendations before production shipping

1. **HIGH** Run a packaged host smoke that stores a real credential through Electron `safeStorage`, resolves it, and publishes to a deployed Worker.
2. **MEDIUM** Add an operator-window smoke once the host routes `mode:"project"` to `publishProjectPlan()`.

## Final verdict

The local publish dialog contract is ready for host integration. Production readiness still depends on real credentials, safe-storage in the packaged app, and deployed Worker publish proof.
