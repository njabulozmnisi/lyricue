# EP20 Caption Injection Adapter QA Report — 2026-05-19
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** Local `CaptionInjectionOutputAdapter` shell for EP20.3: transport-injected FreeShow caption messages, word-sweep payload shape, degraded word-swap fallback, arrangement section resolution, and OutputAdapter no-throw frame contract.
**Environment:** Local dev workspace; unit/integration build verification only. No upstream FreeShow network endpoint or GitHub mutation was used.
**Status:** Pass-with-caveats

## Executive summary
Bottom line: the local caption-injection adapter contract is implemented and verified. No **CRITICAL** or **HIGH** defects surfaced.

The caveat remains external: full-fidelity FreeShow rendering still depends on the upstream Captions extension being accepted and merged. Until then, this adapter can produce a degraded word-swap payload shape, while `OwnWindowOutputAdapter` remains the production sister-mode renderer.

## Test environment + persona setup
- PASS: TypeScript composite build passed with the mandatory isolated Node wrapper.
- PASS: Full TypeScript/Vitest suite passed.
- PASS: Python sidecar regression passed.
- PASS: Sister karaoke and operator Vite bundles passed, proving the new `@lyricue/core/output` export did not break browser bundles.
- N/A: DB, migrations, auth, SSR/CSR, privacy, Redis, MinIO, mail, queues, and seed/literal checks do not apply to this adapter-only slice.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
|---|---|---|---|---|---|
| TC-EP20-CAP-01 | Session start | Developer/operator | Adapter connects transport and announces word-sweep or word-swap capability. | Test verifies `lyricue:caption-session` with `highlightMode`. | PASS |
| TC-EP20-CAP-02 | Map load | Developer/operator | Adapter emits show metadata and language list on song load. | Test verifies `lyricue:caption-map` with `showId`, section count, and languages. | PASS |
| TC-EP20-CAP-03 | Word-sweep payload | Developer/operator | When upstream support is enabled, frame includes `highlightMode:"word-sweep"` and clamped `wordProgress`. | Test verifies `wordProgress` clamps from `1.7` to `1`. | PASS |
| TC-EP20-CAP-04 | Fallback payload | Developer/operator | Without upstream support, frame omits sweep fields and remains usable as word-swap caption data. | Test verifies no `highlightMode` or `wordProgress` fields. | PASS |
| TC-EP20-CAP-05 | Arrangement mapping | Developer/operator | Caption section resolves through the active arrangement sequence. | Test verifies section `demo-1` and expected text from an arrangement-backed frame. | PASS |
| TC-EP20-CAP-06 | No-throw contract | Live service invariant | Transport failures must not throw from `pushSyncFrame`; health records drops/errors. | Test verifies no throw, `framesDropped=1`, and `lastError` set. | PASS |

## Defects surfaced + fixed
No defects surfaced in this pass.

Confirmed-correct behavior worth pinning:
- **INFO D-EP20-CAP-01:** Caption injection is transport-injected and does not hard-code a WebSocket implementation into core. Evidence: `packages/core/src/output/caption-injection-output-adapter.ts`.
- **INFO D-EP20-CAP-02:** Browser bundles still pass after exporting the adapter from `@lyricue/core/output`; no Node-only dependency leaked into renderer builds.

## Network / data layer observations
- Network: No live FreeShow WebSocket endpoint was used. Transport was mocked at the adapter boundary.
- Data layer: Not applicable; adapter sends volatile output state only.
- IPC: Not applicable; this is a core adapter contract slice.
- External mutation: No GitHub discussion, upstream branch, or PR was created.

## Cumulative defect tally (if multi-pass)
| Pass | Scope | New defects | Critical | High | Medium | Low | Info |
|---|---|---:|---:|---:|---:|---:|---:|
| 2026-05-18 | EP20 upstream package | 0 | 0 | 0 | 0 | 0 | 0 |
| 2026-05-19 | EP20 caption adapter shell | 0 | 0 | 0 | 0 | 0 | 2 |

## Recommendations before production shipping
1. **HIGH:** After the upstream Captions extension lands, run this adapter against a real FreeShow WebSocket endpoint and capture render screenshots proving word-sweep parity.
2. **MEDIUM:** Add a sister-mode runtime selector that chooses `CaptionInjectionOutputAdapter` only when the configured FreeShow endpoint advertises word-sweep support.
3. **MEDIUM:** Keep `OwnWindowOutputAdapter` as the default sister-mode path until the upstream capability is detected in the field.

## Final verdict
Ship this code slice. EP20 now has a local, tested `CaptionInjectionOutputAdapter` shell that can emit both the proposed word-sweep payload and a degraded word-swap fallback. It is not production-complete for FreeShow rendering until the external upstream PR/capability boundary is resolved.
