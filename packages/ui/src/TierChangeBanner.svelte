<!--
    TierChangeBanner.svelte — transient banner that surfaces tier transitions.

    Per EP-10 STORY-10.7, FR5.7. The banner appears at the top of the operator's main
    screen when the SyncEngine transitions tiers (auto → timer, audio-input-lost, etc.).
    It auto-collapses to a small hint icon after a configurable timeout, so it doesn't
    visually compete with the rest of the operator UI for the rest of the service.

    The component is presentation-only:
      - Host watches SyncEngineState.tier and constructs a `transition` prop
        whenever it changes. The host is also responsible for clearing the prop
        if it wants to dismiss the banner manually (e.g., on song change).
      - The visible/collapsed state is internal: a new transition expands; after
        autoCollapseMs the banner collapses to a small icon; clicking the icon
        re-expands it.
-->
<script lang="ts">
    import { createEventDispatcher } from "svelte"
    import type { TierTransition } from "./types.js"

    /**
     * The most recent transition. When this changes (by identity) the banner expands
     * + restarts its auto-collapse timer. Set to null when there's no transition to
     * show (fresh boot, or the host has explicitly dismissed it).
     */
    export let transition: TierTransition | null = null

    /** How long the banner stays expanded before collapsing to an icon. Default 5s per AC2. */
    export let autoCollapseMs = 5000

    /**
     * Test-friendly clock injection — wakes a deterministic scheduler that the test
     * advances via vitest's fake timers. Production uses the global setTimeout.
     */
    export let scheduleTimeout: (cb: () => void, ms: number) => (() => void) = (cb, ms) => {
        const id = setTimeout(cb, ms)
        return () => clearTimeout(id)
    }

    const dispatch = createEventDispatcher<{ dismiss: void; expand: void }>()

    let expanded = false
    let lastSeenTransition: TierTransition | null = null
    let cancelTimer: (() => void) | null = null

    function scheduleCollapse(): void {
        cancelTimer?.()
        cancelTimer = scheduleTimeout(() => {
            expanded = false
        }, autoCollapseMs)
    }

    // Reactive: when a new transition arrives (by identity), expand + (re)schedule.
    $: if (transition !== lastSeenTransition) {
        lastSeenTransition = transition
        if (transition !== null) {
            expanded = true
            scheduleCollapse()
        } else {
            expanded = false
            cancelTimer?.()
        }
    }

    function dismiss(): void {
        cancelTimer?.()
        expanded = false
        dispatch("dismiss")
    }

    function reExpand(): void {
        if (transition === null) return
        expanded = true
        scheduleCollapse()
        dispatch("expand")
    }

    $: tierClass = transition ? `tier-${transition.to}` : ""
    $: arrowSymbol = transition === null ? "" : `${transition.from.toUpperCase()} → ${transition.to.toUpperCase()}`
</script>

{#if transition !== null}
    {#if expanded}
        <div
            class="tier-change-banner expanded {tierClass}"
            role="status"
            aria-live="polite"
            data-testid="tier-change-banner"
            data-tier-to={transition.to}
        >
            <span class="arrow" data-testid="tier-change-arrow">{arrowSymbol}</span>
            <span class="reason" data-testid="tier-change-reason">{transition.reason}</span>
            <button
                type="button"
                class="dismiss"
                on:click={dismiss}
                aria-label="Dismiss tier-change notification"
                data-testid="tier-change-dismiss"
            >
                ×
            </button>
        </div>
    {:else}
        <button
            type="button"
            class="tier-change-icon {tierClass}"
            on:click={reExpand}
            aria-label="Show the most recent tier change: {arrowSymbol}"
            title="{arrowSymbol} — {transition.reason}"
            data-testid="tier-change-icon"
        >
            <span class="dot" aria-hidden="true"></span>
        </button>
    {/if}
{/if}

<style>
    .tier-change-banner {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.5rem 0.9rem;
        background: #1a1a1a;
        border: 1px solid #2a2a2a;
        border-radius: 6px;
        color: #e0e0e0;
        font-family: system-ui, sans-serif;
        font-size: 0.85rem;
    }
    .tier-change-banner.tier-timer {
        border-left: 4px solid #ffb300;
    }
    .tier-change-banner.tier-manual {
        border-left: 4px solid #ff5252;
    }
    .tier-change-banner.tier-auto {
        border-left: 4px solid #4caf50;
    }
    .arrow {
        font-family: ui-monospace, "SF Mono", Menlo, monospace;
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        color: #aaa;
    }
    .reason {
        flex: 1;
    }
    .dismiss {
        background: none;
        border: none;
        color: #888;
        cursor: pointer;
        font-size: 1.1rem;
        line-height: 1;
        padding: 0.1rem 0.35rem;
    }
    .dismiss:hover {
        color: #fff;
    }

    .tier-change-icon {
        background: #1a1a1a;
        border: 1px solid #2a2a2a;
        border-radius: 50%;
        width: 1.6rem;
        height: 1.6rem;
        cursor: pointer;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }
    .tier-change-icon .dot {
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 50%;
        background: currentColor;
        box-shadow: 0 0 6px currentColor;
    }
    .tier-change-icon.tier-auto {
        color: #4caf50;
    }
    .tier-change-icon.tier-timer {
        color: #ffb300;
    }
    .tier-change-icon.tier-manual {
        color: #ff5252;
    }
</style>
