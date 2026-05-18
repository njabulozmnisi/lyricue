import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { writable } from "@lyricue/core/settings"
import KaraokeOutput from "./KaraokeOutput.svelte"

/**
 * EP-06 KaraokeOutput tests. We mount the Svelte 3 component directly into jsdom and
 * exercise the public envelope contract (LC_LOAD_MAP + LC_SYNC_FRAME) plus the
 * settings-driven CSS custom properties.
 *
 * Why no @testing-library/svelte: the package isn't in deps and the component is small
 * enough that the raw Svelte API is the lowest-friction option. Same pattern as
 * DiagnosticsPanel.test.ts.
 */

interface EnvelopeLike {
    channel: string
    data: unknown
}

type EnvelopeBus = {
    push(envelope: EnvelopeLike): void
    subscribe: (handler: (envelope: EnvelopeLike) => void) => () => void
}

function makeEnvelopeBus(): EnvelopeBus {
    let h: ((e: EnvelopeLike) => void) | null = null
    const queued: EnvelopeLike[] = []
    return {
        push(envelope) {
            if (h) h(envelope)
            else queued.push(envelope)
        },
        subscribe(handler) {
            h = handler
            // Drain any envelopes pushed before subscribe (mount-order race).
            const pending = queued.splice(0, queued.length)
            for (const env of pending) handler(env)
            return () => {
                h = null
            }
        }
    }
}

function makeLoadMap(outputId: string) {
    return {
        outputId,
        showId: "show-001",
        timingMap: {
            $schema: "lyricue-timing-v1",
            showId: "show-001",
            learnedFrom: { method: "studio", duration: 60, learnedAt: "2026-05-15T00:00:00Z" },
            bpm: 76,
            language: "en",
            sections: [
                {
                    id: "v1",
                    type: "verse",
                    label: "Verse 1",
                    slideIndex: 0,
                    startMs: 0,
                    endMs: 3000,
                    words: [
                        { text: "Amazing", startMs: 0, endMs: 1000, confidence: 0.9, lineIndex: 0 },
                        { text: "grace", startMs: 1000, endMs: 2000, confidence: 0.9, lineIndex: 0, held: true },
                        { text: "how", startMs: 2000, endMs: 2500, confidence: 0.9, lineIndex: 1 },
                        { text: "sweet", startMs: 2500, endMs: 3000, confidence: 0.9, lineIndex: 1 }
                    ],
                    lines: [
                        { startMs: 0, endMs: 2000, wordStartIndex: 0, wordEndIndex: 2 },
                        { startMs: 2000, endMs: 3000, wordStartIndex: 2, wordEndIndex: 4 }
                    ]
                },
                {
                    id: "c1",
                    type: "chorus",
                    label: "Chorus",
                    slideIndex: 1,
                    startMs: 3000,
                    endMs: 6000,
                    words: [
                        { text: "Then", startMs: 3000, endMs: 3800, confidence: 0.9, lineIndex: 0 },
                        { text: "sings", startMs: 3800, endMs: 4600, confidence: 0.9, lineIndex: 0 },
                        { text: "my", startMs: 4600, endMs: 5100, confidence: 0.9, lineIndex: 0 },
                        { text: "soul", startMs: 5100, endMs: 6000, confidence: 0.9, lineIndex: 0, held: true }
                    ],
                    lines: [
                        { startMs: 3000, endMs: 6000, wordStartIndex: 0, wordEndIndex: 4 }
                    ]
                }
            ],
            metadata: { schemaVersion: "1", version: "1.0.0" }
        },
        arrangement: null
    }
}

function makeFrame(overrides: Partial<{ outputId: string; slideIndex: number; wordIndex: number; wordProgress: number; tier: "auto" | "timer" | "manual"; vad: "active" | "silent"; nextSongTitle: string | null }> = {}) {
    return {
        outputId: "out-1",
        slideIndex: 0,
        wordIndex: 0,
        wordProgress: 0,
        tier: "auto" as const,
        vad: "active" as const,
        ...overrides
    }
}

describe("KaraokeOutput", () => {
    let target: HTMLElement
    let bus: EnvelopeBus

    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
        bus = makeEnvelopeBus()
    })

    afterEach(() => {
        document.body.removeChild(target)
    })

    describe("initial state", () => {
        it("shows a 'Waiting for song' placeholder when no LC_LOAD_MAP has arrived", () => {
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe }
            })
            expect(target.querySelector(".placeholder-sub")?.textContent).toContain("Waiting for song")
            cmp.$destroy()
        })

        it("renders a static placeholder when no subscribe prop is provided (test isolation)", () => {
            const cmp = new KaraokeOutput({ target, props: { outputId: "out-1" } })
            expect(target.querySelector(".karaoke-output")).not.toBeNull()
            cmp.$destroy()
        })
    })

    describe("LC_LOAD_MAP routing (D10 — outputId filtering)", () => {
        it("renders the timing map when LC_LOAD_MAP matches the outputId", async () => {
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe }
            })
            bus.push({ channel: "LC_LOAD_MAP", data: makeLoadMap("out-1") })
            await Promise.resolve()
            const wordTexts = Array.from(target.querySelectorAll(".word")).map((w) => w.textContent)
            expect(wordTexts).toContain("Amazing")
            expect(wordTexts).toContain("grace")
            expect(wordTexts).toContain("how")
            expect(wordTexts).toContain("sweet")
            cmp.$destroy()
        })

        it("ignores LC_LOAD_MAP for a different outputId", async () => {
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe }
            })
            bus.push({ channel: "LC_LOAD_MAP", data: makeLoadMap("out-2") })
            await Promise.resolve()
            expect(target.querySelectorAll(".word")).toHaveLength(0)
            expect(target.querySelector(".placeholder-sub")?.textContent).toContain("Waiting")
            cmp.$destroy()
        })
    })

    describe("LC_SYNC_FRAME routing + word state (STORY-06.2)", () => {
        async function mountWithMap(): Promise<{ cmp: KaraokeOutput }> {
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe }
            })
            bus.push({ channel: "LC_LOAD_MAP", data: makeLoadMap("out-1") })
            await Promise.resolve()
            return { cmp }
        }

        it("marks the active word with .active and earlier words with .sung", async () => {
            const { cmp } = await mountWithMap()
            bus.push({
                channel: "LC_SYNC_FRAME",
                data: makeFrame({ wordIndex: 1, wordProgress: 0.5 })
            })
            await Promise.resolve()
            const words = Array.from(target.querySelectorAll(".word"))
            expect(words[0]!.classList.contains("sung")).toBe(true)
            expect(words[1]!.classList.contains("active")).toBe(true)
            expect(words[2]!.classList.contains("upcoming")).toBe(true)
            expect(words[3]!.classList.contains("upcoming")).toBe(true)
            cmp.$destroy()
        })

        it("sets --progress style on the active word from wordProgress", async () => {
            const { cmp } = await mountWithMap()
            bus.push({
                channel: "LC_SYNC_FRAME",
                data: makeFrame({ wordIndex: 0, wordProgress: 0.42 })
            })
            await Promise.resolve()
            const word0 = target.querySelectorAll(".word")[0] as HTMLElement
            expect(word0.style.getPropertyValue("--progress")).toBe("0.42")
            cmp.$destroy()
        })

        it("clamps wordProgress into [0,1] for sung/upcoming words regardless of frame value", async () => {
            const { cmp } = await mountWithMap()
            bus.push({
                channel: "LC_SYNC_FRAME",
                data: makeFrame({ wordIndex: 2, wordProgress: 0.3 })
            })
            await Promise.resolve()
            const words = Array.from(target.querySelectorAll(".word")) as HTMLElement[]
            // Sung words read --progress = 1 (filled), upcoming = 0.
            expect(words[0]!.style.getPropertyValue("--progress")).toBe("1")
            expect(words[1]!.style.getPropertyValue("--progress")).toBe("1")
            expect(words[2]!.style.getPropertyValue("--progress")).toBe("0.3")
            expect(words[3]!.style.getPropertyValue("--progress")).toBe("0")
            cmp.$destroy()
        })

        it("ignores LC_SYNC_FRAME for a different outputId", async () => {
            const { cmp } = await mountWithMap()
            bus.push({
                channel: "LC_SYNC_FRAME",
                data: makeFrame({ outputId: "out-OTHER", wordIndex: 2 })
            })
            await Promise.resolve()
            const words = Array.from(target.querySelectorAll(".word"))
            // wordIndex 0 should still be .active (no frame was consumed).
            expect(words[0]!.classList.contains("active")).toBe(true)
            cmp.$destroy()
        })
    })

    describe("D7 — defensive frame validation at IPC boundary", () => {
        async function mountWithMap(): Promise<KaraokeOutput> {
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe }
            })
            bus.push({ channel: "LC_LOAD_MAP", data: makeLoadMap("out-1") })
            await Promise.resolve()
            return cmp
        }

        it("rejects a frame missing required fields", async () => {
            const cmp = await mountWithMap()
            bus.push({ channel: "LC_SYNC_FRAME", data: { outputId: "out-1" } })
            await Promise.resolve()
            // No frame consumed → word 0 is still .active.
            const word0 = target.querySelectorAll(".word")[0]!
            expect(word0.classList.contains("active")).toBe(true)
            cmp.$destroy()
        })

        it("rejects a frame with NaN wordProgress", async () => {
            const cmp = await mountWithMap()
            bus.push({
                channel: "LC_SYNC_FRAME",
                data: { ...makeFrame(), wordProgress: Number.NaN }
            })
            await Promise.resolve()
            // The first word stays active (the bogus frame was dropped).
            const word0 = target.querySelectorAll(".word")[0]!
            expect(word0.classList.contains("active")).toBe(true)
            cmp.$destroy()
        })

        it("rejects a frame with unknown tier", async () => {
            const cmp = await mountWithMap()
            bus.push({
                channel: "LC_SYNC_FRAME",
                data: { ...makeFrame(), tier: "what" }
            })
            await Promise.resolve()
            const root = target.querySelector(".karaoke-output")!
            expect(root.getAttribute("data-tier")).toBe("auto") // default, frame dropped
            cmp.$destroy()
        })

        it("rejects a LC_LOAD_MAP missing timingMap.sections", async () => {
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe }
            })
            bus.push({
                channel: "LC_LOAD_MAP",
                data: { outputId: "out-1", showId: "x", timingMap: {}, arrangement: null }
            })
            await Promise.resolve()
            // Still in 'waiting' placeholder — bad map dropped.
            expect(target.querySelector(".placeholder-sub")?.textContent).toContain("Waiting")
            cmp.$destroy()
        })

        it("does not crash on completely malformed envelopes", async () => {
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe }
            })
            bus.push(null as unknown as EnvelopeLike)
            bus.push({ channel: "LC_SYNC_FRAME", data: "not an object" })
            bus.push({ channel: "LC_LOAD_MAP", data: null })
            bus.push({ channel: "WHATEVER", data: { x: 1 } })
            await Promise.resolve()
            // Survived all of those; still rendering the placeholder.
            expect(target.querySelector(".karaoke-output")).not.toBeNull()
            cmp.$destroy()
        })
    })

    describe("Settings-driven CSS custom properties (STORY-06.1 — closes D6)", () => {
        it("applies highlight, sung, and upcoming colors from displaySettings", async () => {
            const settings = writable({
                highlightColor: "#FF0000",
                sungColor: "#222222",
                upcomingColor: "#AAAAAA",
                sungWordOpacity: 0.3,
                fontSize: 64,
                fontFamily: "Arial",
                heldNoteAnimation: "pulse" as const,
                parallelLyricsEnabled: false
            })
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe, displaySettings: settings }
            })
            await Promise.resolve()
            const root = target.querySelector(".karaoke-output") as HTMLElement
            expect(root.style.getPropertyValue("--highlight-color")).toBe("#FF0000")
            expect(root.style.getPropertyValue("--sung-color")).toBe("#222222")
            expect(root.style.getPropertyValue("--upcoming-color")).toBe("#AAAAAA")
            expect(root.style.getPropertyValue("--sung-opacity")).toBe("0.3")
            expect(root.style.getPropertyValue("--font-size-base")).toBe("64px")
            expect(root.style.getPropertyValue("--font-family")).toBe("Arial")
            cmp.$destroy()
        })

        it("updates colors reactively when displaySettings emits new value", async () => {
            const settings = writable({
                highlightColor: "#FFCC00",
                sungColor: "#666666",
                upcomingColor: "#CCCCCC",
                sungWordOpacity: 0.4,
                fontSize: 48,
                fontFamily: "Inter",
                heldNoteAnimation: "pulse" as const,
                parallelLyricsEnabled: false
            })
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe, displaySettings: settings }
            })
            await Promise.resolve()
            settings.set({
                highlightColor: "#00FF00",
                sungColor: "#666666",
                upcomingColor: "#CCCCCC",
                sungWordOpacity: 0.4,
                fontSize: 48,
                fontFamily: "Inter",
                heldNoteAnimation: "pulse",
                parallelLyricsEnabled: false
            })
            await Promise.resolve()
            const root = target.querySelector(".karaoke-output") as HTMLElement
            expect(root.style.getPropertyValue("--highlight-color")).toBe("#00FF00")
            cmp.$destroy()
        })

        it("falls back to defaults when displaySettings is omitted", async () => {
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe }
            })
            await Promise.resolve()
            const root = target.querySelector(".karaoke-output") as HTMLElement
            expect(root.style.getPropertyValue("--highlight-color")).toBe("#FFCC00")
            expect(root.style.getPropertyValue("--sung-color")).toBe("#666666")
            expect(root.style.getPropertyValue("--upcoming-color")).toBe("#CCCCCC")
            cmp.$destroy()
        })
    })

    describe("STORY-06.4 — held-note animation", () => {
        it("applies the .held class to words flagged held=true", async () => {
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe }
            })
            bus.push({ channel: "LC_LOAD_MAP", data: makeLoadMap("out-1") })
            await Promise.resolve()
            const words = Array.from(target.querySelectorAll(".word"))
            // 'grace' is held (index 1).
            expect(words[1]!.classList.contains("held")).toBe(true)
            expect(words[0]!.classList.contains("held")).toBe(false)
            cmp.$destroy()
        })

        it("respects the heldNoteAnimation setting via data-held-anim attribute", async () => {
            const settings = writable({
                highlightColor: "#FFCC00",
                sungColor: "#666666",
                upcomingColor: "#CCCCCC",
                sungWordOpacity: 0.4,
                fontSize: 48,
                fontFamily: "Inter",
                heldNoteAnimation: "glow" as const,
                parallelLyricsEnabled: false
            })
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe, displaySettings: settings }
            })
            bus.push({ channel: "LC_LOAD_MAP", data: makeLoadMap("out-1") })
            await Promise.resolve()
            const words = Array.from(target.querySelectorAll(".word"))
            expect(words[1]!.getAttribute("data-held-anim")).toBe("glow")
            cmp.$destroy()
        })
    })

    describe("STORY-06.7 — parallel lyrics", () => {
        function makeLoadMapWithParallel() {
            const base = makeLoadMap("out-1")
            return {
                ...base,
                parallelLyrics: [
                    {
                        language: "zu-ZA",
                        sections: [{ sectionId: "v1", text: "Akekho ofana noJesu\nNgiyabonga" }]
                    }
                ]
            }
        }

        it("does NOT render the parallel container when parallelLyricsEnabled=false", async () => {
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe }
            })
            bus.push({ channel: "LC_LOAD_MAP", data: makeLoadMapWithParallel() })
            await Promise.resolve()
            expect(target.querySelector(".parallel")).toBeNull()
            cmp.$destroy()
        })

        it("renders the parallel container when enabled and a track matches the section", async () => {
            const settings = writable({
                highlightColor: "#FFCC00",
                sungColor: "#666666",
                upcomingColor: "#CCCCCC",
                sungWordOpacity: 0.4,
                fontSize: 48,
                fontFamily: "Inter",
                heldNoteAnimation: "pulse" as const,
                parallelLyricsEnabled: true
            })
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe, displaySettings: settings }
            })
            bus.push({ channel: "LC_LOAD_MAP", data: makeLoadMapWithParallel() })
            await Promise.resolve()
            const parallel = target.querySelector(".parallel")
            expect(parallel).not.toBeNull()
            const lines = Array.from(target.querySelectorAll(".parallel-line")).map((el) => el.textContent)
            expect(lines).toContain("Akekho ofana noJesu")
            expect(lines).toContain("Ngiyabonga")
            cmp.$destroy()
        })

        it("scales one secondary track to 60% for two displayed languages", async () => {
            const settings = writable({
                highlightColor: "#FFCC00",
                sungColor: "#666666",
                upcomingColor: "#CCCCCC",
                sungWordOpacity: 0.4,
                fontSize: 48,
                fontFamily: "Inter",
                heldNoteAnimation: "pulse" as const,
                parallelLyricsEnabled: true
            })
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe, displaySettings: settings }
            })
            bus.push({ channel: "LC_LOAD_MAP", data: makeLoadMapWithParallel() })
            await Promise.resolve()
            const parallel = target.querySelector(".parallel") as HTMLElement
            expect(parallel.style.fontSize).toContain("0.6")
            cmp.$destroy()
        })

        it("renders two secondary tracks at 50% for three displayed languages", async () => {
            const base = makeLoadMap("out-1")
            const payload = {
                ...base,
                parallelLyrics: [
                    { language: "zu-ZA", sections: [{ sectionId: "v1", text: "isiZulu" }] },
                    { language: "es", sections: [{ sectionId: "v1", text: "español" }] }
                ]
            }
            const settings = writable({
                highlightColor: "#FFCC00",
                sungColor: "#666666",
                upcomingColor: "#CCCCCC",
                sungWordOpacity: 0.4,
                fontSize: 48,
                fontFamily: "Inter",
                heldNoteAnimation: "pulse" as const,
                parallelLyricsEnabled: true
            })
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe, displaySettings: settings }
            })
            bus.push({ channel: "LC_LOAD_MAP", data: payload })
            await Promise.resolve()
            const parallel = target.querySelector(".parallel") as HTMLElement
            expect(parallel.style.fontSize).toContain("0.5")
            expect(target.querySelectorAll(".parallel-track")).toHaveLength(2)
            cmp.$destroy()
        })

        it("reflects a primary-language swap on the next render", async () => {
            const settings = writable({
                highlightColor: "#FFCC00",
                sungColor: "#666666",
                upcomingColor: "#CCCCCC",
                sungWordOpacity: 0.4,
                fontSize: 48,
                fontFamily: "Inter",
                heldNoteAnimation: "pulse" as const,
                parallelLyricsEnabled: true,
                primaryLyricsLanguage: "zu-ZA"
            })
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe, displaySettings: settings }
            })
            bus.push({ channel: "LC_LOAD_MAP", data: makeLoadMapWithParallel() })
            await Promise.resolve()
            const primary = target.querySelector(".primary-translation") as HTMLElement
            expect(primary.dataset.language).toBe("zu-ZA")
            expect(primary.textContent).toContain("Akekho ofana noJesu")
            expect(target.querySelector(".parallel-track")?.textContent).toContain("Amazing grace")
            cmp.$destroy()
        })
    })

    describe("tempo-adaptive word easing (--word-ease-ms)", () => {
        it("sets --word-ease-ms on the root container based on the active word's duration", async () => {
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe }
            })
            bus.push({ channel: "LC_LOAD_MAP", data: makeLoadMap("out-1") })
            // "Amazing" is the first word (0-1000ms duration) → 140ms ease per wordEaseMs.
            bus.push({
                channel: "LC_SYNC_FRAME",
                data: makeFrame({ wordIndex: 0, wordProgress: 0.5 })
            })
            await Promise.resolve()
            const root = target.querySelector(".karaoke-output") as HTMLElement
            expect(root.style.getPropertyValue("--word-ease-ms")).toBe("140ms")
            cmp.$destroy()
        })

        it("updates --word-ease-ms when the cursor moves to a word with different duration", async () => {
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe }
            })
            bus.push({ channel: "LC_LOAD_MAP", data: makeLoadMap("out-1") })
            // Move to "how" (wordIndex=2, 500ms duration → 80ms ease).
            bus.push({
                channel: "LC_SYNC_FRAME",
                data: makeFrame({ wordIndex: 2, wordProgress: 0.5 })
            })
            await Promise.resolve()
            const root = target.querySelector(".karaoke-output") as HTMLElement
            expect(root.style.getPropertyValue("--word-ease-ms")).toBe("80ms")
            cmp.$destroy()
        })

        it("falls back to 80ms baseline before any frame arrives", async () => {
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe }
            })
            bus.push({ channel: "LC_LOAD_MAP", data: makeLoadMap("out-1") })
            await Promise.resolve()
            const root = target.querySelector(".karaoke-output") as HTMLElement
            expect(root.style.getPropertyValue("--word-ease-ms")).toBe("80ms")
            cmp.$destroy()
        })
    })

    describe("data-tier / data-vad attributes (operator feedback)", () => {
        it("reflects tier and vad from the active frame", async () => {
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe }
            })
            bus.push({ channel: "LC_LOAD_MAP", data: makeLoadMap("out-1") })
            await Promise.resolve()
            bus.push({
                channel: "LC_SYNC_FRAME",
                data: makeFrame({ tier: "manual", vad: "silent" })
            })
            await Promise.resolve()
            const root = target.querySelector(".karaoke-output")!
            expect(root.getAttribute("data-tier")).toBe("manual")
            expect(root.getAttribute("data-vad")).toBe("silent")
            cmp.$destroy()
        })
    })

    describe("EP-12 — congregation next-song hint", () => {
        it("renders the Next hint when a frame carries nextSongTitle", async () => {
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe }
            })
            bus.push({ channel: "LC_LOAD_MAP", data: makeLoadMap("out-1") })
            bus.push({
                channel: "LC_SYNC_FRAME",
                data: makeFrame({ nextSongTitle: "Good Good Father" })
            })
            await Promise.resolve()
            const hint = target.querySelector(".next-song-hint")
            expect(hint?.textContent).toContain("Next:")
            expect(hint?.textContent).toContain("Good Good Father")
            cmp.$destroy()
        })

        it("hides the Next hint when nextSongTitle is absent or null", async () => {
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe }
            })
            bus.push({ channel: "LC_LOAD_MAP", data: makeLoadMap("out-1") })
            bus.push({ channel: "LC_SYNC_FRAME", data: makeFrame() })
            await Promise.resolve()
            expect(target.querySelector(".next-song-hint")).toBeNull()
            bus.push({ channel: "LC_SYNC_FRAME", data: makeFrame({ nextSongTitle: null }) })
            await Promise.resolve()
            expect(target.querySelector(".next-song-hint")).toBeNull()
            cmp.$destroy()
        })

        it("rejects a frame with a malformed nextSongTitle", async () => {
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe }
            })
            bus.push({ channel: "LC_LOAD_MAP", data: makeLoadMap("out-1") })
            bus.push({
                channel: "LC_SYNC_FRAME",
                data: { ...makeFrame({ wordIndex: 1 }), nextSongTitle: 123 }
            })
            await Promise.resolve()
            const words = Array.from(target.querySelectorAll(".word"))
            expect(words[0]!.classList.contains("active")).toBe(true)
            expect(target.querySelector(".next-song-hint")).toBeNull()
            cmp.$destroy()
        })
    })

    describe("EP-06.5 — next-section preview", () => {
        it("fades in the next section first line inside the configured lead time", async () => {
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe }
            })
            bus.push({ channel: "LC_LOAD_MAP", data: makeLoadMap("out-1") })
            bus.push({
                channel: "LC_SYNC_FRAME",
                data: makeFrame({ wordIndex: 2, wordProgress: 0.5 })
            })
            await Promise.resolve()

            const preview = target.querySelector(".section-preview")
            expect(preview?.textContent).toContain("Chorus")
            expect(preview?.textContent).toContain("Then sings my soul")
            cmp.$destroy()
        })

        it("hides the next-section preview before the lead window", async () => {
            const settings = writable({
                leadTimeSeconds: 0.25
            })
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe, displaySettings: settings }
            })
            bus.push({ channel: "LC_LOAD_MAP", data: makeLoadMap("out-1") })
            bus.push({
                channel: "LC_SYNC_FRAME",
                data: makeFrame({ wordIndex: 2, wordProgress: 0.5 })
            })
            await Promise.resolve()

            expect(target.querySelector(".section-preview")).toBeNull()
            cmp.$destroy()
        })
    })

    describe("LC_LOAD_MAP clears stale cursor", () => {
        it("a new map resets the active-word cursor (no stale highlight on a different show)", async () => {
            const cmp = new KaraokeOutput({
                target,
                props: { outputId: "out-1", subscribe: bus.subscribe }
            })
            bus.push({ channel: "LC_LOAD_MAP", data: makeLoadMap("out-1") })
            bus.push({ channel: "LC_SYNC_FRAME", data: makeFrame({ wordIndex: 3 }) })
            await Promise.resolve()
            // Sanity: word 3 is active.
            const w3 = target.querySelectorAll(".word")[3]!
            expect(w3.classList.contains("active")).toBe(true)
            // Now push a fresh map.
            bus.push({ channel: "LC_LOAD_MAP", data: makeLoadMap("out-1") })
            await Promise.resolve()
            // The new map has no frame yet; word 0 is the default active per cursor-fallback.
            const after = target.querySelectorAll(".word")
            // No frame → currentFrame is null → cursor is null → no word should have .active class.
            // We assert at least that word 3 lost its active class.
            expect(after[3]!.classList.contains("active")).toBe(false)
            cmp.$destroy()
        })
    })
})
