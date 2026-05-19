import { promises as fs } from "node:fs"
import { dirname } from "node:path"
import { writeFileAtomic } from "../fs/atomic-write.js"
import type { LyriCuePaths } from "../settings/paths.js"
import { normalizeProject, type Project } from "./project-adapter.js"

export interface ProjectStorageOptions {
    paths: LyriCuePaths
}

export class ProjectStorage {
    readonly #paths: LyriCuePaths

    constructor(opts: ProjectStorageOptions) {
        this.#paths = opts.paths
    }

    async loadActiveProject(): Promise<Project | null> {
        let raw: string
        try {
            raw = await fs.readFile(this.#paths.activeProjectFile, "utf8")
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
            throw err
        }
        return normalizeProject(JSON.parse(raw))
    }

    async saveActiveProject(project: Project): Promise<void> {
        const normalized = normalizeProject(project)
        await fs.mkdir(dirname(this.#paths.activeProjectFile), { recursive: true })
        await writeFileAtomic(this.#paths.activeProjectFile, `${JSON.stringify(normalized, null, 4)}\n`)
    }
}
