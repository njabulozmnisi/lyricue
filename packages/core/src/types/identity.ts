/**
 * InstallIdentity — the org/campus/user triple stored per install.
 *
 * Per architecture.md §6.3:
 *   - None of these fields are credentials. They are tags used for attribution and provenance.
 *   - Credentials, when needed for publishing, are stored separately via OS keychain and never logged.
 *   - Anonymous-by-default is a first-class mode (MC-NFR6), not a degraded one. A campus can run
 *     fully anonymously and the library records publications as `{ campus: 'x', user: null }`.
 *
 * Validators below produce Result objects rather than throwing, so callers can surface
 * structured errors without try/catch boilerplate.
 */

import { z } from "zod"
import { SCHEMA_LYRICUE_IDENTITY_V1 } from "./schema-versions.js"

/**
 * Common shape for any identifier that goes on disk or on the wire.
 * Lowercase kebab-case is enforced so paths and URLs stay clean.
 *
 * Examples: "hillside-church", "pretoria-north", "thabo-mnisi-2026"
 */
export const KebabIdSchema = z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/, {
        message: "id must be lowercase kebab-case (a-z, 0-9, hyphens; no leading/trailing hyphen)"
    })

export const InstallIdentitySchema = z.object({
    $schema: z.literal(SCHEMA_LYRICUE_IDENTITY_V1),

    org: z.object({
        id: KebabIdSchema,
        name: z.string().min(1).max(200)
    }),

    campus: z.object({
        id: KebabIdSchema,
        name: z.string().min(1).max(200)
    }),

    /**
     * Optional user. Always optional — anonymous-by-default per MC-NFR6.
     * When absent, attribution records the campus but no individual user.
     */
    user: z
        .object({
            id: KebabIdSchema.optional(),
            displayName: z.string().min(1).max(100).optional(),
            isAnonymous: z.boolean()
        })
        .optional()
})

export type InstallIdentity = z.infer<typeof InstallIdentitySchema>

/**
 * Default identity for a fresh install before the first-run wizard completes.
 * The user is fully anonymous; the org and campus are placeholders so the app
 * remains usable without library access.
 */
export const DEFAULT_INSTALL_IDENTITY: InstallIdentity = {
    $schema: SCHEMA_LYRICUE_IDENTITY_V1,
    org: { id: "local", name: "Local" },
    campus: { id: "default", name: "Default" },
    user: { isAnonymous: true }
}
