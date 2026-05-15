/**
 * Ambient declarations for `.svelte` imports.
 *
 * TypeScript does not natively understand `.svelte` files. The sister-mode renderer
 * imports KaraokeOutput.svelte directly from @lyricue/ui (Vite handles the actual
 * compilation at build time via vite-plugin-svelte). Without this declaration,
 * `tsc` rejects the import.
 *
 * This declaration is intentionally permissive — the Svelte 3 component type is
 * complex and we don't need to enforce shape here (the call site passes well-typed
 * props at construction time, and any prop-shape mismatch surfaces from Svelte
 * itself via svelte-check).
 *
 * If we later add shape validation (e.g., for hot-reload-safe API checks), we'd
 * import from "svelte" and tighten this to `typeof SvelteComponent` — but for now,
 * the permissive form matches how every Svelte 3 + TS project we audited handles it.
 */

declare module "*.svelte" {
    import type { SvelteComponent } from "svelte"
    const Component: typeof SvelteComponent
    export default Component
}
