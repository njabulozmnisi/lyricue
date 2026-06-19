import { vitePreprocess } from "@sveltejs/vite-plugin-svelte"

export default {
    preprocess: vitePreprocess(),
    // Svelte 5 compatibility mode: keep the Svelte 3 / 4 `new Component({...})`
    // construction API working so existing components + tests don't need to migrate
    // to `mount()`. Per https://svelte.dev/docs/svelte/v5-migration-guide
    compilerOptions: {
        compatibility: { componentApi: 4 }
    }
}
