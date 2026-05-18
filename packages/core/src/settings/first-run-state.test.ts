import { describe, it, expect } from "vitest"
import { draftToIdentity, draftToLibraryConfig, newWizardDraft, nextStep, prevStep, WIZARD_STEPS } from "./first-run-state.js"

describe("first-run wizard state machine", () => {
    it("starts on welcome", () => {
        const draft = newWizardDraft()
        expect(draft.currentStep).toBe("welcome")
        expect(draft.isAnonymous).toBe(true)
        expect(draft.libraryUrl).toBe("")
    })

    it("walks forward through every step", () => {
        let step = WIZARD_STEPS[0]
        const seen: typeof WIZARD_STEPS[number][] = [step]
        while (step !== "done") {
            step = nextStep(step)
            seen.push(step)
        }
        expect(seen).toEqual(["welcome", "audio", "library", "identity", "publish", "done"])
    })

    it("never advances past 'done'", () => {
        expect(nextStep("done")).toBe("done")
    })

    it("never reverses before 'welcome'", () => {
        expect(prevStep("welcome")).toBe("welcome")
    })

    it("prev then next is identity (except at edges)", () => {
        expect(nextStep(prevStep("library"))).toBe("library")
    })
})

describe("draftToIdentity", () => {
    it("anonymous + local-only when nothing has been filled in", () => {
        const id = draftToIdentity(newWizardDraft())
        expect(id.org.id).toBe("local")
        expect(id.campus.id).toBe("default")
        expect(id.user?.isAnonymous).toBe(true)
        expect(id.user).not.toHaveProperty("displayName")
    })

    it("uses library-detected org name when present, slugged into kebab-case", () => {
        const draft = newWizardDraft()
        draft.detectedOrgName = "Hillside Church!"
        const id = draftToIdentity(draft)
        expect(id.org.name).toBe("Hillside Church!")
        expect(id.org.id).toBe("hillside-church")
    })

    it("uses catalog-provided org id when present", () => {
        const draft = newWizardDraft()
        draft.detectedOrgName = "Hillside Church"
        draft.detectedOrgId = "hillside"
        const id = draftToIdentity(draft)
        expect(id.org).toEqual({ id: "hillside", name: "Hillside Church" })
    })

    it("preserves named-user identity when isAnonymous is false and a display name is set", () => {
        const draft = newWizardDraft()
        draft.isAnonymous = false
        draft.userDisplayName = "Thabo"
        const id = draftToIdentity(draft)
        expect(id.user?.isAnonymous).toBe(false)
        expect(id.user?.displayName).toBe("Thabo")
    })

    it("trims whitespace and falls back to undefined displayName when the field is empty after trim", () => {
        const draft = newWizardDraft()
        draft.isAnonymous = false
        draft.userDisplayName = "   "
        const id = draftToIdentity(draft)
        expect(id.user?.isAnonymous).toBe(false)
        expect(id.user?.displayName).toBeUndefined()
    })
})

describe("draftToLibraryConfig", () => {
    it("keeps the library disabled when the operator skipped the URL", () => {
        expect(draftToLibraryConfig(newWizardDraft())).toMatchObject({
            enabled: false,
            primaryUrl: null
        })
        expect(draftToLibraryConfig(newWizardDraft())).not.toHaveProperty("publishCredential")
    })

    it("stores only a secret ref and key id when a publish credential was accepted", () => {
        const draft = newWizardDraft()
        draft.libraryUrl = "https://library.example.org"
        draft.publishCredentialEntered = true
        draft.publishCredentialKeyId = "central-1"
        const config = draftToLibraryConfig(draft, { keyId: "central-1", handle: "safe-storage-ref" })

        expect(config.enabled).toBe(true)
        expect(config.primaryUrl).toBe("https://library.example.org")
        expect(config.publishCredential).toEqual({
            type: "cloudflare-worker-token",
            keyId: "central-1",
            secretRef: { keyId: "central-1", handle: "safe-storage-ref" }
        })
        expect(JSON.stringify(config)).not.toContain("credential-secret")
    })
})
