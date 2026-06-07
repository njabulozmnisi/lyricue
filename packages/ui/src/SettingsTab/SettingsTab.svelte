<!--
    SettingsTab.svelte — the LyriCue settings panel mounted inside the host app.

    Per epics.md STORY-01.6:
      - One tab with subsections: Display, Sync, Shortcuts, Library, Identity, Sidecar.
      - Changes persist immediately via SettingsStore.save() (debounced).
      - Each subsection has its own "Reset to defaults" button.
      - Many controls are intentional stubs until their owning module lands (audio device
        picker → EP-07, library URL → EP-13, sidecar paths → EP-04, etc.). The structure
        is in place so deeper stories slot controls in without restructuring this file.

    Host-app neutral:
      - Receives all stores as props. The same component runs in fork mode (where the host
        is FreeShow with our tab inserted into its settings) and sister mode (where we own
        the settings panel entirely).
      - Renders nothing that depends on FreeShow types.
-->
<script lang="ts">
    import {
        DEFAULT_LYRICUE_SETTINGS,
        type LyriCueSettings,
        type InstallIdentity,
        type LibraryConfig
    } from "@lyricue/core/types"
    import { debounce } from "@lyricue/core/settings/debounce"

    import DisplaySection from "./DisplaySection.svelte"
    import SyncSection from "./SyncSection.svelte"
    import ShortcutsSection from "./ShortcutsSection.svelte"
    import LibrarySection from "./LibrarySection.svelte"
    import IdentitySection from "./IdentitySection.svelte"
    import SidecarSection from "./SidecarSection.svelte"
    import StorageSection from "./StorageSection.svelte"

    interface StoreLike<T> {
        get(): T
        subscribe(run: (value: T) => void): () => void
        save(value: T): Promise<void>
    }

    interface RehearsalRecordingInfo {
        fileName: string
        filePath: string
        sizeBytes: number
        modifiedAtMs: number
    }

    export let settingsStore: StoreLike<LyriCueSettings>
    export let identityStore: StoreLike<InstallIdentity>
    export let libraryConfigStore: StoreLike<LibraryConfig>
    export let onCatalogRefresh: (() => void) | undefined = undefined
    export let rehearsalRecordings: RehearsalRecordingInfo[] = []
    export let onRehearsalStorageRefresh: (() => Promise<void> | void) | undefined = undefined
    export let onRehearsalRecordingDelete: ((fileName: string) => Promise<void> | void) | undefined = undefined
    export let onRehearsalRecordingDeleteOlderThan: ((olderThanDays: number) => Promise<void> | void) | undefined = undefined

    let settings: LyriCueSettings = settingsStore.get()
    let identity: InstallIdentity = identityStore.get()
    let libraryConfig: LibraryConfig = libraryConfigStore.get()

    // Subscribe to external changes — e.g., wizard finishing, settings reset from another window.
    const unsubSettings = settingsStore.subscribe((v) => (settings = v))
    const unsubIdentity = identityStore.subscribe((v) => (identity = v))
    const unsubLibrary = libraryConfigStore.subscribe((v) => (libraryConfig = v))

    /**
     * Persist settings changes with 250ms debounce. Color-picker drags fire dozens of
     * events per second; this coalesces them into one atomic file write per gesture.
     */
    const persistSettings = debounce((next: LyriCueSettings) => {
        void settingsStore.save(next).catch((err) => {
            console.error("[lyricue:settings] save failed:", err)
        })
    }, 250)

    /** Identity changes are less frequent; small debounce keeps the disk write rate sane. */
    const persistIdentity = debounce((next: InstallIdentity) => {
        void identityStore.save(next).catch((err) => {
            console.error("[lyricue:identity] save failed:", err)
        })
    }, 250)

    const persistLibrary = debounce((next: LibraryConfig) => {
        void libraryConfigStore.save(next).catch((err) => {
            console.error("[lyricue:library] save failed:", err)
        })
    }, 250)

    function onSettingsChange(next: LyriCueSettings): void {
        settings = next
        persistSettings(next)
    }
    function onIdentityChange(next: InstallIdentity): void {
        identity = next
        persistIdentity(next)
    }
    function onLibraryChange(next: LibraryConfig): void {
        libraryConfig = next
        persistLibrary(next)
    }

    function resetSection(section: "display" | "sync" | "shortcuts" | "sidecar" | "community"): void {
        const next: LyriCueSettings = { ...settings, [section]: DEFAULT_LYRICUE_SETTINGS[section] }
        onSettingsChange(next)
    }

    // Flush any pending writes when the tab unmounts so nothing is lost.
    import { onDestroy } from "svelte"
    onDestroy(() => {
        persistSettings.flush()
        persistIdentity.flush()
        persistLibrary.flush()
        unsubSettings()
        unsubIdentity()
        unsubLibrary()
    })

    type Section = "display" | "sync" | "shortcuts" | "library" | "identity" | "sidecar" | "storage"
    let active: Section = "display"

    const sectionTabs: { id: Section; label: string }[] = [
        { id: "display", label: "Display" },
        { id: "sync", label: "Sync" },
        { id: "shortcuts", label: "Shortcuts" },
        { id: "library", label: "Library" },
        { id: "identity", label: "Identity" },
        { id: "sidecar", label: "Sidecar" },
        { id: "storage", label: "Storage" }
    ]

    const noop = () => undefined
</script>

<div class="lyricue-settings">
    <nav class="sections">
        {#each sectionTabs as tab}
            <button class:active={active === tab.id} on:click={() => (active = tab.id)}>{tab.label}</button>
        {/each}
    </nav>

    <div class="content">
        {#if active === "display"}
            <DisplaySection
                {settings}
                onChange={onSettingsChange}
                onReset={() => resetSection("display")}
            />
        {:else if active === "sync"}
            <SyncSection
                {settings}
                onChange={onSettingsChange}
                onReset={() => resetSection("sync")}
            />
        {:else if active === "shortcuts"}
            <ShortcutsSection
                {settings}
                onChange={onSettingsChange}
                onReset={() => resetSection("shortcuts")}
            />
        {:else if active === "library"}
            <LibrarySection {libraryConfig} onChange={onLibraryChange} />
        {:else if active === "identity"}
            <IdentitySection {identity} onChange={onIdentityChange} onCampusChange={onCatalogRefresh} />
        {:else if active === "sidecar"}
            <SidecarSection
                {settings}
                onChange={onSettingsChange}
                onReset={() => resetSection("sidecar")}
            />
        {:else if active === "storage"}
            <StorageSection
                recordings={rehearsalRecordings}
                onRefresh={onRehearsalStorageRefresh ?? noop}
                onDelete={onRehearsalRecordingDelete ?? noop}
                onDeleteOlderThan={onRehearsalRecordingDeleteOlderThan ?? noop}
            />
        {/if}
    </div>
</div>

<style>
    .lyricue-settings {
        display: grid;
        grid-template-columns: 180px 1fr;
        gap: 1.5rem;
        font-family: system-ui, sans-serif;
        color: #111;
    }
    nav.sections {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }
    nav.sections button {
        text-align: left;
        padding: 0.5rem 0.75rem;
        background: none;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font: inherit;
        color: #444;
    }
    nav.sections button:hover {
        background: #f4f4f4;
    }
    nav.sections button.active {
        background: #1f6feb;
        color: white;
    }
    .content {
        min-height: 320px;
    }
</style>
