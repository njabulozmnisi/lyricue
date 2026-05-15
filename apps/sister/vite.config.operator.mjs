/**
 * Vite config for the sister-mode operator window bundle.
 *
 * Mirrors `vite.config.mjs` (which builds the karaoke output) but with a different
 * entry point + IIFE name + output filename. The operator window is a separate
 * BrowserWindow that hosts SetlistPanel + TierChangeBanner + the keyboard router.
 *
 * Both bundles share the same Svelte 3 + vite-plugin-svelte pipeline; running the
 * two configs sequentially produces two independent bundles in `public/build/`.
 *
 * Build target: `public/build/operator-window.bundle.{js,css}` loaded by
 * `public/operator-window.html` via classic `<script>`.
 */

import { defineConfig } from "vite"
import { svelte } from "@sveltejs/vite-plugin-svelte"
import sveltePreprocess from "svelte-preprocess"
import { resolve } from "node:path"

const production = process.env.NODE_ENV === "production"

export default defineConfig({
    plugins: [
        svelte({
            preprocess: sveltePreprocess({
                typescript: { compilerOptions: { verbatimModuleSyntax: false } }
            }),
            compilerOptions: { dev: !production }
        })
    ],
    publicDir: false,
    build: {
        outDir: "public/build",
        // Do NOT empty the dir — the karaoke-output bundle lives here too and we
        // build the two sequentially.
        emptyOutDir: false,
        lib: {
            entry: resolve("src/renderer/operator-window-bootstrap.ts"),
            name: "lyricueOperatorWindow",
            formats: ["iife"],
            fileName: () => "operator-window.bundle.js"
        },
        rollupOptions: {
            external: [],
            output: {
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name?.endsWith(".css")) return "operator-window.bundle.css"
                    return "[name][extname]"
                }
            }
        },
        sourcemap: !production
    },
    resolve: {
        dedupe: ["svelte"]
    }
})
