import { writable, type Readable } from "../settings/observable.js"

export interface ProjectShowRef {
    id: string
    title: string
    artist?: string
}

export interface Project {
    id: string
    title: string
    shows: ProjectShowRef[]
}

export interface ProjectAdapter {
    readonly activeProject: Readable<Project | null>
    getActiveProject(): Project | null
    refresh?(): Promise<Project | null>
}

export interface MutableProjectAdapter extends ProjectAdapter {
    setActiveProject(project: Project | null): void
}

export function createMemoryProjectAdapter(initialProject: Project | null = null): MutableProjectAdapter {
    const store = writable<Project | null>(initialProject)
    let current = initialProject
    return {
        activeProject: {
            subscribe(run) {
                return store.subscribe(run)
            }
        },
        getActiveProject() {
            return current
        },
        setActiveProject(project) {
            current = project
            store.set(project)
        }
    }
}

export interface RestProjectAdapterOptions {
    baseUrl: string
    fetchImpl?: typeof fetch
}

export function createRestProjectAdapter(opts: RestProjectAdapterOptions): ProjectAdapter {
    const fetchImpl = opts.fetchImpl ?? fetch
    const store = writable<Project | null>(null)
    let current: Project | null = null

    async function refresh(): Promise<Project | null> {
        const url = `${opts.baseUrl.replace(/\/+$/, "")}/v1/projects/active`
        const response = await fetchImpl(url)
        if (!response.ok) {
            throw new Error(`Project fetch failed: ${response.status} ${response.statusText}`.trim())
        }
        const payload = await response.json()
        current = normalizeProject(payload)
        store.set(current)
        return current
    }

    return {
        activeProject: { subscribe: (run) => store.subscribe(run) },
        getActiveProject: () => current,
        refresh
    }
}

function normalizeProject(payload: unknown): Project {
    if (!payload || typeof payload !== "object") {
        throw new Error("Project response must be an object")
    }
    const raw = payload as Record<string, unknown>
    const project = raw.project && typeof raw.project === "object" ? raw.project as Record<string, unknown> : raw
    const id = readString(project.id, "project.id")
    const title = readString(project.title ?? project.name, "project.title")
    const rawShows = project.shows ?? project.items
    if (!Array.isArray(rawShows)) throw new Error("project.shows must be an array")
    const shows = rawShows.map((show, index): ProjectShowRef => {
        if (!show || typeof show !== "object") throw new Error(`project.shows[${index}] must be an object`)
        const item = show as Record<string, unknown>
        const base = {
            id: readString(item.id ?? item.showId, `project.shows[${index}].id`),
            title: readString(item.title ?? item.name, `project.shows[${index}].title`)
        }
        return typeof item.artist === "string" && item.artist.trim() ? { ...base, artist: item.artist } : base
    })
    return { id, title, shows }
}

function readString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} must be a non-empty string`)
    return value
}
