# EP06 Renderer Performance QA Report — 2026-05-18
**QA persona:** Senior QA analyst — click-by-click + network + console + data layer + defect triage
**Scope:** EP06.8 automated karaoke renderer performance guard for the sister-mode output window.
**Environment:** Local macOS dev, `LC_DEPLOYMENT_MODE=sister`, production-built Electron main/preload/renderer bundle.
**Status:** Pass

## Executive summary
The new sister-mode renderer performance harness launches the production Electron karaoke output path, loads `DEMO_TIMING_MAP`, pushes 1000 sync frames through `OwnWindowOutputAdapter`, and asserts the renderer path stays above 30fps with zero dropped frames. The live run passed at 46.9fps with 1000/1000 frames delivered and 0 dropped.

No defects were surfaced in this pass.

## Test environment + persona setup
- PASS — Repo built with the required `env -i` Node wrapper.
- PASS — Sister app compiled through `npm -w @lyricue/sister run build`.
- PASS — Renderer bundle loaded from `apps/sister/public/karaoke-output.html`.
- PASS — QA persona not applicable; this is a projector-output performance harness with no operator identity boundary.

## Test cases executed
| TC ID | Feature | Persona | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| EP06.8-TC1 | Karaoke renderer perf harness | Projector output | Launch production Electron output window and load the demo timing map | `LC_LOAD_MAP` received by renderer | PASS |
| EP06.8-TC2 | 1000-frame frame pump | Projector output | Push 1000 frames through `OwnWindowOutputAdapter` | 1000 delivered, 0 dropped | PASS |
| EP06.8-TC3 | 30fps floor | Projector output | Measured throughput remains >=30fps | 46.9fps | PASS |
| EP06.8-TC4 | Console/runtime health | Projector output | No renderer crash, no adapter error | Harness exited 0; `lastError=none` | PASS |

## Defects surfaced + fixed
None.

## Network / data layer observations
- Network not applicable; LyriCue live performance path is offline-first and the renderer harness does not make outbound calls.
- Data layer not applicable; the perf harness uses the in-repo `DEMO_TIMING_MAP` fixture and does not mutate persisted state.
- Adapter health at summary: `frames=1000 delivered=1000 dropped=0 elapsedMs=21327.0 fps=46.9 threshold=30 result=pass`.

## Cumulative defect tally (if multi-pass)
| Pass | Critical | High | Medium | Low | Info |
| --- | ---: | ---: | ---: | ---: | ---: |
| EP06 renderer performance 2026-05-18 | 0 | 0 | 0 | 0 | 0 |

## Recommendations before production shipping
1. **MEDIUM** Keep `npm -w @lyricue/sister run test:renderer-perf` in the release verification checklist and wire it into CI when Electron GUI execution is available on the runner.
2. **LOW** Capture hardware/OS metadata beside future perf results once the runner matrix includes non-macOS targets.

## Final verdict
EP06.8 is ship-ready for the local walking skeleton. The renderer has an executable regression guard for the 30fps floor, using the same Electron output adapter and renderer bundle as the sister-mode app.
