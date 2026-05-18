<!--
    SetlistPanel.svelte — the primary live-operator UI.

    Per EP-10 STORY-10.2, architecture.md §4.10. This is the most important operator-
    facing component. It must satisfy NFR5.2 (≤3 operator actions to start sync).

    Layout matches the architecture sketch:

      ┌──────────────────────────────────────────────────────┐
      │ LyriCue ▸ Sunday Morning             [Mode: AUTO ●]  │
      ├──────────────────────────────────────────────────────┤
      │ Audio Input: [Sound Desk Line In ▼]   [Start Sync]   │
      ├──────────────────────────────────────────────────────┤
      │ Setlist:                                             │
      │   1. ✅ Way Maker         ████░░░░  72 BPM   [▶ Now] │
      │   2. ✅ Good Good Father  ░░░░░░░░  68 BPM           │
      │   3. ⚠ Great Are You Lord ░░░░░░░░  (partial)        │
      │   4. — Build My Life      ░░░░░░░░  (not learned)    │
      ├──────────────────────────────────────────────────────┤
      │ Next: Good Good Father                               │
      └──────────────────────────────────────────────────────┘

    The component is fully presentation-only:
      - `projectTitle`, `tier`, `lastTransition` drive the header
      - `audioDevices`, `selectedDeviceId`, `enumerateDevices` drive the picker
      - `setlist`, `activeSongId`, `nextSongTitle` drive the list
      - All state mutations flow through dispatched events the host wires to:
            SyncEngine.engageSync, SyncEngine.loadSong, SettingsStore.update.
-->
<script lang="ts">
    import { createEventDispatcher } from "svelte"
    import ModeIndicator from "./ModeIndicator.svelte"
    import AudioDevicePicker from "./AudioDevicePicker.svelte"
    import type {
        AudioDeviceInfo as DeviceInfo,
        SetlistSong,
        SyncStatus,
        SyncTier,
        TierTransition
    } from "./types.js"

    /** Project title shown in the header. */
    export let projectTitle = ""

    /** Current Sync Engine tier — drives the embedded ModeIndicator. */
    export let tier: SyncTier = "auto"

    /** Most recent tier transition for the ModeIndicator popup. */
    export let lastTransition: TierTransition | null = null

    /** Audio device picker plumbing. */
    export let enumerateDevices: () => Promise<DeviceInfo[]> = async () => []
    export let requestPermission: (() => Promise<void>) | undefined = undefined
    export let selectedDeviceId: string | null = null

    /** Setlist data. */
    export let setlist: SetlistSong[] = []

    /** ID of the currently-playing or queued song. null = nothing engaged. */
    export let activeSongId: string | null = null

    /** Title of the next-up song (auto-advance preview). null = no next song. */
    export let nextSongTitle: string | null = null

    /**
     * Whether sync is currently engaged. When true, Start Sync is replaced with a
     * pulsing "Sync engaged" indicator and the start button is hidden.
     */
    export let syncActive = false

    /**
     * True when the host can engage sync. Disables the Start Sync button when:
     *   - no audio device is selected
     *   - no song is selected (activeSongId is null)
     *   - the active song is not-learned
     */
    $: activeSong = activeSongId ? setlist.find((s) => s.id === activeSongId) ?? null : null
    $: canStart =
        selectedDeviceId !== null &&
        activeSong !== null &&
        activeSong.syncStatus !== "not-learned"
    $: canEditArrangement = activeSong?.syncStatus === "learned"

    const dispatch = createEventDispatcher<{
        "start-sync": void
        "learn-song": void
        "select-song": { songId: string }
        "change-device": { deviceId: string }
        "force-tier": { tier: SyncTier }
        "edit-arrangement": { songId: string }
        "translate-song": { songId: string }
        "publish-song": { songId: string }
        "toggle-rehearsal": void
    }>()

    function handleStartSync(): void {
        if (!canStart) return
        dispatch("start-sync")
    }

    function handleLearnSong(): void {
        dispatch("learn-song")
    }

    function handleEditArrangement(): void {
        if (!activeSongId || !canEditArrangement) return
        dispatch("edit-arrangement", { songId: activeSongId })
    }

    function handlePublishSong(): void {
        if (!activeSongId) return
        dispatch("publish-song", { songId: activeSongId })
    }

    function handleTranslateSong(): void {
        if (!activeSongId) return
        dispatch("translate-song", { songId: activeSongId })
    }

    function handleToggleRehearsal(): void {
        dispatch("toggle-rehearsal")
    }

    function handleSelectSong(songId: string, _song: SetlistSong): void {
        dispatch("select-song", { songId })
    }

    function handleDeviceChange(e: CustomEvent<{ deviceId: string }>): void {
        selectedDeviceId = e.detail.deviceId
        dispatch("change-device", { deviceId: e.detail.deviceId })
    }

    function handleForceTier(e: CustomEvent<{ tier: SyncTier }>): void {
        dispatch("force-tier", e.detail)
    }

    function statusIcon(status: SyncStatus): string {
        switch (status) {
            case "learned":
                return "✓"
            case "partial":
                return "⚠"
            case "not-learned":
                return "—"
        }
    }
</script>

<section class="setlist-panel" data-testid="setlist-panel">
    <header class="panel-header">
        <h1 class="panel-title">
            <span class="brand">LyriCue</span>
            {#if projectTitle}
                <span class="separator" aria-hidden="true">▸</span>
                <span class="project" data-testid="project-title">{projectTitle}</span>
            {/if}
        </h1>
        <div class="header-right">
            <button
                type="button"
                class="learn-song-btn"
                on:click={handleLearnSong}
                data-testid="learn-song"
                aria-label="Learn song"
            >
                Learn Song
            </button>
            <button
                type="button"
                class="secondary-action-btn"
                on:click={handleEditArrangement}
                disabled={!canEditArrangement}
                data-testid="edit-arrangement"
                aria-label="Edit active arrangement"
            >
                Arrange
            </button>
            <button
                type="button"
                class="secondary-action-btn"
                on:click={handleTranslateSong}
                disabled={!canEditArrangement}
                data-testid="translate-song"
                aria-label="Translate active song"
            >
                Translate
            </button>
            <button
                type="button"
                class="secondary-action-btn"
                on:click={handlePublishSong}
                disabled={!activeSongId}
                data-testid="publish-song"
                aria-label="Publish active song"
            >
                Publish
            </button>
            <button
                type="button"
                class="secondary-action-btn"
                on:click={handleToggleRehearsal}
                data-testid="toggle-rehearsal"
                aria-label="Toggle rehearsal mode"
            >
                Rehearsal
            </button>
            <ModeIndicator {tier} {lastTransition} on:force-tier={handleForceTier} />
        </div>
    </header>

    <div class="control-row">
        <div class="device-area">
            <AudioDevicePicker
                {enumerateDevices}
                {requestPermission}
                value={selectedDeviceId}
                on:change={handleDeviceChange}
            />
        </div>

        <div class="start-area">
            {#if syncActive}
                <div class="sync-active" data-testid="sync-active-indicator">
                    <span class="dot" aria-hidden="true"></span>
                    Sync engaged
                </div>
            {:else}
                <button
                    type="button"
                    class="start-sync-btn"
                    on:click={handleStartSync}
                    disabled={!canStart}
                    data-testid="start-sync"
                    aria-label="Start sync"
                >
                    Start Sync
                </button>
            {/if}
        </div>
    </div>

    <div class="setlist-area">
        <h2 class="section-title">Setlist</h2>
        {#if setlist.length === 0}
            <p class="empty" data-testid="setlist-empty">No songs in the current setlist.</p>
        {:else}
            <ol class="setlist-list" data-testid="setlist-list">
                {#each setlist as song, idx (song.id)}
                    {@const isActive = song.id === activeSongId}
                    {@const isLearned = song.syncStatus === "learned"}
                    {@const isPartial = song.syncStatus === "partial"}
                    {@const isUnlearned = song.syncStatus === "not-learned"}
                    <li
                        class="setlist-item"
                        class:active={isActive}
                        class:partial={isPartial}
                        class:not-learned={isUnlearned}
                        data-testid="setlist-item"
                        data-song-id={song.id}
                    >
                        <button
                            type="button"
                            class="song-row"
                            on:click={() => handleSelectSong(song.id, song)}
                            data-testid="setlist-item-button"
                            aria-current={isActive ? "true" : undefined}
                            aria-label="{song.title}{isUnlearned ? ' (not yet learned)' : ''}"
                        >
                            <span class="index">{idx + 1}.</span>
                            <span class="status-icon" data-status={song.syncStatus} aria-hidden="true">
                                {statusIcon(song.syncStatus)}
                            </span>
                            <span class="title">{song.title}</span>
                            {#if song.artist}
                                <span class="artist">— {song.artist}</span>
                            {/if}
                            <span class="meta" data-testid="setlist-item-meta">
                                {#if isLearned && song.bpm !== null}
                                    {song.bpm} BPM
                                {:else if isPartial}
                                    (partial)
                                {:else}
                                    (not learned)
                                {/if}
                            </span>
                            {#if isActive}
                                <span class="now-marker" data-testid="now-marker">▶ Now</span>
                            {/if}
                        </button>
                    </li>
                {/each}
            </ol>
        {/if}
    </div>

    {#if nextSongTitle}
        <footer class="next-row" data-testid="next-row">
            <span class="next-label">Next:</span>
            <span class="next-title">{nextSongTitle}</span>
        </footer>
    {/if}
</section>

<style>
    .setlist-panel {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
        padding: 0.85rem 1rem;
        font-family: system-ui, sans-serif;
        color: #e0e0e0;
        background: #111;
        border-radius: 8px;
        min-width: 480px;
        width: 100%;
    }

    .panel-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: flex-start;
        gap: 1rem;
        padding-bottom: 0.6rem;
        border-bottom: 1px solid #2a2a2a;
    }
    .panel-title {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 0.45rem;
        flex: 1 1 13rem;
        min-width: 0;
    }
    .brand {
        color: #f0f0f0;
    }
    .separator {
        color: #444;
    }
    .project {
        color: #aaa;
        font-weight: 500;
        overflow-wrap: anywhere;
    }
    .header-right {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        flex: 1 1 19rem;
        min-width: 0;
        max-width: 100%;
        gap: 0.45rem;
        flex-wrap: wrap;
    }
    .learn-song-btn,
    .secondary-action-btn {
        background: #2b2b2b;
        color: #f0f0f0;
        border: 1px solid #444;
        padding: 0.45rem 0.7rem;
        font-size: 0.82rem;
        font-weight: 700;
        border-radius: 6px;
        cursor: pointer;
        white-space: nowrap;
    }
    .learn-song-btn:hover,
    .secondary-action-btn:hover:not(:disabled) {
        background: #353535;
    }
    .secondary-action-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .control-row {
        display: flex;
        gap: 0.85rem;
        align-items: stretch;
    }
    .device-area {
        flex: 1;
    }
    .start-area {
        display: flex;
        align-items: center;
    }
    .start-sync-btn {
        background: #2a5a2a;
        color: #f0f0f0;
        border: 1px solid #4caf50;
        padding: 0.7rem 1.4rem;
        font-size: 1rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        border-radius: 6px;
        cursor: pointer;
        white-space: nowrap;
    }
    .start-sync-btn:hover:not(:disabled) {
        background: #336a33;
    }
    .start-sync-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
        background: #1a3a1a;
    }
    .sync-active {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.6rem 1.2rem;
        background: #1a3a1a;
        color: #4caf50;
        border: 1px solid #4caf50;
        border-radius: 6px;
        font-size: 0.9rem;
        font-weight: 700;
        letter-spacing: 0.05em;
    }
    .sync-active .dot {
        width: 0.55rem;
        height: 0.55rem;
        border-radius: 50%;
        background: currentColor;
        box-shadow: 0 0 6px currentColor;
        animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
        0%, 100% {
            opacity: 1;
        }
        50% {
            opacity: 0.4;
        }
    }

    .section-title {
        margin: 0;
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #888;
    }

    .empty {
        margin: 0.4rem 0;
        color: #888;
        font-style: italic;
        font-size: 0.85rem;
    }

    .setlist-list {
        list-style: none;
        padding: 0;
        margin: 0.4rem 0 0;
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
    }

    .setlist-item {
        display: contents;
    }
    .song-row {
        display: grid;
        grid-template-columns: 1.5rem 1.5rem 1fr auto auto;
        gap: 0.6rem;
        align-items: center;
        width: 100%;
        text-align: left;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 4px;
        padding: 0.5rem 0.7rem;
        color: inherit;
        font: inherit;
        cursor: pointer;
        transition: background 80ms linear, border-color 80ms linear;
    }
    .song-row:hover:not(:disabled) {
        background: #1a1a1a;
        border-color: #2a2a2a;
    }
    .song-row:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .setlist-item.active .song-row {
        background: #1a2a3a;
        border-color: #2a5a8a;
    }

    .index {
        color: #555;
        font-variant-numeric: tabular-nums;
    }
    .status-icon {
        font-size: 0.95rem;
        text-align: center;
        font-weight: 600;
    }
    .status-icon[data-status="learned"] {
        color: #4caf50;
    }
    .status-icon[data-status="partial"] {
        color: #ffb300;
    }
    .status-icon[data-status="not-learned"] {
        color: #666;
    }
    .title {
        color: #e0e0e0;
    }
    .setlist-item.not-learned .title {
        color: #888;
    }
    .artist {
        color: #888;
        font-style: italic;
        font-size: 0.85rem;
    }
    .meta {
        color: #888;
        font-size: 0.8rem;
        font-family: ui-monospace, "SF Mono", Menlo, monospace;
    }
    .now-marker {
        color: #ffb300;
        font-weight: 700;
        font-size: 0.8rem;
        font-family: ui-monospace, "SF Mono", Menlo, monospace;
        letter-spacing: 0.05em;
    }

    .next-row {
        display: flex;
        gap: 0.45rem;
        padding-top: 0.6rem;
        border-top: 1px solid #2a2a2a;
        font-size: 0.85rem;
    }
    .next-label {
        color: #888;
    }
    .next-title {
        color: #e0e0e0;
        font-weight: 500;
    }
</style>
