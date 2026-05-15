// @lyricue/core — mode-agnostic shared modules.
// Re-exports per-subsystem; consumers should generally prefer the deep subpath imports
// (e.g. "@lyricue/core/types") to keep tree-shaking effective. This top-level barrel
// exists for ergonomic top-level imports during development and in tests.

export * from "./types/index.js"
export * from "./fs/index.js"
export * from "./settings/index.js"
export * from "./output/index.js"
export * from "./diagnostics/index.js"
