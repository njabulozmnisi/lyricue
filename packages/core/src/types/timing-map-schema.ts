/**
 * TimingMap, Arrangement, ParallelLyricsTrack — Zod runtime validators.
 *
 * Per EP-03 STORY-03.1. The canonical TS shape lives in `./timing-map.ts`; this file
 * adds the runtime checks every consumer needs at boundaries (file IO, IPC, library
 * imports). The two MUST stay in sync — if a field is added to the TS interface, it
 * must also appear in the Zod schema, and vice versa. Tests in `timing-map-schema.test.ts`
 * enforce that by exercising every field and every kind of structural error.
 *
 * Design choices:
 *   - We use Zod 3.x — already a dependency of @lyricue/core for settings validation.
 *     Schemas compose, error messages carry JSON paths, and z.infer<typeof X> derives
 *     the TS type so we don't double-declare.
 *   - `validateTimingMap` returns `Result<TimingMap, ValidationError[]>` rather than
 *     throwing — every error becomes addressable data the caller can render. Live
 *     worship can't pause for an exception (NFR2.1) so validators report; they don't crash.
 *   - We include the full list of issues, not just the first. Operators editing a
 *     timing map need to see every problem at once.
 *
 * Why a separate file from `timing-map.ts`:
 *   - The TS file is consumed by *everything* (the Sync Engine's hot path, the renderer's
 *     IPC types). Pulling Zod into that file would force Zod into every dependent bundle.
 *   - The schema is consumed only at boundaries (load/save/import/IPC entry). Keeping it
 *     separate means runtime-validator-only consumers can tree-shake.
 */

import { z } from "zod"
import { SCHEMA_LYRICUE_TIMING_V1 } from "./schema-versions.js"
import type { TimingMap, TimingSection, TimingWord, TimingLine, Arrangement, ArrangementStep, ParallelLyricsTrack } from "./timing-map.js"

/**
 * Structured validation error. JSON path follows Zod's `path` array convention but
 * joined as a dot-separated string for human display. `code` mirrors Zod's issue codes
 * so callers can branch on machine-readable values without parsing messages.
 */
export interface ValidationError {
    /** Dot-separated path into the input — e.g. "sections.0.words.5.startMs". */
    path: string
    /** Zod issue code — "invalid_type", "too_small", "custom", etc. */
    code: string
    /** Human-readable description. */
    message: string
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; errors: E }

const timingWordSchema = z
    .object({
        text: z.string().min(1, "word text cannot be empty"),
        startMs: z.number().nonnegative("startMs must be >= 0"),
        endMs: z.number().nonnegative("endMs must be >= 0"),
        confidence: z.number().min(0).max(1).nullable(),
        lineIndex: z.number().int().nonnegative(),
        held: z.boolean().optional()
    })
    .refine((w) => w.endMs >= w.startMs, {
        message: "endMs must be >= startMs",
        path: ["endMs"]
    })

const timingLineSchema = z
    .object({
        startMs: z.number().nonnegative(),
        endMs: z.number().nonnegative(),
        wordStartIndex: z.number().int().nonnegative(),
        wordEndIndex: z.number().int().nonnegative()
    })
    .refine((l) => l.endMs >= l.startMs, {
        message: "line endMs must be >= startMs",
        path: ["endMs"]
    })
    .refine((l) => l.wordEndIndex >= l.wordStartIndex, {
        message: "wordEndIndex must be >= wordStartIndex",
        path: ["wordEndIndex"]
    })

const timingSectionTypeSchema = z.enum(["verse", "chorus", "bridge", "pre-chorus", "tag", "intro", "outro", "other"])

const timingSectionSchema = z
    .object({
        id: z.string().min(1, "section id cannot be empty"),
        type: timingSectionTypeSchema,
        label: z.string().min(1),
        slideIndex: z.number().int().nonnegative(),
        startMs: z.number().nonnegative(),
        endMs: z.number().nonnegative(),
        words: z.array(timingWordSchema),
        lines: z.array(timingLineSchema)
    })
    .refine((s) => s.endMs >= s.startMs, {
        message: "section endMs must be >= startMs",
        path: ["endMs"]
    })

const learnedFromSchema = z.object({
    method: z.enum(["studio", "rehearsal", "imported"]),
    filename: z.string().optional(),
    duration: z.number().positive("learnedFrom.duration must be > 0"),
    learnedAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
        message: "learnedAt must be a valid ISO-8601 timestamp"
    }),
    source: z.string().optional()
})

const timingMapMetadataSchema = z.object({
    demucsModel: z.string().optional(),
    whisperxModel: z.string().optional(),
    schemaVersion: z.literal("1"),
    version: z.string().min(1)
})

const parallelLyricsSectionSchema = z.object({
    sectionId: z.string().min(1),
    text: z.string()
})

export const parallelLyricsTrackSchema = z.object({
    language: z.string().min(2),
    sections: z.array(parallelLyricsSectionSchema)
})

/**
 * Top-level TimingMap schema. The `$schema` literal pins the file to the
 * `lyricue-timing-v1` schema URI so older readers can reject files they don't
 * understand and the migration framework (STORY-03.6) can dispatch on version.
 */
export const timingMapSchema = z
    .object({
        $schema: z.literal(SCHEMA_LYRICUE_TIMING_V1),
        showId: z.string().min(1, "showId cannot be empty"),
        learnedFrom: learnedFromSchema,
        bpm: z.number().positive("bpm must be > 0"),
        timeSignature: z.string().optional(),
        language: z.string().min(2, "language must be a BCP-47 code, e.g. 'en'"),
        sections: z.array(timingSectionSchema),
        parallel: z.array(parallelLyricsTrackSchema).optional(),
        metadata: timingMapMetadataSchema
    })
    .superRefine((map, ctx) => {
        const sectionIds = new Set(map.sections.map((section) => section.id))
        map.parallel?.forEach((track, trackIndex) => {
            track.sections.forEach((section, sectionIndex) => {
                if (!sectionIds.has(section.sectionId)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ["parallel", trackIndex, "sections", sectionIndex, "sectionId"],
                        message: `parallel lyric sectionId "${section.sectionId}" does not exist in timing map sections`
                    })
                }
            })
        })
    })

const arrangementStepSchema = z.object({
    sectionId: z.string().min(1)
})

export const arrangementSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    showId: z.string().min(1),
    isDefault: z.boolean(),
    sequence: z.array(arrangementStepSchema),
    createdAt: z.string().refine((s) => !Number.isNaN(Date.parse(s))),
    updatedAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)))
})

/**
 * Converts a Zod error into the project's ValidationError shape. We expose path as a
 * dotted string because that's what operators see in the Timing Preview UI (EP-11);
 * the underlying array form is preserved in `issue.path` if a caller ever needs it.
 */
function zodIssuesToValidationErrors(error: z.ZodError): ValidationError[] {
    return error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message
    }))
}

/**
 * Validate an unknown value as a TimingMap. Returns `{ ok: true, value }` on success
 * with the parsed (and TS-typed) map; returns `{ ok: false, errors }` on failure with
 * every problem found. Never throws.
 *
 * Callers MUST use this at every boundary: file load, IPC receive, library import.
 * The Sync Engine's hot path assumes the map has already been validated and treats
 * it as a trusted shape (no runtime checks per-frame — NFR1.3 budget is tight).
 */
export function validateTimingMap(input: unknown): Result<TimingMap, ValidationError[]> {
    const parsed = timingMapSchema.safeParse(input)
    if (!parsed.success) return { ok: false, errors: zodIssuesToValidationErrors(parsed.error) }
    return { ok: true, value: parsed.data as unknown as TimingMap }
}

export function validateArrangement(input: unknown): Result<Arrangement, ValidationError[]> {
    const parsed = arrangementSchema.safeParse(input)
    if (!parsed.success) return { ok: false, errors: zodIssuesToValidationErrors(parsed.error) }
    return { ok: true, value: parsed.data as unknown as Arrangement }
}

export function validateArrangements(input: unknown): Result<Arrangement[], ValidationError[]> {
    const parsed = z.array(arrangementSchema).safeParse(input)
    if (!parsed.success) return { ok: false, errors: zodIssuesToValidationErrors(parsed.error) }
    return { ok: true, value: parsed.data as unknown as Arrangement[] }
}

export function validateParallelLyricsTrack(input: unknown): Result<ParallelLyricsTrack, ValidationError[]> {
    const parsed = parallelLyricsTrackSchema.safeParse(input)
    if (!parsed.success) return { ok: false, errors: zodIssuesToValidationErrors(parsed.error) }
    return { ok: true, value: parsed.data as unknown as ParallelLyricsTrack }
}

/**
 * Type re-exports so callers can import everything from this one file. The TS types
 * are authoritative — these aliases just save one import line.
 */
export type { TimingMap, TimingSection, TimingWord, TimingLine, Arrangement, ArrangementStep, ParallelLyricsTrack }
