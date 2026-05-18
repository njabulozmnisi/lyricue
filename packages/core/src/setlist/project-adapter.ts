import { writable, type Readable } from "../settings/observable.js"

export interface ProjectShowRef {
    id: string
    title: string
    artist?: string
    songId?: string
    bundleVersion?: string
    arrangementId?: string
}

export interface Project {
    id: string
    title: string
    shows: ProjectShowRef[]
    date?: string
    source?: ProjectSource
}

export interface ProjectSource {
    kind: "local" | "central" | "campus"
    planId?: string
    campusId?: string
    diverged?: boolean
}

export interface ProjectPlanSong {
    songId: string
    bundleVersion: string
    arrangementId?: string
}

export interface ProjectPlan {
    id: string
    name: string
    date?: string
    songs: ProjectPlanSong[]
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

export function projectFromPlan(
    plan: ProjectPlan,
    resolveShow: (song: ProjectPlanSong) => ProjectShowRef
): Project {
    return {
        id: plan.id,
        title: plan.name,
        ...(plan.date ? { date: plan.date } : {}),
        source: { kind: "central", planId: plan.id, diverged: false },
        shows: plan.songs.map((song) => ({
            ...resolveShow(song),
            songId: song.songId,
            bundleVersion: song.bundleVersion,
            ...(song.arrangementId ? { arrangementId: song.arrangementId } : {})
        }))
    }
}

export function markProjectDiverged(project: Project): Project {
    return project.source && project.source.kind !== "local"
        ? { ...project, source: { ...project.source, diverged: true } }
        : project
}

export function forkProject(project: Project, opts: { id: string; title?: string }): Project {
    return {
        ...project,
        id: opts.id,
        title: opts.title ?? project.title,
        source: { kind: "local" }
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
