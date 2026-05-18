<!--
    FirstRunWizard.svelte — the 5-step first-launch flow per architecture.md §8.4 and
    epics.md STORY-01.5.

    Architectural notes:
      - Host-app neutral. Receives all dependencies as props/callbacks so the same component
        runs in both fork and sister modes (P11, ADR-16) without conditional imports.
      - Audio device list is *injected* (so EP-07 can provide the real list; here we accept
        the host's stub).
      - Library connect / publish credential test are async callbacks. EP-01 stubs them; the
        wizard cannot tell the difference between stub and production wiring.
      - Output: on Finish, calls `onComplete(draft)` with the final WizardDraft. The host
        translates that into IdentityStore.save / LibraryConfigStore.save / SettingsStore.save
        as appropriate.
      - AC4 (anonymous local-only fully usable): every step after Welcome is Skip-able.
      - AC6 (re-runnable from settings): nothing in this component assumes first-run; the
        host decides when to show it.

    Visual design is intentionally minimal — solid CSS, no design system yet. Polish happens
    in EP-10 once we know the host's design tokens (FreeShow's in fork mode, our own in sister).
-->
<script lang="ts">
    import {
        newWizardDraft,
        nextStep,
        prevStep,
        type CredentialTestResult,
        type LibraryConnectResult,
        type WizardDraft,
        type WizardStep
    } from "@lyricue/core/settings"

    /**
     * Audio devices the host has enumerated. Empty array is fine during STORY-01.5 (the
     * picker shows a placeholder). EP-07 STORY-07.1 supplies the real list.
     */
    export let audioDevices: { deviceId: string; label: string }[] = []

    /**
     * Connect-to-library test. Returns the detected org name on success, throws on failure.
     * STORY-01.5 stub: returns null and the wizard treats it as "not connected, but proceed."
     * EP-13 STORY-13.1 replaces with a real catalog fetch.
     */
    export let onLibraryConnect: ((url: string) => Promise<string | LibraryConnectResult | null>) | undefined = undefined

    /**
     * Publish credential validation. Stub in STORY-01.5; real in EP-15 STORY-15.3.
     */
    export let onCredentialTest: ((credential: string) => Promise<boolean | CredentialTestResult>) | undefined = undefined

    /** Called when the operator finishes the wizard. Host persists the result. */
    export let onComplete: (draft: WizardDraft) => void

    /** Called when the operator cancels mid-wizard. Host typically closes the window. */
    export let onCancel: (() => void) | undefined = undefined

    let draft: WizardDraft = newWizardDraft()
    let connecting = false
    let connectError = ""
    let testingCred = false
    let credResult: "untested" | "ok" | "fail" = "untested"
    let credentialDraft = ""

    function goNext(): void {
        draft.currentStep = nextStep(draft.currentStep)
    }
    function goBack(): void {
        draft.currentStep = prevStep(draft.currentStep)
    }

    async function tryConnect(): Promise<void> {
        if (!draft.libraryUrl) {
            draft.detectedOrgName = null
            goNext()
            return
        }
        connecting = true
        connectError = ""
        try {
            const result = onLibraryConnect ? await onLibraryConnect(draft.libraryUrl) : null
            if (typeof result === "string" || result === null) {
                draft.detectedOrgName = result
                draft.detectedOrgId = null
                draft.catalogCampuses = []
            } else {
                draft.detectedOrgName = result.orgName
                draft.detectedOrgId = result.orgId ?? null
                draft.catalogCampuses = result.campuses ?? []
                const firstCampus = draft.catalogCampuses[0]
                if (firstCampus) {
                    draft.campusId = firstCampus.id
                    draft.campusName = firstCampus.name
                }
            }
            goNext()
        } catch (err) {
            connectError = (err as Error).message || "Could not reach that URL."
        } finally {
            connecting = false
        }
    }

    async function tryCredential(): Promise<void> {
        if (!credentialDraft) {
            credResult = "untested"
            return
        }
        testingCred = true
        try {
            const result = onCredentialTest ? await onCredentialTest(credentialDraft) : true
            const normalized = typeof result === "boolean" ? { ok: result } : result
            credResult = normalized.ok ? "ok" : "fail"
            draft.publishCredentialEntered = normalized.ok
            draft.publishCredentialKeyId = normalized.keyId
        } catch {
            credResult = "fail"
        } finally {
            testingCred = false
        }
    }

    function finish(): void {
        draft.currentStep = "done"
        onComplete(draft)
    }

    function isValidStepIdentity(d: WizardDraft): boolean {
        // Either fully anonymous, or has at least a campus id.
        if (d.isAnonymous) return true
        return Boolean(d.campusId && d.campusName)
    }

    function onCampusInput(e: Event): void {
        const v = (e.currentTarget as HTMLInputElement).value
        draft.campusName = v
        const id = v
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "-")
            .replace(/^-+|-+$/g, "")
        draft.campusId = id || undefined
    }

    function onCampusSelect(e: Event): void {
        const id = (e.currentTarget as HTMLSelectElement).value
        const campus = draft.catalogCampuses.find((candidate) => candidate.id === id)
        draft.campusId = campus?.id
        draft.campusName = campus?.name
    }

    $: stepIndex = ["welcome", "audio", "library", "identity", "publish", "done"].indexOf(draft.currentStep)
</script>

<div class="wizard">
    <header>
        <h1>Welcome to LyriCue</h1>
        <ol class="steps">
            {#each ["Welcome", "Audio Input", "Library", "Identity", "Publish Access", "Done"] as label, i}
                <li class:active={i === stepIndex} class:past={i < stepIndex}>{label}</li>
            {/each}
        </ol>
    </header>

    <main>
        {#if draft.currentStep === "welcome"}
            <section>
                <h2>Live word-by-word lyric sync.</h2>
                <p>This wizard takes about a minute. You can skip every step except this one — anonymous local-only is a fine default and you can change anything later from Settings.</p>
                <button class="primary" on:click={goNext}>Get started</button>
                {#if onCancel}<button class="link" on:click={() => onCancel?.()}>Quit</button>{/if}
            </section>
        {:else if draft.currentStep === "audio"}
            <section>
                <h2>Audio input</h2>
                <p>Pick the audio device LyriCue will listen to during live performance — usually your sound desk line-in.</p>

                {#if audioDevices.length === 0}
                    <p class="hint">No audio devices detected yet. You can finish the wizard and configure this later from Settings &rsaquo; Sync.</p>
                {:else}
                    <label>
                        Device
                        <select bind:value={draft.audioInputDeviceId}>
                            <option value={null}>— choose later —</option>
                            {#each audioDevices as device}
                                <option value={device.deviceId}>{device.label}</option>
                            {/each}
                        </select>
                    </label>
                {/if}

                <div class="actions">
                    <button on:click={goBack}>Back</button>
                    <button class="primary" on:click={goNext}>Next</button>
                </div>
            </section>
        {:else if draft.currentStep === "library"}
            <section>
                <h2>Library connection (optional)</h2>
                <p>If your organisation runs a shared LyriCue library, paste the URL. Otherwise skip — every other LyriCue feature works without one.</p>

                <label>
                    Library URL
                    <input type="url" placeholder="https://library.example.org" bind:value={draft.libraryUrl} />
                </label>

                {#if connectError}<p class="error">{connectError}</p>{/if}
                {#if draft.detectedOrgName}<p class="ok">Connected to <strong>{draft.detectedOrgName}</strong>.</p>{/if}

                <div class="actions">
                    <button on:click={goBack}>Back</button>
                    <button on:click={() => { draft.libraryUrl = ""; draft.detectedOrgName = null; goNext() }}>Skip</button>
                    <button class="primary" disabled={connecting} on:click={tryConnect}>
                        {connecting ? "Connecting…" : draft.libraryUrl ? "Connect & continue" : "Continue"}
                    </button>
                </div>
            </section>
        {:else if draft.currentStep === "identity"}
            <section>
                <h2>Identity</h2>
                {#if draft.detectedOrgName}
                    <p>Detected organisation: <strong>{draft.detectedOrgName}</strong></p>
                {:else}
                    <p>Running local-only — no organisation configured.</p>
                {/if}

                {#if draft.catalogCampuses.length > 0}
                    <label>
                        Campus / venue / location
                        <select aria-label="Campus" value={draft.campusId ?? ""} on:change={onCampusSelect}>
                            {#each draft.catalogCampuses as campus}
                                <option value={campus.id}>{campus.name}</option>
                            {/each}
                            <option value="">Create new campus...</option>
                        </select>
                    </label>
                {/if}

                {#if draft.catalogCampuses.length === 0 || !draft.campusId}
                    <label>
                        Campus / venue / location
                        <input type="text" placeholder="e.g. pretoria-north" value={draft.campusName ?? ""} on:input={onCampusInput} />
                    </label>
                {/if}
                <p class="hint">Used purely as an attribution tag — not a login.</p>

                <fieldset class="anon">
                    <legend>Your name (optional)</legend>
                    <label class="radio">
                        <input type="radio" bind:group={draft.isAnonymous} value={true} /> Stay anonymous
                    </label>
                    <label class="radio">
                        <input type="radio" bind:group={draft.isAnonymous} value={false} /> Show my name
                    </label>
                    {#if !draft.isAnonymous}
                        <input type="text" placeholder="Display name" bind:value={draft.userDisplayName} />
                    {/if}
                </fieldset>

                <div class="actions">
                    <button on:click={goBack}>Back</button>
                    <button class="primary" disabled={!isValidStepIdentity(draft)} on:click={goNext}>Next</button>
                </div>
            </section>
        {:else if draft.currentStep === "publish"}
            <section>
                <h2>Publish access (optional)</h2>
                <p>Most operators don't need this. Skip unless your IT lead gave you a publish credential.</p>

                <label>
                    Credential
                    <input type="password" placeholder="Paste credential here" bind:value={credentialDraft} />
                </label>

                {#if credResult === "ok"}<p class="ok">Credential accepted.</p>{/if}
                {#if credResult === "fail"}<p class="error">That credential was rejected.</p>{/if}

                <div class="actions">
                    <button on:click={goBack}>Back</button>
                    <button on:click={() => { credentialDraft = ""; credResult = "untested"; finish() }}>Skip</button>
                    <button disabled={!credentialDraft || testingCred} on:click={tryCredential}>
                        {testingCred ? "Testing…" : "Test"}
                    </button>
                    <button class="primary" on:click={finish}>Finish</button>
                </div>
            </section>
        {:else if draft.currentStep === "done"}
            <section>
                <h2>All set.</h2>
                <p>LyriCue is ready to use. Open Settings later if you need to change any of this.</p>
            </section>
        {/if}
    </main>
</div>

<style>
    .wizard {
        font-family: system-ui, sans-serif;
        max-width: 640px;
        margin: 2rem auto;
        padding: 1.5rem;
        background: #fff;
        color: #111;
        border-radius: 12px;
        box-shadow: 0 4px 30px rgba(0, 0, 0, 0.12);
    }
    header h1 {
        font-size: 1.5rem;
        margin: 0 0 0.5rem;
    }
    .steps {
        list-style: none;
        padding: 0;
        display: flex;
        gap: 0.5rem;
        margin: 0 0 1.5rem;
        font-size: 0.85rem;
        color: #999;
        flex-wrap: wrap;
    }
    .steps li.active {
        color: #111;
        font-weight: 600;
    }
    .steps li.past {
        color: #4a8;
    }
    main section {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }
    main h2 {
        font-size: 1.2rem;
        margin: 0;
    }
    label {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        font-size: 0.9rem;
    }
    input,
    select {
        font: inherit;
        padding: 0.5rem;
        border: 1px solid #ccc;
        border-radius: 6px;
    }
    .anon {
        border: 1px solid #ddd;
        border-radius: 6px;
        padding: 0.75rem;
        margin: 0;
    }
    .anon legend {
        font-size: 0.85rem;
        color: #666;
        padding: 0 0.25rem;
    }
    .radio {
        flex-direction: row;
        align-items: center;
        gap: 0.5rem;
        margin: 0.25rem 0;
    }
    .actions {
        display: flex;
        gap: 0.5rem;
        justify-content: flex-end;
        margin-top: 1rem;
    }
    button {
        font: inherit;
        padding: 0.5rem 1rem;
        border: 1px solid #ccc;
        border-radius: 6px;
        background: #f3f3f3;
        cursor: pointer;
    }
    button:hover:not(:disabled) {
        background: #eaeaea;
    }
    button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    button.primary {
        background: #1f6feb;
        color: white;
        border-color: #1f6feb;
    }
    button.primary:hover:not(:disabled) {
        background: #1858c6;
    }
    button.link {
        background: none;
        border: none;
        color: #1f6feb;
        text-decoration: underline;
    }
    p.hint {
        color: #666;
        font-size: 0.85rem;
        margin: 0;
    }
    p.error {
        color: #c33;
        font-size: 0.9rem;
        margin: 0;
    }
    p.ok {
        color: #2a8;
        font-size: 0.9rem;
        margin: 0;
    }
</style>
