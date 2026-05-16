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
