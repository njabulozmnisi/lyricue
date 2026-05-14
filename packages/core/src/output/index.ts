/**
 * @lyricue/core/output — production-only exports.
 *
 * Test utilities (MockOutputAdapter, generateFrameSequence, makeFrame, nextFrame) live
 * in `./test-utils.js` and are exported via the @lyricue/core/output/test-utils subpath,
 * not from this index. This keeps test-only types out of the production import graph.
 */

export * from "./output-adapter.js"
export * from "./sync-frame.js"
