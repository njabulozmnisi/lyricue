import { defineConfig } from "vitest/config"

/**
 * Root vitest config. In vitest 4 the workspace concept moved from a separate
 * vitest.workspace.ts file (vitest 1-3) into the root config's `test.projects` field.
 * Each project entry is a path to a per-workspace vitest config.
 */
export default defineConfig({
    test: {
        projects: [
            "packages/core/vitest.config.ts",
            "packages/ui/vitest.config.ts",
            "apps/fork/vitest.config.ts",
            "apps/sister/vitest.config.ts"
        ]
    }
})
