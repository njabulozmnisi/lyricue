<!--
    AudioDevicePicker.svelte — operator UI for selecting the audio input device.

    Per EP-07 STORY-07.1, architecture.md §4.4, FR3.1.

    Responsibilities:
      - Render a dropdown of available audio input devices.
      - Persist the operator's choice via a callback (the host wires it to SettingsStore).
      - Provide a "Test" button that captures 2 seconds and shows a peak level meter.
      - Surface permission state (labels are empty until microphone access is granted).

    Architecture refs:
      - The component is presentation-only. It NEVER touches `navigator.mediaDevices`
        directly — the host injects `enumerateDevices` and `requestPermission` callbacks.
        This keeps the component testable in jsdom without polyfilling Web Audio.

    Out of scope:
      - The actual audio capture chain (lives in @lyricue/core/audio AudioInput).
      - The level-meter visualisation: rendered as a CSS bar driven by a `levelMeter`
        prop, which the host updates from real audio (or leaves at 0 in tests).
-->
<script lang="ts">
    import { createEventDispatcher } from "svelte"

    /** Subset of MediaDeviceInfo we render. Mirrors @lyricue/core/audio AudioInputDeviceInfo. */
    interface DeviceInfo {
        deviceId: string
        label: string
        kind: "audioinput"
        groupId: string
    }

    /**
     * Enumerate devices. The host wires this to `audioInput.enumerateDevices()`. Tests
     * supply a stub that returns a fixed list.
     */
    export let enumerateDevices: () => Promise<DeviceInfo[]>

    /**
     * Optional callback the picker invokes to prompt the user for microphone permission.
     * Browsers populate `MediaDeviceInfo.label` only after permission is granted, so this
     * is the operator-facing "tap to allow microphone access" flow. The host should call
     * `audioInput.start()` briefly (or use `getUserMedia` directly) and resolve when
     * labels are available.
     */
    export let requestPermission: (() => Promise<void>) | undefined = undefined

    /**
     * Test capture callback. Invoked when the operator clicks "Test". The host wires this
     * to a 2-second capture + RMS level callback. The host updates `levelMeter` reactively;
     * the picker just renders the meter.
     */
    export let startTest: ((deviceId: string) => Promise<void>) | undefined = undefined

    /** Current peak level in [0, 1]. Driven by the host while testing. */
    export let levelMeter = 0

    /** Currently selected deviceId. Two-way bound; persists via the change event. */
    export let value: string | null = null

    const dispatch = createEventDispatcher<{ change: { deviceId: string }; refresh: void }>()

    let devices: DeviceInfo[] = []
    let loading = false
    let loadError: string | null = null
    let permissionLabel: "granted" | "pending" | "unknown" = "unknown"
    let testing = false

    /**
     * Kick the initial enumeration synchronously during script-body execution rather
     * than via onMount. Same rationale as KaraokeOutput.svelte: in Svelte 3 + jsdom,
     * onMount fires asynchronously after the first render, which makes tests racy.
     * The enumeration is itself async, so the component still renders its "loading"
     * state on the first paint — moving the call site doesn't change UX.
     */
    void refresh()

    async function refresh(): Promise<void> {
        loading = true
        loadError = null
        try {
            devices = await enumerateDevices()
            // Heuristic: if every device label is empty, permission probably hasn't been granted.
            permissionLabel = devices.length > 0 && devices.every((d) => d.label === "") ? "pending" : "granted"
            dispatch("refresh")
        } catch (err) {
            loadError = (err as Error).message || "Failed to enumerate audio inputs"
        } finally {
            loading = false
        }
    }

    async function handleRequestPermission(): Promise<void> {
        if (!requestPermission) return
        try {
            await requestPermission()
            await refresh()
        } catch (err) {
            loadError = (err as Error).message || "Microphone permission denied"
        }
    }

    function handleChange(event: Event): void {
        const target = event.target as HTMLSelectElement
        value = target.value
        dispatch("change", { deviceId: target.value })
    }

    async function handleTest(): Promise<void> {
        if (!startTest || !value || testing) return
        testing = true
        try {
            await startTest(value)
        } catch (err) {
            loadError = (err as Error).message || "Test capture failed"
        } finally {
            testing = false
        }
    }
</script>

<section class="audio-device-picker" data-testid="audio-device-picker">
    <header>
        <label for="audio-device-select">Audio input device</label>
        <button
            type="button"
            class="refresh-btn"
            on:click={() => void refresh()}
            disabled={loading}
            aria-label="Refresh device list"
            data-testid="refresh"
        >
            {loading ? "Loading…" : "Refresh"}
        </button>
    </header>

    {#if permissionLabel === "pending" && requestPermission}
        <button
            type="button"
            class="permission-btn"
            on:click={() => void handleRequestPermission()}
            data-testid="request-permission"
        >
            Click to allow microphone access (required to see device names)
        </button>
    {/if}

    <select
        id="audio-device-select"
        on:change={handleChange}
        disabled={loading || devices.length === 0}
        data-testid="device-select"
    >
        {#if devices.length === 0 && !loading}
            <option disabled value="">No audio inputs detected</option>
        {/if}
        {#each devices as device (device.deviceId)}
            <option value={device.deviceId} selected={value === device.deviceId}>
                {device.label || `(unnamed device · ${device.deviceId.slice(0, 8)})`}
            </option>
        {/each}
    </select>

    {#if startTest}
        <div class="test-row">
            <button
                type="button"
                class="test-btn"
                on:click={() => void handleTest()}
                disabled={!value || testing}
                data-testid="test"
            >
                {testing ? "Capturing…" : "Test (2s)"}
            </button>
            <div
                class="level-meter"
                role="meter"
                aria-label="Audio input level"
                aria-valuemin="0"
                aria-valuemax="1"
                aria-valuenow={levelMeter}
                data-testid="level-meter"
            >
                <div class="level-fill" style="width: {Math.max(0, Math.min(1, levelMeter)) * 100}%"></div>
            </div>
        </div>
    {/if}

    {#if loadError}
        <div class="error" role="alert" data-testid="error">{loadError}</div>
    {/if}
</section>

<style>
    .audio-device-picker {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
        padding: 0.75rem;
        font-family: system-ui, sans-serif;
        color: #e0e0e0;
        background: #1a1a1a;
        border-radius: 6px;
        border: 1px solid #2a2a2a;
    }

    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
    }

    label {
        font-size: 0.85rem;
        font-weight: 600;
        color: #f0f0f0;
    }

    .refresh-btn,
    .permission-btn,
    .test-btn {
        padding: 0.3rem 0.7rem;
        background: #2a2a2a;
        color: #e0e0e0;
        border: 1px solid #3a3a3a;
        border-radius: 4px;
        font-size: 0.8rem;
        cursor: pointer;
    }
    .refresh-btn:disabled,
    .test-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .refresh-btn:hover:not(:disabled),
    .permission-btn:hover,
    .test-btn:hover:not(:disabled) {
        background: #333;
    }

    .permission-btn {
        background: #1a3a5a;
        color: #8bb8e0;
        border-color: #2a5a8a;
        text-align: left;
    }
    .permission-btn:hover {
        background: #234a6a;
    }

    select {
        padding: 0.4rem 0.6rem;
        background: #2a2a2a;
        color: #e0e0e0;
        border: 1px solid #3a3a3a;
        border-radius: 4px;
        font-size: 0.9rem;
        font-family: inherit;
    }
    select:disabled {
        opacity: 0.5;
    }

    .test-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .level-meter {
        flex: 1;
        height: 12px;
        background: #0a0a0a;
        border: 1px solid #2a2a2a;
        border-radius: 6px;
        overflow: hidden;
    }
    .level-fill {
        height: 100%;
        background: linear-gradient(to right, #4caf50 0%, #ffcc00 70%, #ff5252 100%);
        transition: width 80ms linear;
    }

    .error {
        background: #3a1010;
        color: #f0a0a0;
        padding: 0.4rem 0.6rem;
        border-radius: 4px;
        border: 1px solid #5a2020;
        font-size: 0.8rem;
    }
</style>
