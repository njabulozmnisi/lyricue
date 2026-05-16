import { writable, type Readable } from "../settings/observable.js"
import type { OutputAdapter } from "../output/output-adapter.js"
import type { Arrangement, TimingMap } from "../types/timing-map.js"
import type { SyncTier, SyncRunState } from "../sync/sync-engine-state.js"
import type { Project, ProjectShowRef } from "./project-adapter.js"

export type SetlistSyncStatus = "learned" | "partial" | "not-learned"

export interface SetlistSong {
    id: string
    title: string
    syncStatus: SetlistSyncStatus
    bpm: number | null
    artist?: string
}

export interface TimingMapResolver {
    exists(showId: string): Promise<boolean>
    load(showId: string): Promise<TimingMap | null>
    loadArrangement?(showId: string): Promise<Arrangement | null>
}

export interface SetlistSyncEngine {
    readonly state: Readable<{ runState: SyncRunState; vadState: "active" | "silent" }>
    loadSong(opts: { map: TimingMap; arrangement: Arrangement | null; showId: string }): void
    clearSong(): void
    engageSync(): void
    forceTier(tier: SyncTier): void
    onSongComplete(handler: () => void): () => void
}

export interface SetlistControllerState {
    project: Project | null
    songs: SetlistSong[]
    activeShowId: string | null
    nextSongTitle: string | null
}

export interface SetlistControllerOptions {
    syncEngine: SetlistSyncEngine
    timingMaps: TimingMapResolver
    outputAdapter?: Pick<OutputAdapter, "loadTimingMap">
    onPassThrough?: (show: ProjectShowRef) => void
}

export interface SetlistController {
    readonly state: Readable<SetlistControllerState>
    snapshot(): SetlistControllerState
    loadProject(project: Project | null): Promise<void>
    jumpToSong(showId: string): Promise<void>
    advanceToNext(): Promise<void>
    destroy(): void
}

export async function deriveSetlistSongs(
    project: Project,
    exists: (showId: string) => Promise<boolean>
): Promise<SetlistSong[]> {
    const songs: SetlistSong[] = []
    for (const show of project.shows) {
        const learned = await exists(show.id)
        const base = {
            id: show.id,
            title: show.title,
            syncStatus: learned ? ("learned" as const) : ("not-learned" as const),
            bpm: null
        }
        songs.push(show.artist ? { ...base, artist: show.artist } : base)
    }
    return songs
}

export function createSetlistController(opts: SetlistControllerOptions): SetlistController {
    const store = writable<SetlistControllerState>({
        project: null,
        songs: [],
        activeShowId: null,
        nextSongTitle: null
    })
    let current = snapshotFromStore()
    let destroyed = false
    let latestVadState: "active" | "silent" = "silent"

    function snapshotFromStore(): SetlistControllerState {
        let state: SetlistControllerState = {
            project: null,
            songs: [],
            activeShowId: null,
            nextSongTitle: null
        }
        store.subscribe((v) => (state = v))()
        return state
    }

    function setState(next: SetlistControllerState): void {
        current = next
        store.set(next)
    }

    function nextTitleFor(project: Project | null, activeShowId: string | null): string | null {
        if (!project || !activeShowId) return null
        const idx = project.shows.findIndex((show) => show.id === activeShowId)
        if (idx < 0) return null
        return project.shows[idx + 1]?.title ?? null
    }

    async function loadIndex(index: number): Promise<void> {
        const project = current.project
        if (!project || index < 0 || index >= project.shows.length) return
        const show = project.shows[index]!
        const map = await opts.timingMaps.load(show.id)
        const arrangement = (await opts.timingMaps.loadArrangement?.(show.id)) ?? null

        setState({
            ...current,
            activeShowId: show.id,
            nextSongTitle: nextTitleFor(project, show.id)
        })

        if (!map) {
            opts.syncEngine.forceTier("manual")
            opts.syncEngine.clearSong()
            opts.onPassThrough?.(show)
            return
        }

        opts.syncEngine.loadSong({ map, arrangement, showId: show.id })
        opts.outputAdapter?.loadTimingMap(map, arrangement)
        if (latestVadState === "active") opts.syncEngine.engageSync()
    }

    const songCompleteUnsub = opts.syncEngine.onSongComplete(() => {
        void advanceToNext()
    })
    const stateUnsub = opts.syncEngine.state.subscribe((state) => {
        latestVadState = state.vadState
        if (state.runState === "waitingForStart" && state.vadState === "active") {
            opts.syncEngine.engageSync()
        }
    })

    async function loadProject(project: Project | null): Promise<void> {
        const songs = project ? await deriveSetlistSongs(project, opts.timingMaps.exists) : []
        setState({
            project,
            songs,
            activeShowId: null,
            nextSongTitle: project?.shows[0]?.title ?? null
        })
    }

    async function jumpToSong(showId: string): Promise<void> {
        const project = current.project
        if (!project) return
        const index = project.shows.findIndex((show) => show.id === showId)
        await loadIndex(index)
    }

    async function advanceToNext(): Promise<void> {
        const project = current.project
        if (!project || !current.activeShowId) return
        const index = project.shows.findIndex((show) => show.id === current.activeShowId)
        await loadIndex(index + 1)
    }

    return {
        state: { subscribe: (run) => store.subscribe(run) },
        snapshot() {
            return current
        },
        loadProject,
        jumpToSong,
        advanceToNext,
        destroy() {
            if (destroyed) return
            destroyed = true
            songCompleteUnsub()
            stateUnsub()
        }
    }
}
