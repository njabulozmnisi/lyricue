import { defineConfig } from "vitest/config"
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte"

export default defineConfig({
    plugins: [
        svelte({
            preprocess: vitePreprocess(),
            // Keep Svelte 3/4 `new Component({...})` working under Svelte 5 so existing
            // component tests don't need to migrate to `mount()`. See svelte.config.js.
            compilerOptions: { compatibility: { componentApi: 4 } }
        })
    ],
    // Under vitest + jsdom, svelte's export map otherwise resolves to its server-side
    // runtime which can't render. Forcing the browser condition picks the client runtime.
    // See https://github.com/sveltejs/vite-plugin-svelte/issues/1041
    resolve: {
        conditions: ["browser"]
    },
    test: {
        name: "ui",
        environment: "jsdom",
        include: ["src/**/*.test.ts"],
        setupFiles: ["./test-setup.ts"]
    }
})
