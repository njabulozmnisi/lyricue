import { exportBundle } from "@lyricue/core/library"
import type { Arrangement, TimingMap } from "@lyricue/core/types"
import type { Project, ProjectShowRef } from "@lyricue/core/setlist"

export interface OperatorSongPublishRequest {
    title: string
    songId?: string
    exportedAt?: string
}

export interface OperatorSongBundlePlan {
    bytes: Uint8Array
    songId: string
    bundleVersion: string
    project: Project
}

export function prepareOperatorSongBundle(input: {
    project: Project
    activeShowId: string | null
    timingMap: TimingMap | null
    arrangements: Arrangement[]
    request: OperatorSongPublishRequest
    now?: Date
}): OperatorSongBundlePlan {
    if (!input.activeShowId) {
        throw new Error("Select a learned song before publishing.")
    }
    if (!input.timingMap) {
        throw new Error("Active song has no timing map to publish.")
    }
    if (input.timingMap.showId !== input.activeShowId) {
        throw new Error("Active timing map does not match the selected song.")
    }

    const show = input.project.shows.find((candidate) => candidate.id === input.activeShowId)
    if (!show) {
        throw new Error("Selected song is not in the active project.")
    }

    const title = input.request.title.trim()
    if (!title) throw new Error("Publish title is required.")
    const songId = readPublishSongId(input.request.songId ?? show.songId ?? title)
    const bundleVersion = show.bundleVersion ?? bundleVersionFromDate(input.now ?? new Date())
    const showForBundle: ProjectShowRef = {
        ...show,
        title,
        songId,
        bundleVersion
    }
    const bytes = exportBundle({
        songId,
        title,
        bundleVersion,
        show: showForBundle,
        timingMap: input.timingMap,
        arrangements: input.arrangements,
        ...(input.request.exportedAt ? { exportedAt: input.request.exportedAt } : {})
    })
    const project: Project = {
        ...input.project,
        shows: input.project.shows.map((candidate) => candidate.id === show.id ? showForBundle : candidate)
    }
    return { bytes, songId, bundleVersion, project }
}

function readPublishSongId(value: string): string {
    const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    if (!slug) throw new Error("Publish song id could not be derived from the selected song.")
    return slug.slice(0, 96)
}

function bundleVersionFromDate(date: Date): string {
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}
