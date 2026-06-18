# EP-08 STT binding contract

This document specifies the integration contract a real STT binding (whisper.cpp,
whisper-rs, faster-whisper, vosk, or any future replacement) must satisfy to wire
into LyriCue's `LiveSttCorrectionController`.

Status: contract pinned; no-op transcriber provided as a default. Binding
implementation is a separate, platform-specific task (the original whisper.cpp
package no longer resolves on npm).

## The contract

LyriCue's STT pipeline runs as a host-neutral pure-TypeScript controller that
calls into a transcriber function once per rolling window:

```typescript
export type SttWindowTranscriber = (
    samples: Float32Array,
    context: SttWindowContext
) => Promise<SttTranscript | null>

export interface SttWindowContext {
    sampleRate: number          // typically 16000 — downsampled from the 48000 audio input
    windowStartedAtMs: number   // wall-clock ms at the start of the window
    windowEndedAtMs: number     // wall-clock ms at the end of the window
    droppedWindows: number      // count of windows the rolling buffer dropped due to backpressure
}

export interface SttTranscript {
    text: string                // the recognised text, lowercased; punctuation tolerated
    confidence: number          // [0,1], implementation-defined semantics
}
```

A binding implementation MUST:

1. **Honour the input shape.** `samples` is a `Float32Array` of length
   `sampleRate * windowSeconds` (typically 16_000 × 0.5 = 8_000 samples for a
   half-second window at 16kHz). Range is roughly `[-1.0, 1.0]`.

2. **Be asynchronous.** Return a `Promise<SttTranscript | null>`. The controller
   awaits the promise before scheduling the next window, so a slow transcription
   does not stack up calls — it produces backpressure that the rolling window
   surfaces via `droppedWindows`.

3. **Return null for "no recognition".** This is the documented signal for "audio
   was processed but nothing intelligible was recognised". Downstream
   phrase-matcher treats null as a no-op (no correction event emitted), which is
   correct: live worship has silent passages, instrumental breaks, and the
   operator should not see correction events triggered by noise.

4. **Never throw for transient transcription failures.** A model load failure,
   GPU OOM, or transient backend error MUST be caught inside the transcriber
   and returned as null. The controller treats thrown errors as fatal and
   takes the STT pipeline down (intentional: a broken transcriber pumping
   `console.error` per window would flood logs).

5. **Honour the `context.sampleRate`.** Bindings that require a specific input
   rate (whisper.cpp wants 16000) MUST verify the rate matches their model's
   expectation and reject the binding at construction time (NOT per-window) if
   it does not.

6. **Single-threaded semantics from the controller's perspective.** The
   controller will not call the transcriber concurrently. A binding that
   wraps a thread-pool internally is fine; the contract only requires that
   the returned promise resolves before the next call.

## Reference implementations (provided)

- `createNoOpTranscriber()` — always returns null. Use for STT-disabled deploys,
  pre-binding integration testing, and the default fallback.
- `createConstantTranscriber(text, confidence)` — always returns the same
  transcript. Use for deterministic phrase-matching tests.

Both live in `packages/core/src/stt/no-op-transcriber.ts`.

## Wiring a real binding

Plug into `LiveSttCorrectionController` at construction time:

```typescript
import { createLiveSttCorrectionController } from "@lyricue/core/stt"
import { createMyBinding } from "@my-org/lyricue-whisper-binding"

const controller = createLiveSttCorrectionController({
    transcribe: createMyBinding({ modelPath: "/path/to/ggml-base.en.bin" }),
    // ... other controller options
})
```

The host (sister-mode main.ts, eventually fork-mode FreeShow integration) wires:

- Audio input pipeline → controller's audio-feed input
- Controller's correction events → SyncEngine.dispatch({kind:"positionCorrection",...})
- SettingsStore.sync.sttEnabled → toggles transcriber between no-op and real binding

## What's deferred

- The real binding selection. Candidates: `whisper-node` (deprecated upstream),
  `whisper-rs` via napi bindings (active), `faster-whisper` via Python sidecar
  call-back (would require sidecar-controller plumbing). Decision lives in
  EP-08 closure when a target binding is selected.
- Per-platform packaging of the chosen binding's native artifacts.
- Model file download / management (probably reuses EP-04's
  model-download-manager + manifest infrastructure).
- A `nullTranscriber` settings-driven kill switch at the controller level — the
  no-op transcriber already provides this; the SettingsStore wiring is a one-line
  conditional in the host.

## Acceptance criteria for "EP-08 binding complete"

- A binding package shipped to npm OR vendored in a sibling repo, implementing
  `SttWindowTranscriber`.
- A regression test that runs a real model against a known audio clip and
  produces the expected text.
- Packaged sister-mode app launches with the binding wired and recognises a
  phrase in real-time within the controller's cadence budget (default 500ms).
- Operator can toggle STT correction on/off via Settings without restarting the
  app (controller swaps the no-op transcriber in/out).
