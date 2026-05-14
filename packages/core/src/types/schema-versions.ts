/**
 * Schema version identifiers for every persisted LyriCue artifact.
 *
 * Per ADR-10 (architecture.md), all on-disk schemas carry a `$schema` literal so loaders
 * can detect unknown versions and refuse them, and so forward migrations can be applied
 * progressively. Schemas evolve via additive fields wherever possible (per P8); a
 * structural breaking change requires bumping the version and a new migration path.
 *
 * Keep these literals in one file so a future audit can grep one location to enumerate
 * everything we serialize.
 */

export const SCHEMA_LYRICUE_TIMING_V1 = "lyricue-timing-v1" as const
export const SCHEMA_LYRICUE_BUNDLE_V1 = "lyricue-bundle-v1" as const
export const SCHEMA_LYRICUE_CATALOG_V1 = "lyricue-catalog-v1" as const
export const SCHEMA_LYRICUE_IDENTITY_V1 = "lyricue-identity-v1" as const
export const SCHEMA_LYRICUE_LIBRARY_CONFIG_V1 = "lyricue-library-config-v1" as const
export const SCHEMA_LYRICUE_SETTINGS_V1 = "lyricue-settings-v1" as const

export type SchemaVersion =
    | typeof SCHEMA_LYRICUE_TIMING_V1
    | typeof SCHEMA_LYRICUE_BUNDLE_V1
    | typeof SCHEMA_LYRICUE_CATALOG_V1
    | typeof SCHEMA_LYRICUE_IDENTITY_V1
    | typeof SCHEMA_LYRICUE_LIBRARY_CONFIG_V1
    | typeof SCHEMA_LYRICUE_SETTINGS_V1
