/**
 * First-run wizard state model. Lives in core (not ui) so:
 *   - Host apps in either deployment mode can construct/mutate state without Svelte.
 *   - Persistence (resume after close, AC4) reads/writes this same shape.
 *
 * The wizard has 5 user-visible steps per architecture.md §8.4:
 *   1. Welcome
 *   2. Audio Input — device picker; stub in EP-01, real wiring in EP-07
 *   3. Library Connection — URL + optional Connect test; stub in EP-01, real in EP-13
 *   4. Identity — org/campus selection (or "Create new campus..."); user displayName
 *   5. Publish Access — optional credential; stub Test button in EP-01, real in EP-15
 *
 * Done state is reached after step 5 (or earlier-with-Skip), and the host writes the
 * final IdentityStore + LibraryConfigStore from this state.
 */

import { z } from "zod"
import { type InstallIdentity, KebabIdSchema } from "../types/identity.js"

export const WIZARD_STEPS = ["welcome", "audio", "library", "identity", "publish", "done"] as const
export type WizardStep = (typeof WIZARD_STEPS)[number]

/** Mutable working state held while the wizard is in flight. */
export const WizardDraftSchema = z.object({
    currentStep: z.enum(WIZARD_STEPS),

    /** Step 2 — selected audio input device id; resolved later by EP-07. */
    audioInputDeviceId: z.string().nullable().default(null),

    /** Step 3 — library URL the operator entered. Validated as URL when non-empty. */
    libraryUrl: z.string().default(""),

    /**
     * Step 3 — populated after a successful Connect test (which is a no-op stub in EP-01).
     * Used to pre-fill org name in step 4. Real catalog fetch lands in EP-13.
     */
    detectedOrgName: z.string().nullable().default(null),

    /** Step 4 — campus picker. Either an existing id from the catalog or a freshly entered one. */
    campusId: KebabIdSchema.optional(),
    campusName: z.string().min(1).max(200).optional(),

    /** Step 4 — user display name. Empty + anonymous toggle is the anonymous path. */
    userDisplayName: z.string().default(""),
    isAnonymous: z.boolean().default(true),

    /** Step 5 — optional. Test button result is a stub in EP-01. */
    publishCredentialEntered: z.boolean().default(false)
})
export type WizardDraft = z.infer<typeof WizardDraftSchema>

/** Returns the initial draft for a fresh first-run. */
export function newWizardDraft(): WizardDraft {
    return WizardDraftSchema.parse({ currentStep: "welcome" })
}

/**
 * Advance to the next step. The wizard is linear; this just walks the array.
 * Returns the new step (or "done" if we've finished).
 */
export function nextStep(current: WizardStep): WizardStep {
    const idx = WIZARD_STEPS.indexOf(current)
    return WIZARD_STEPS[Math.min(idx + 1, WIZARD_STEPS.length - 1)] ?? "done"
}

export function prevStep(current: WizardStep): WizardStep {
    const idx = WIZARD_STEPS.indexOf(current)
    return WIZARD_STEPS[Math.max(idx - 1, 0)] ?? "welcome"
}

/**
 * Produce the final InstallIdentity from a completed draft. Called by the host after
 * the operator clicks "Finish."
 *
 * Falls back gracefully when fields are missing — anonymous + local-only is a valid
 * outcome (the operator may have skipped library and identity steps entirely).
 */
export function draftToIdentity(draft: WizardDraft): InstallIdentity {
    const orgId = draft.detectedOrgName ? slug(draft.detectedOrgName) : "local"
    const orgName = draft.detectedOrgName ?? "Local"

    const campusId = draft.campusId ?? "default"
    const campusName = draft.campusName ?? "Default"

    return {
        $schema: "lyricue-identity-v1",
        org: { id: orgId, name: orgName },
        campus: { id: campusId, name: campusName },
        user: draft.isAnonymous
            ? { isAnonymous: true }
            : {
                  isAnonymous: false,
                  displayName: draft.userDisplayName.trim() || undefined
              }
    }
}

/** Lowercase-kebab a free-text name. Used for default org id when none was specified. */
function slug(input: string): string {
    const out = input
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    return out || "local"
}
