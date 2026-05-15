<!--
    ModeIndicator.svelte — always-visible badge showing the current Sync Engine tier.

    Per EP-10 STORY-10.1, architecture.md §4.10, FR5.7.

    The operator must never be in doubt about which tier is active during live worship.
    A misread (e.g., thinking the system is in Auto when it has degraded to Timer) leads
    to the wrong recovery action. The badge is:
      - Always visible in the operator window's top-right region
      - Color-coded: AUTO green, TIMER amber, MANUAL red
      - Click-expandable to a popup showing the most recent tier-change reason (AC2)

    The component is presentation-only. The host wires:
      - `tier` — the current SyncEngineState.tier
      - `lastTransition` — optional struct describing the most recent transition
        (when it happened + the reason in plain language)

    The component dispatches a 'force-tier' event when the operator right-clicks → "Force
    Manual" / "Force Auto" / "Force Timer" — STORY-10.7's "Force tier" affordance. The
    host wires that to SyncEngine.forceTier(...).
-->
<script lang="ts">
    import { createEventDispatcher } from "svelte"
    import type { SyncTier, TierTransition } from "./types.js"

    /** SyncTier from @lyricue/core/sync. */
    export let tier: SyncTier = "auto"

    /**
     * Most recent tier transition. Drives the popup's "reason" text. Set by the host
     * from a SyncEngine subscriber that watches `state.tier` changes. Null means no
     * transition has happened yet (fresh boot).
     */
    export let lastTransition: TierTransition | null = null

    /** Const list used by the force-tier menu template. */
    const ALL_TIERS: SyncTier[] = ["auto", "timer", "manual"]

    /**
     * Optional override of the "right now" wall-clock for testing the "X seconds ago"
     * display. Tests inject; production omits and the component uses Date.now().
     */
    export let nowMs: number | undefined = undefined

    const dispatch = createEventDispatcher<{
        "force-tier": { tier: SyncTier }
    }>()

    let popupOpen = false

    function togglePopup(): void {
        popupOpen = !popupOpen
    }

    /**
     * Force-tier menu shown on right-click (architecture STORY-10.7 AC3). Emits the
     * `force-tier` event; the host wires it to SE.forceTier(...). Note: the menu omits
     * the currently-active tier — there's nothing to force when we're already there.
     */
    function handleContextMenu(event: MouseEvent): void {
        event.preventDefault()
        forceMenuOpen = true
    }
    let forceMenuOpen = false

    function force(to: SyncTier): void {
        forceMenuOpen = false
        if (to === tier) return
        dispatch("force-tier", { tier: to })
    }

    $: tierLabel = tier === "auto" ? "AUTO" : tier === "timer" ? "TIMER" : "MANUAL"
    $: tierClass = `mode-indicator tier-${tier}`

    $: now = nowMs ?? Date.now()
    $: secondsAgo =
        lastTransition === null ? null : Math.max(0, Math.round((now - lastTransition.atWallMs) / 1000))

    function clickOutside(node: HTMLElement, _opts: unknown): { destroy(): void } {
        function handler(event: MouseEvent): void {
            if (!node.contains(event.target as Node)) {
                popupOpen = false
                forceMenuOpen = false
            }
        }
        document.addEventListener("click", handler, true)
        return {
            destroy() {
                document.removeEventListener("click", handler, true)
            }
        }
    }
</script>

<div class="mode-indicator-root" use:clickOutside={null} data-testid="mode-indicator-root">
    <button
        type="button"
        class={tierClass}
        class:popup-open={popupOpen}
        on:click={togglePopup}
        on:contextmenu={handleContextMenu}
        aria-label="Current sync tier: {tierLabel}. Click to see details. Right-click to force a tier."
        data-testid="mode-indicator-badge"
        data-tier={tier}
    >
        <span class="dot" aria-hidden="true"></span>
        <span class="label">{tierLabel}</span>
    </button>

    {#if popupOpen}
        <!-- The "what just happened" popup. AC2. -->
        <div class="popup" role="dialog" data-testid="mode-indicator-popup">
            <header>
                <span>Sync tier</span>
                <button type="button" class="popup-close" on:click={togglePopup} aria-label="Close">
                    ×
                </button>
            </header>
            <div class="popup-body">
                <strong class="popup-tier">{tierLabel}</strong>
                {#if lastTransition}
                    <p class="popup-reason" data-testid="mode-indicator-reason">{lastTransition.reason}</p>
                    {#if secondsAgo !== null}
                        <p class="popup-meta" data-testid="mode-indicator-since">
                            {lastTransition.from} → {lastTransition.to} · {secondsAgo}s ago
                        </p>
                    {/if}
                {:else}
                    <p class="popup-meta" data-testid="mode-indicator-no-transition">
                        No tier transitions yet.
                    </p>
                {/if}
            </div>
        </div>
    {/if}

    {#if forceMenuOpen}
        <!-- Right-click context menu — STORY-10.7 "Force any tier at any time" -->
        <div class="force-menu" role="menu" data-testid="mode-indicator-force-menu">
            <p class="force-menu-header">Force tier</p>
            {#each ALL_TIERS as t (t)}
                {#if t !== tier}
                    <button
                        type="button"
                        class="force-menu-item tier-{t}"
                        role="menuitem"
                        on:click={() => force(t)}
                        data-testid="force-tier-{t}"
                    >
                        Force {t.toUpperCase()}
                    </button>
                {/if}
            {/each}
        </div>
    {/if}
</div>

<style>
    .mode-indicator-root {
        position: relative;
        display: inline-block;
        font-family: ui-monospace, "SF Mono", Menlo, monospace;
        font-size: 0.85rem;
        user-select: none;
    }

    .mode-indicator {
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        padding: 0.35rem 0.7rem;
        background: #0f0f0f;
        color: #e0e0e0;
        border: 1px solid #2a2a2a;
        border-radius: 999px;
        font-family: inherit;
        font-size: inherit;
        font-weight: 600;
        letter-spacing: 0.08em;
        cursor: pointer;
        transition: background 80ms linear, border-color 80ms linear;
    }
    .mode-indicator:hover,
    .mode-indicator.popup-open {
        background: #161616;
        border-color: #3a3a3a;
    }

    .dot {
        display: inline-block;
        width: 0.55rem;
        height: 0.55rem;
        border-radius: 50%;
        background: currentColor;
        box-shadow: 0 0 6px currentColor;
    }

    .mode-indicator.tier-auto {
        color: #4caf50;
        border-color: #1a3a1a;
    }
    .mode-indicator.tier-timer {
        color: #ffb300;
        border-color: #3a2a0a;
    }
    .mode-indicator.tier-manual {
        color: #ff5252;
        border-color: #3a1010;
    }

    .popup {
        position: absolute;
        top: calc(100% + 0.4rem);
        right: 0;
        min-width: 240px;
        background: #1a1a1a;
        color: #e0e0e0;
        border: 1px solid #2a2a2a;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        z-index: 10;
    }
    .popup header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.4rem 0.6rem;
        border-bottom: 1px solid #2a2a2a;
        font-size: 0.75rem;
        color: #888;
    }
    .popup-close {
        background: none;
        border: none;
        color: #888;
        cursor: pointer;
        font-size: 1.1rem;
        line-height: 1;
        padding: 0 0.3rem;
    }
    .popup-close:hover {
        color: #fff;
    }
    .popup-body {
        padding: 0.6rem;
    }
    .popup-tier {
        font-size: 1rem;
        letter-spacing: 0.05em;
    }
    .popup-reason {
        margin: 0.4rem 0 0;
        font-size: 0.85rem;
        font-family: system-ui, sans-serif;
        line-height: 1.4;
    }
    .popup-meta {
        margin: 0.4rem 0 0;
        font-size: 0.75rem;
        color: #888;
    }

    .force-menu {
        position: absolute;
        top: calc(100% + 0.4rem);
        right: 0;
        min-width: 180px;
        background: #1a1a1a;
        border: 1px solid #2a2a2a;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        z-index: 10;
        padding: 0.35rem 0;
    }
    .force-menu-header {
        margin: 0;
        padding: 0.2rem 0.7rem;
        font-size: 0.7rem;
        color: #888;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    .force-menu-item {
        display: block;
        width: 100%;
        text-align: left;
        background: none;
        border: none;
        font-family: inherit;
        font-size: inherit;
        color: #e0e0e0;
        padding: 0.4rem 0.7rem;
        cursor: pointer;
    }
    .force-menu-item:hover {
        background: #2a2a2a;
    }
    .force-menu-item.tier-auto {
        color: #4caf50;
    }
    .force-menu-item.tier-timer {
        color: #ffb300;
    }
    .force-menu-item.tier-manual {
        color: #ff5252;
    }
</style>
