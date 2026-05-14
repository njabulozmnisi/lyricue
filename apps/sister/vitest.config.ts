import { defineConfig } from "vitest/config"

export default defineConfig({
    test: {
        name: "sister",
        environment: "node",
        include: ["src/**/*.test.ts"]
    }
})
