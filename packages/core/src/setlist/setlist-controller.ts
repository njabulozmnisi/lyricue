import { writable, type Readable } from "../settings/observable.js"
import type { OutputAdapter } from "../output/output-adapter.js"
import type { Arrangement, TimingMap } from "../types/timing-map.js"
import type { SyncTier, SyncRunState } from "../sync/sync-engine-state.js"
import type { Project, ProjectShowRef } from "./project-adapter.js"

export type SetlistSyncStatus = "learned" | "partial" | "not-learned"
export type TimingMapVariant = "studio" | "rehearsal"
const TIMING_MAP_VARIANTS: readonly TimingMapVariant[] = ["studio", "rehearsal"]

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
    existsVariant?(showId: string, variant: TimingMapVariant): Promise<boolean>
    loadVariant?(showId: string, variant: TimingMapVariant): Promise<TimingMap | null>
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
    passThroughShowId: string | null
    activeTimingMapVariant: TimingMapVariant
    availableTimingMapVariants: TimingMapVariant[]
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
    selectTimingMapVariant(variant: TimingMapVariant): Promise<void>
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
        nextSongTitle: null,
        passThroughShowId: null,
        activeTimingMapVariant: "studio",
        availableTimingMapVariants: ["studio"]
    })
    let current = snapshotFromStore()
    let destroyed = false
    let latestVadState: "active" | "silent" = "silent"

    function snapshotFromStore(): SetlistControllerState {
        let state: SetlistControllerState = {
            project: null,
            songs: [],
            activeShowId: null,
            nextSongTitle: null,
            passThroughShowId: null,
            activeTimingMapVariant: "studio",
            availableTimingMapVariants: ["studio"]
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

    async function variantsFor(showId: string): Promise<TimingMapVariant[]> {
        const variants: TimingMapVariant[] = []
        for (const variant of TIMING_MAP_VARIANTS) {
            const exists =
                variant === "studio"
                    ? await opts.timingMaps.exists(showId)
                    : (await opts.timingMaps.existsVariant?.(showId, variant)) ?? false
            if (exists) variants.push(variant)
        }
        return variants.length > 0 ? variants : ["studio"]
    }

    async function loadMap(showId: string, variant: TimingMapVariant): Promise<{ map: TimingMap | null; variant: TimingMapVariant }> {
        if (variant !== "studio" && opts.timingMaps.loadVariant) {
            const variantMap = await opts.timingMaps.loadVariant(showId, variant)
            if (variantMap) return { map: variantMap, variant }
        }
        return { map: await opts.timingMaps.load(showId), variant: "studio" }
    }

    async function loadIndex(index: number): Promise<void> {
        const project = current.project
        if (!project || index < 0 || index >= project.shows.length) return
        const show = project.shows[index]!
        const availableTimingMapVariants = await variantsFor(show.id)
        const requestedVariant = availableTimingMapVariants.includes(current.activeTimingMapVariant)
            ? current.activeTimingMapVariant
            : availableTimingMapVariants[0] ?? "studio"
        const loaded = await loadMap(show.id, requestedVariant)
        const map = loaded.map
        const arrangement = (await opts.timingMaps.loadArrangement?.(show.id)) ?? null

        setState({
            ...current,
            activeShowId: show.id,
            nextSongTitle: nextTitleFor(project, show.id),
            passThroughShowId: map ? null : show.id,
            activeTimingMapVariant: loaded.variant,
            availableTimingMapVariants
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
            nextSongTitle: project?.shows[0]?.title ?? null,
            passThroughShowId: null,
            activeTimingMapVariant: "studio",
            availableTimingMapVariants: ["studio"]
        })
    }

    async function jumpToSong(showId: string): Promise<void> {
        const project = current.project
        if (!project) return
        const index = project.shows.findIndex((show) => show.id === showId)
        await loadIndex(index)
    }

    async function selectTimingMapVariant(variant: TimingMapVariant): Promise<void> {
        const project = current.project
        if (!project || !current.activeShowId) {
            setState({ ...current, activeTimingMapVariant: variant })
            return
        }
        const available = await variantsFor(current.activeShowId)
        if (!available.includes(variant)) return
        setState({ ...current, activeTimingMapVariant: variant, availableTimingMapVariants: available })
        await jumpToSong(current.activeShowId)
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
        selectTimingMapVariant,
        advanceToNext,
        destroy() {
            if (destroyed) return
            destroyed = true
            songCompleteUnsub()
            stateUnsub()
        }
    }
}
