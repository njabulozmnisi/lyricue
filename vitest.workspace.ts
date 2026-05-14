import { defineWorkspace } from "vitest/config"

export default defineWorkspace([
    "packages/core/vitest.config.ts",
    "packages/ui/vitest.config.ts",
    "apps/fork/vitest.config.ts",
    "apps/sister/vitest.config.ts"
])
