/**
 * LyriCueSettings — the full operator-facing settings tree.
 *
 * Per architecture.md §6.5. Every field has a default below; the UI in EP-10 (Settings tab)
 * exposes each subsection as a panel. Settings persist atomically per ADR-7.
 *
 * Naming convention:
 *   - Boolean toggles use `enabled` rather than `isEnabled` or `useX` for brevity.
 *   - Times are in seconds (FP) or milliseconds (integer); the suffix on the field name
 *     is mandatory so units are never ambiguous.
 *   - Colors are 7-character hex (`#RRGGBB`); validators reject other forms.
 */

import { z } from "zod"
import { SCHEMA_LYRICUE_SETTINGS_V1 } from "./schema-versions.js"

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: "color must be 7-char hex like #FFCC00" })

const Opacity = z.number().min(0).max(1)

const KeyCode = z.string().min(1).max(40).describe("KeyboardEvent.code value (e.g. 'Space', 'ArrowRight', 'KeyN')")

const DisplaySettingsSchema = z.object({
    mode: z.enum(["karaoke", "section", "traditional"]).default("karaoke"),

    /** Seconds of lead before a section change. PRD AC4.2: 0.0–5.0 in 0.5 increments. */
    leadTimeSeconds: z.number().min(0).max(5).default(2.0),

    highlightColor: HexColor.default("#FFCC00"),
    sungColor: HexColor.default("#666666"),
    upcomingColor: HexColor.default("#CCCCCC"),

    animationType: z.enum(["sweep", "glow", "bold"]).default("sweep"),
    sungWordOpacity: Opacity.default(0.4),

    /** Base font size in pixels; renderer applies vmin-based clamping on top. */
    fontSize: z.number().int().min(12).max(200).default(48),
    fontFamily: z.string().min(1).max(80).default("Inter"),

    heldNoteAnimation: z.enum(["pulse", "glow", "static"]).default("pulse"),

    parallelLyricsEnabled: z.boolean().default(false),
    primaryLyricsLanguage: z.string().min(2).max(10).optional(), // BCP-47; omitted means timing-map language remains primary.
    parallelLyricsLanguage: z.string().min(2).max(10).optional() // BCP-47 (e.g. "zu-ZA")
})

const SyncSettingsSchema = z.object({
    /** OS-provided MediaDeviceInfo.deviceId; null = no device selected yet. */
    audioInputDeviceId: z.string().nullable().default(null),

    tempoSmoothingWindowMs: z.number().int().min(500).max(10_000).default(2000),

    /** Below this beat confidence, sustained → degrade Auto → Timer (architecture §4.8). */
    minBeatConfidence: Opacity.default(0.4),

    /** How long low confidence must persist before tier degrades. PRD: 10 s default. */
    confidenceFailoverSeconds: z.number().min(1).max(60).default(10),

    sttEnabled: z.boolean().default(true),

    /** PRD FR4.6: minimum consecutive STT words for a position-correction trigger. */
    positionCorrectionMinWords: z.number().int().min(1).max(10).default(3),

    /** PRD AC3.2: after manual intervention, hold auto-sync for this many seconds. */
    manualOverrideDebounceSeconds: z.number().min(0).max(30).default(3),

    /** VAD energy thresholds (raw RMS, device-dependent — usually 0.0–1.0). */
    vadEnterThreshold: z.number().min(0).max(1).default(0.05),
    vadExitThreshold: z.number().min(0).max(1).default(0.02),
    vadEnterMs: z.number().int().min(0).max(5000).default(300),
    vadExitMs: z.number().int().min(0).max(10_000).default(1500)
})

const ShortcutsSchema = z.object({
    startSync: KeyCode.default("Space"),
    nextSection: KeyCode.default("ArrowRight"),
    prevSection: KeyCode.default("ArrowLeft"),
    toggleManual: KeyCode.default("Escape"),
    reEngageSync: KeyCode.default("Enter")
})

const SidecarSettingsSchema = z.object({
    /**
     * Overrides the bundled Python interpreter. Almost never set in production
     * (the installer ships a PyInstaller bundle). Useful for development against a venv.
     */
    pythonPath: z.string().nullable().default(null),

    demucsModel: z.enum(["htdemucs", "htdemucs_ft", "mdx_extra"]).default("htdemucs"),
    whisperxModel: z.enum(["tiny", "base", "small", "medium"]).default("small")
})

const CommunitySettingsSchema = z.object({
    /** Library is opt-in. Off by default; first-run wizard prompts for it. */
    libraryEnabled: z.boolean().default(false),

    /** When this campus publishes, omit the user displayName from manifests. */
    submitAnonymously: z.boolean().default(false)
})

export const LyriCueSettingsSchema = z.object({
    $schema: z.literal(SCHEMA_LYRICUE_SETTINGS_V1),
    display: DisplaySettingsSchema.default({}),
    sync: SyncSettingsSchema.default({}),
    shortcuts: ShortcutsSchema.default({}),
    sidecar: SidecarSettingsSchema.default({}),
    community: CommunitySettingsSchema.default({})
})

export type LyriCueSettings = z.infer<typeof LyriCueSettingsSchema>

/**
 * Default settings for a fresh install. Computed via Zod so it stays in sync with the schema.
 */
export const DEFAULT_LYRICUE_SETTINGS: LyriCueSettings = LyriCueSettingsSchema.parse({
    $schema: SCHEMA_LYRICUE_SETTINGS_V1
})
