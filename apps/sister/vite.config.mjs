/**
 * Vite config for the sister-mode renderer bundle.
 *
 * Build target: a single IIFE bundle loaded by `public/karaoke-output.html` as
 * `<script src="./build/karaoke-output.bundle.js">`. The bundle imports
 * `@lyricue/ui/KaraokeOutput.svelte` (Svelte 3) and mounts it.
 *
 * Why a real Vite build rather than a hand-rolled bootstrap:
 *   - `KaraokeOutput.svelte` is a `.svelte` file. The renderer can't import it natively;
 *     it needs the Svelte compiler. Vite + vite-plugin-svelte handle that.
 *   - The component imports from `@lyricue/core` (types) — Vite's workspace resolution
 *     handles that transparently.
 *   - We need a real build pipeline for STORY-02.4 (the walking-skeleton demo) anyway;
 *     starting it here keeps the pipeline straightforward.
 *
 * Why IIFE instead of ESM:
 *   - Electron loads the renderer HTML via `file://` URLs. Chromium refuses to load
 *     `<script type="module">` over `file://` for security (no CORS context). IIFE
 *     loads as a plain `<script>` tag with no module-loader constraints. This matches
 *     FreeShow's own build pattern (see freeshow/vite.config.mjs `formats: ["iife"]`).
 *   - The bundle is self-contained; no runtime imports = no module-loader needed.
 *
 * The build is intentionally minimal: no dev server (Electron loads from file://), no
 * code-splitting (one bundle keeps load semantics simple), no asset processing (just JS).
 */

import { defineConfig } from "vite"
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte"
import { resolve } from "node:path"

const production = process.env.NODE_ENV === "production"

export default defineConfig({
    plugins: [
        svelte({
            preprocess: vitePreprocess(),
            compilerOptions: {
                dev: !production,
                // Keep Svelte 3/4 `new Component({target})` API working under Svelte 5
                // so the karaoke-output-bootstrap doesn't need migrating to `mount()`.
                compatibility: { componentApi: 4 }
            }
        })
    ],
    // We hand-curate karaoke-output.html and don't rely on Vite's static-asset copying.
    // Disabling publicDir suppresses the "outDir nested in publicDir" warning that
    // otherwise fires because public/build is inside public/.
    publicDir: false,
    build: {
        // Output goes into apps/sister/public/build/ so the HTML's <link>/<script> tags
        // reference a stable relative path. Keeping karaoke-output.html outside the
        // build output (in public/) means emptyOutDir is safe to enable — Vite won't
        // touch the hand-curated HTML.
        outDir: "public/build",
        emptyOutDir: true,

        // Produce a single IIFE bundle suitable for a classic <script> tag (see above).
        lib: {
            entry: resolve("src/renderer/karaoke-output-bootstrap.ts"),
            name: "lyricueKaraokeOutput",
            formats: ["iife"],
            fileName: () => "karaoke-output.bundle.js"
        },
        rollupOptions: {
            // Bundle everything — Electron's renderer has no module loader and no CDN.
            external: [],
            output: {
                // Stable CSS filename so the HTML's <link> tag never has to chase hashes.
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name?.endsWith(".css")) return "karaoke-output.bundle.css"
                    return "[name][extname]"
                }
            }
        },
        sourcemap: !production
    },
    resolve: {
        // Match FreeShow's de-duplication: avoid pulling in two copies of Svelte.
        dedupe: ["svelte"]
    }
})
