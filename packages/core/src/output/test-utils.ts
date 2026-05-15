/**
 * Test utilities for OutputAdapter. Exported via @lyricue/core/output/test-utils so that
 * accidental imports from production code are visible in PR review.
 *
 * Real adapters (ForkOutputAdapter, OwnWindowOutputAdapter, CaptionInjectionOutputAdapter)
 * import from `@lyricue/core/output`; tests and demos import from `@lyricue/core/output/test-utils`.
 */

export * from "./mock-output-adapter.js"
export * from "./sync-frame-fixture.js"
export * from "./demo-timing-map.js"
export * from "./demo-runner.js"
