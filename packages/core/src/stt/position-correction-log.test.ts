import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { PositionCorrectionDecision } from "./live-position-corrector.js"
import { appendPositionCorrectionLog, createPositionCorrectionLogEntry, positionCorrectionLogPath, prunePositionCorrectionLogs, type PositionCorrectionLogEntry } from "./position-correction-log.js"
import type { SttTranscript } from "./rolling-window-transcriber.js"
import type { TimingMap } from "../types/timing-map.js"

let dir: string

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lyricue-position-log-"))
})

afterEach(async () => {
    await import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true }))
})

function entry(timestamp: string): PositionCorrectionLogEntry {
    return {
        timestamp,
        showId: "show-1",
        recognizedText: "how great is",
        confidence: 0.92,
        from: { sectionId: "v1", slideIndex: 0, wordIndex: 2, refMs: 1_000 },
        to: { sectionId: "c1", slideIndex: 1, wordIndex: 0, refMs: 3_000 }
    }
}

function map(showId = "show-42"): TimingMap {
    return {
        $schema: "lyricue-timing-v1",
        showId,
        learnedFrom: { method: "studio", duration: 12, learnedAt: "2026-06-06T00:00:00.000Z" },
        bpm: 120,
        language: "en",
        sections: [],
        metadata: { schemaVersion: "1", version: "1.0.0" }
    }
}

function decision(fromSectionId: string | null = "v1"): PositionCorrectionDecision {
    return {
        event: { kind: "positionCorrection", targetRefMs: 3_000, wallTime: 9_000 },
        match: { phrase: ["how", "great", "is"], sectionId: "c1", slideIndex: 1, wordIndex: 0, refMs: 3_000, confidence: 0.92, globalWordOrdinal: 6, recognizedWords: ["how", "great", "is"] },
        from: { sectionId: fromSectionId, slideIndex: 0, wordIndex: 2, refMs: 1_000, globalWordOrdinal: fromSectionId ? 2 : null },
        to: { sectionId: "c1", slideIndex: 1, wordIndex: 0, refMs: 3_000, globalWordOrdinal: 6 }
    }
}

describe("position correction log", () => {
    it("creates a durable log entry from a correction decision and transcript", () => {
        const transcript: SttTranscript = { text: "how great is", confidence: 0.97 }

        expect(createPositionCorrectionLogEntry({ map: map(), decision: decision(), transcript, timestamp: new Date("2026-06-06T12:00:00.000Z") })).toEqual({
            timestamp: "2026-06-06T12:00:00.000Z",
            showId: "show-42",
            recognizedText: "how great is",
            confidence: 0.97,
            from: { sectionId: "v1", slideIndex: 0, wordIndex: 2, refMs: 1_000 },
            to: { sectionId: "c1", slideIndex: 1, wordIndex: 0, refMs: 3_000 }
        })
    })

    it("coerces invalid transcript confidence to a safe log value", () => {
        expect(createPositionCorrectionLogEntry({ map: map(), decision: decision(null), transcript: { text: "how great is", confidence: Number.NaN }, timestamp: new Date("2026-06-06T12:00:00.000Z") }).confidence).toBe(0)
        expect(createPositionCorrectionLogEntry({ map: map(), decision: decision(null), transcript: { text: "how great is", confidence: 2 }, timestamp: new Date("2026-06-06T12:00:00.000Z") }).confidence).toBe(1)
    })

    it("appends JSONL entries to the dated positions log", async () => {
        const filePath = await appendPositionCorrectionLog({ logsDir: dir, entry: entry("2026-06-06T12:00:00.000Z") })
        await appendPositionCorrectionLog({ logsDir: dir, entry: entry("2026-06-06T12:00:01.000Z") })

        expect(filePath).toBe(positionCorrectionLogPath(dir, new Date("2026-06-06T12:00:00.000Z")))
        const lines = (await readFile(filePath, "utf8")).trim().split("\n")
        expect(lines).toHaveLength(2)
        expect(JSON.parse(lines[0]!).recognizedText).toBe("how great is")
    })

    it("prunes only dated position logs older than retention", async () => {
        const oldFile = join(dir, "positions-2026-05-01.jsonl")
        const keptFile = join(dir, "positions-2026-05-20.jsonl")
        const unrelatedFile = join(dir, "operator.log")
        await writeFile(oldFile, "{}\n")
        await writeFile(keptFile, "{}\n")
        await writeFile(unrelatedFile, "keep")

        const removed = await prunePositionCorrectionLogs({
            logsDir: dir,
            now: new Date("2026-06-06T12:00:00.000Z"),
            retentionDays: 30
        })

        expect(removed).toEqual([oldFile])
        await expect(stat(oldFile)).rejects.toThrow()
        await expect(stat(keptFile)).resolves.toBeTruthy()
        await expect(stat(unrelatedFile)).resolves.toBeTruthy()
    })
})
