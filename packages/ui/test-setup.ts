/**
 * Vitest setup file for packages/ui.
 *
 * JSDOM doesn't implement the Web Animations API (Element.prototype.animate).
 * Svelte 5's transitions invoke it during component destroy, which throws
 * "element.animate is not a function" — surfaced as unhandled errors at the
 * end of the test run even though tests pass. Stub it to a no-op so the
 * transitions complete silently.
 */
if (typeof Element !== "undefined" && typeof (Element.prototype as any).animate !== "function") {
    ;(Element.prototype as any).animate = function animate(): { onfinish: null; cancel(): void; finished: Promise<void> } {
        return {
            onfinish: null,
            cancel() {},
            finished: Promise.resolve()
        }
    }
}
