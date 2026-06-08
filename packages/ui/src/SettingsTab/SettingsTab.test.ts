import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
    DEFAULT_INSTALL_IDENTITY,
    DEFAULT_LIBRARY_CONFIG,
    DEFAULT_LYRICUE_SETTINGS,
    type InstallIdentity,
    type LibraryConfig,
    type LyriCueSettings
} from "@lyricue/core/types"
import SettingsTab from "./SettingsTab.svelte"

type StoreLike<T> = {
    get: () => T
    subscribe: (run: (value: T) => void) => () => void
    save: (value: T) => Promise<void>
}

function createStore<T>(initial: T): StoreLike<T> & { save: ReturnType<typeof vi.fn> } {
    let value = initial
    const subscribers = new Set<(value: T) => void>()
    const save = vi.fn(async (next: T) => {
        value = next
        for (const subscriber of subscribers) subscriber(value)
    })
    return {
        get: () => value,
        subscribe: (run: (value: T) => void) => {
            subscribers.add(run)
            run(value)
            return () => subscribers.delete(run)
        },
        save
    }
}

async function flush(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
}

describe("SettingsTab", () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it("persists sidecar model manifest controls through the settings store", async () => {
        const target = document.createElement("div")
        const settingsStore = createStore<LyriCueSettings>(DEFAULT_LYRICUE_SETTINGS)
        const identityStore = createStore<InstallIdentity>(DEFAULT_INSTALL_IDENTITY)
        const libraryConfigStore = createStore<LibraryConfig>(DEFAULT_LIBRARY_CONFIG)

        const cmp = new SettingsTab({
            target,
            props: {
                settingsStore,
                identityStore,
                libraryConfigStore
            }
        })

        ;[...target.querySelectorAll("button")].find((button) => button.textContent === "Sidecar")?.click()
        await flush()

        const manifestPath = target.querySelector('input[placeholder="(uses installer/env configuration)"]') as HTMLInputElement
        const mirrorUrl = target.querySelector('input[placeholder="https://models.example.org/lyricue/"]') as HTMLInputElement
        const requireManifest = target.querySelector('input[type="checkbox"]') as HTMLInputElement
        expect(manifestPath).not.toBeNull()
        expect(mirrorUrl).not.toBeNull()
        expect(requireManifest).not.toBeNull()

        manifestPath.value = "/opt/lyricue/models/manifest.json"
        manifestPath.dispatchEvent(new Event("input", { bubbles: true }))
        await flush()
        mirrorUrl.value = "https://models.example.org/lyricue/"
        mirrorUrl.dispatchEvent(new Event("input", { bubbles: true }))
        await flush()
        requireManifest.checked = true
        requireManifest.dispatchEvent(new Event("change", { bubbles: true }))

        await vi.advanceTimersByTimeAsync(300)

        expect(settingsStore.save).toHaveBeenCalled()
        const saved = settingsStore.save.mock.calls.at(-1)?.[0] as LyriCueSettings
        expect(saved.sidecar.modelManifestPath).toBe("/opt/lyricue/models/manifest.json")
        expect(saved.sidecar.modelMirrorUrl).toBe("https://models.example.org/lyricue/")
        expect(saved.sidecar.requireModelManifest).toBe(true)

        cmp.$destroy()
    })

    it("hydrates the persisted sync audio device id", async () => {
        const target = document.createElement("div")
        const settingsStore = createStore<LyriCueSettings>({
            ...DEFAULT_LYRICUE_SETTINGS,
            sync: {
                ...DEFAULT_LYRICUE_SETTINGS.sync,
                audioInputDeviceId: "mic-1"
            }
        })
        const identityStore = createStore<InstallIdentity>(DEFAULT_INSTALL_IDENTITY)
        const libraryConfigStore = createStore<LibraryConfig>(DEFAULT_LIBRARY_CONFIG)

        const cmp = new SettingsTab({
            target,
            props: {
                settingsStore,
                identityStore,
                libraryConfigStore
            }
        })

        ;[...target.querySelectorAll("button")].find((button) => button.textContent === "Sync")?.click()
        await flush()

        const audioDevice = target.querySelector("input[disabled]") as HTMLInputElement
        expect(audioDevice.value).toBe("mic-1")
        expect(target.textContent).toContain("Use the operator audio picker")
        expect(target.textContent).not.toContain("EP-07")

        cmp.$destroy()
    })
})
