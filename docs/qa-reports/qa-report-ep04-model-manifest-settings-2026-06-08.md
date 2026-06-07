# EP-04 Model Manifest Settings QA Report — 2026-06-08
**QA persona:** Senior QA analyst — schema + UI hydration + host contract + defect triage
**Scope:** Sidecar model-manifest settings schema, existing SettingsTab sidecar controls, and sister-host model manifest configuration resolver.
**Environment:** Local dev; `/Users/njabulomnisi/Projects/Dojo/worshipsync`; TypeScript build, Vitest, and Svelte diagnostics under the required isolated Node shell wrapper.
**Status:** Pass

## Executive summary
LyriCue now has persisted settings fields for model manifest path, model mirror URL, and require-manifest behavior. The sister host uses an explicit resolver for current env-var configuration, with tests pinning that release env vars override persisted operator settings.

No product defects remain from this slice. The settings UI exists in the shared SettingsTab surface; sister-mode still needs the broader settings bridge before those controls become live in the operator window.

## Test environment + persona setup
- PASS: Branch `main`; starting HEAD `aa9eb3d`.
- PASS: Focused Vitest passed for settings schema and sister manifest resolver.
- PASS: TypeScript composite build passed after fixing the exact-optional env field contract.
- PASS: `svelte-check` passed after rebuilding core declarations.
- N/A: No DB, browser, login persona, Redis, MinIO, mail, or external mirror service applies to this local contract pass.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| TC-01 | Settings defaults | Operator | Manifest path/mirror unset and manifest optional on fresh install | Defaults are `null`, `null`, and `false` | PASS |
| TC-02 | Settings validation | Operator | Valid path, URL, and require flag persist through schema | Parsed settings preserve all three values | PASS |
| TC-03 | URL guard | Operator | Invalid mirror URL rejected before persistence | Schema throws `Invalid url` | PASS |
| TC-04 | Settings resolver | Release host | Persisted settings are used when env is absent | Resolver trims and returns settings values | PASS |
| TC-05 | Env precedence | Release host | Env values override persisted settings for release jobs | Resolver returns env path/mirror and env false require flag | PASS |
| TC-06 | Blank handling | Release host | Blank env/settings values are treated as unset | Resolver returns `null`, `null`, and `false` | PASS |
| TC-07 | UI diagnostics | Operator | Shared Sidecar settings controls type-check against the schema | `svelte-check` found 0 errors / 0 warnings | PASS |

## Defects surfaced + fixed
| ID | Severity | Symptom | Root cause | Latency | Fix status |
|---|---|---|---|---|---|
| D-EP04-MS-01 | **LOW** | `npx tsc -b` rejected the resolver options object under `exactOptionalPropertyTypes` | Optional env fields were declared as `string` while call sites pass `string \| undefined` from `process.env` | Immediate; surfaced by TypeScript before runtime | Fixed locally by making env option properties explicitly accept `undefined` |

## Network / data layer observations
- Network posture stayed offline: no mirror fetch is performed by the settings or resolver layer.
- Data layer: settings persist through the existing atomic JSON settings store schema; no database applies.
- Literal-drift check: env keys remain `LC_MODEL_MANIFEST_PATH`, `LC_MODEL_MIRROR_URL`, and `LC_REQUIRE_MODEL_MANIFEST`; persisted settings use matching model-manifest semantics.
- SSR/CSR, privacy, and form round-trip checks do not apply to this Electron settings contract.

## Cumulative defect tally (if multi-pass)
| Pass | Defects | CRITICAL | HIGH | MEDIUM | LOW | INFO |
|---|---:|---:|---:|---:|---:|---:|
| EP-04 model manifest settings | 1 | 0 | 0 | 0 | 1 | 0 |

## Recommendations before production shipping
1. **MEDIUM:** Mount the full SettingsTab/SettingsStore bridge in sister-mode operator UI so these controls can be edited live by operators.
2. **HIGH:** Run the real controlled manifest and mirror smoke once release artifacts exist.

## Final verdict
Ship this settings-contract increment. It makes manifest/mirror configuration durable and testable while preserving release env-var authority for packaging and certification jobs.
