import { defineConfig } from "vitest/config"

export default defineConfig({
    test: {
        name: "fork",
        environment: "node",
        include: ["src/**/*.test.ts"],
        exclude: ["freeshow/**", "node_modules/**"]
    }
})
