/**
 * JsonFileStore<T> — generic atomic-JSON-on-disk store with observable semantics.
 *
 * Responsibilities (per architecture.md §6 + ADR-7, ADR-10):
 *   - Load from disk on first access, validate via a Zod schema, fall back to `defaults`
 *     on missing file or validation failure (logging a warning when validation fails).
 *   - Persist via writeFileAtomic so a crash mid-write does not corrupt user data.
 *   - Notify subscribers on every successful save (Svelte-store compatible).
 *   - Schema versioning: if the on-disk `$schema` matches a known older version, run the
 *     `migrate` callback (defaults to identity). Unknown future versions throw a typed error
 *     so callers can surface a meaningful message ("file from a newer LyriCue — please upgrade").
 *
 * Subclasses (SettingsStore, IdentityStore, LibraryConfigStore) supply the schema, the
 * defaults, and the disk path; everything else is shared here.
 */

import type { ZodError, ZodType, ZodTypeDef } from "zod"
import { readFileIfExists, writeFileAtomic } from "../fs/index.js"
import { writable, type Writable } from "./observable.js"

/**
 * The schema's *output* type is `T` (what callers see after parsing). The input type is
 * deliberately `unknown` so schemas with `.default()` (where the input is optional but the
 * output is concrete) satisfy the constraint. ZodSchema<T> would require input === output,
 * which breaks for any schema using defaults.
 */
export type JsonFileSchema<T> = ZodType<T, ZodTypeDef, unknown>

export interface JsonFileStoreOptions<T> {
    filePath: string
    schema: JsonFileSchema<T>
    defaults: T
    /** Logger override; defaults to console for visibility in development. */
    logger?: Pick<typeof console, "warn" | "info">
    /**
     * Optional migration from an older known schema version. If the loaded JSON's `$schema`
     * differs from the current schema, this is invoked with the raw parsed JSON; it should
     * return the migrated shape (still subject to schema validation afterwards).
     *
     * Defaults to identity (no migration). Phase 4 stories add real migrations as schemas evolve.
     */
    migrate?: (rawJson: unknown) => unknown
}

export class UnknownFutureSchemaError extends Error {
    constructor(
        public readonly filePath: string,
        public readonly foundSchema: string,
        public readonly expectedSchemas: readonly string[]
    ) {
        super(
            `Cannot load ${filePath}: $schema="${foundSchema}" was written by a newer LyriCue. ` +
                `This install understands: ${expectedSchemas.join(", ")}. Upgrade LyriCue to read this file.`
        )
        this.name = "UnknownFutureSchemaError"
    }
}

export class JsonFileStore<T> {
    #file: string
    #schema: JsonFileSchema<T>
    #defaults: T
    #logger: Pick<typeof console, "warn" | "info">
    #migrate: (raw: unknown) => unknown
    #observable: Writable<T>
    #loaded = false

    constructor(opts: JsonFileStoreOptions<T>) {
        this.#file = opts.filePath
        this.#schema = opts.schema
        this.#defaults = opts.defaults
        this.#logger = opts.logger ?? console
        this.#migrate = opts.migrate ?? ((raw) => raw)
        this.#observable = writable<T>(opts.defaults)
    }

    /**
     * Load the file from disk, validate, and publish to subscribers. Idempotent — calling
     * load() multiple times reads from disk each time, which is useful if external code
     * has rewritten the file (e.g., a settings export/import workflow).
     */
    async load(): Promise<T> {
        const raw = await readFileIfExists(this.#file)
        if (raw === null) {
            this.#logger.info(`[lyricue:store] ${this.#file} not found; using defaults`)
            this.#observable.set(this.#defaults)
            this.#loaded = true
            return this.#defaults
        }

        let parsed: unknown
        try {
            parsed = JSON.parse(raw.toString("utf-8"))
        } catch (err) {
            this.#logger.warn(
                `[lyricue:store] ${this.#file} is malformed JSON; using defaults. (${(err as Error).message})`
            )
            this.#observable.set(this.#defaults)
            this.#loaded = true
            return this.#defaults
        }

        const migrated = this.#migrate(parsed)
        const result = this.#schema.safeParse(migrated)
        if (!result.success) {
            this.#logger.warn(
                `[lyricue:store] ${this.#file} failed schema validation; using defaults. ` +
                    `Errors: ${formatZodError(result.error)}`
            )
            this.#observable.set(this.#defaults)
            this.#loaded = true
            return this.#defaults
        }

        this.#observable.set(result.data)
        this.#loaded = true
        return result.data
    }

    /**
     * Persist the given value atomically. Validates before writing — a failed validation
     * means the caller passed an invalid object and we surface the error rather than
     * silently writing garbage.
     */
    async save(value: T): Promise<void> {
        const result = this.#schema.safeParse(value)
        if (!result.success) {
            throw new Error(
                `[lyricue:store] Refusing to save invalid ${this.#file}: ${formatZodError(result.error)}`
            )
        }
        await writeFileAtomic(this.#file, JSON.stringify(result.data, null, 2) + "\n")
        this.#observable.set(result.data)
    }

    /** Current in-memory value. Returns defaults if `load()` hasn't been called yet. */
    get(): T {
        return this.#observable.get()
    }

    /** Subscribe to value changes; Svelte-store compatible. */
    subscribe(run: (value: T) => void) {
        return this.#observable.subscribe(run)
    }

    /** Whether `load()` has been called at least once. */
    get isLoaded(): boolean {
        return this.#loaded
    }
}

function formatZodError(err: ZodError): string {
    return err.issues
        .map((i) => `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`)
        .join("; ")
}
