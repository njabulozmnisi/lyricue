import { describe, expect, it } from "vitest"
import { buildSetupLibraryPlan, normalizeOrgId } from "./setup-plan.js"

describe("library setup plan", () => {
    it("normalizes organization IDs for repeatable resource names", () => {
        expect(normalizeOrgId(" Hillside Church / Pretoria ")).toBe("hillside-church-pretoria")
    })

    it("builds an idempotent dry-run command plan", () => {
        const input = {
            orgId: "Hillside Church",
            orgName: "Hillside Church",
            cloudflareAccountId: "cf-account",
            githubMirrorRepo: "hillside/lyricue-library"
        }

        const first = buildSetupLibraryPlan(input)
        const second = buildSetupLibraryPlan(input)

        expect(first).toEqual(second)
        expect(first.bucketName).toBe("hillside-church-lyricue-library")
        expect(first.workerName).toBe("hillside-church-lyricue-publish")
        expect(first.commands).toEqual(
            expect.arrayContaining([
                "wrangler r2 bucket create hillside-church-lyricue-library",
                "wrangler kv namespace create hillside-church-lyricue-credentials",
                "wrangler secret put GITHUB_MIRROR_TOKEN --name hillside-church-lyricue-publish",
                "wrangler kv key put <central-token> '<central-credential-json>' --namespace-id <hillside-church-lyricue-credentials-id>"
            ])
        )
        expect(first.commands.some((command) => command.includes("delete") || command.includes("destroy"))).toBe(false)
        expect(first.artifacts.some((artifact) => artifact.path === "trust.json" && !artifact.sensitive)).toBe(true)
    })
})
