<script lang="ts">
    import type { Project, ProjectPlan } from "@lyricue/core/setlist"

    export let centralProjects: ProjectPlan[] = []
    export let localProjects: Project[] = []
    export let onSelectCentral: (plan: ProjectPlan) => void
    export let onSelectLocal: (project: Project) => void
    export let onBuildNew: () => void

    let source: "central" | "local" | "new" = "central"

    function selectLocal(e: Event): void {
        const project = localProjects.find((item) => item.id === (e.currentTarget as HTMLSelectElement).value)
        if (project) onSelectLocal(project)
    }
</script>

<section class="source-picker" aria-label="Setlist Source">
    <h2>Setlist Source</h2>
    <label><input type="radio" bind:group={source} value="central" /> From central library</label>
    {#if source === "central"}
        <ul>
            {#each centralProjects as project}
                <li>
                    <button on:click={() => onSelectCentral(project)}>
                        {project.date ? `${project.date} - ` : ""}{project.name}
                    </button>
                </li>
            {/each}
        </ul>
    {/if}

    <label><input type="radio" bind:group={source} value="local" /> My local project</label>
    {#if source === "local"}
        <select aria-label="Local project" on:change={selectLocal}>
            <option value="">Pick a project</option>
            {#each localProjects as project}
                <option value={project.id}>{project.date ? `${project.date} - ` : ""}{project.title}</option>
            {/each}
        </select>
    {/if}

    <label><input type="radio" bind:group={source} value="new" /> Build a new one</label>
    {#if source === "new"}
        <button on:click={onBuildNew}>Build New</button>
    {/if}
</section>

<style>
    .source-picker {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }
    label {
        display: flex;
        gap: 0.4rem;
        align-items: center;
    }
    ul {
        margin: 0;
        padding-left: 1.5rem;
    }
    button,
    select {
        font: inherit;
        padding: 0.45rem;
    }
</style>
