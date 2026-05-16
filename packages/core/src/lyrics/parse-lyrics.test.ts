import { describe, expect, it } from "vitest"
import { parseLyrics, parseLyricsFileText } from "./parse-lyrics.js"

describe("parseLyrics", () => {
    it("detects bracketed CCLI-style section markers", () => {
        const parsed = parseLyrics("[Verse 1]\nAmazing grace\nHow sweet the sound\n\n[Chorus]\nI once was lost")
        expect(parsed.sections.map((s) => [s.label, s.type, s.text])).toEqual([
            ["Verse 1", "verse", "Amazing grace\nHow sweet the sound"],
            ["Chorus", "chorus", "I once was lost"]
        ])
    })

    it("detects colon section markers", () => {
        const parsed = parseLyrics("Verse 1:\nLine one\nLine two\n\nBridge:\nLift it up")
        expect(parsed.sections.map((s) => s.label)).toEqual(["Verse 1", "Bridge"])
    })

    it("detects numbered plain-text blocks", () => {
        const parsed = parseLyrics("1. First verse line\ncontinues here\n\n2. Second verse line")
        expect(parsed.sections.map((s) => s.label)).toEqual(["Verse 1", "Verse 2"])
        expect(parsed.sections[0]!.text).toBe("First verse line\ncontinues here")
    })

    it("falls back to blank-line separated sections for raw WhatsApp text", () => {
        const parsed = parseLyrics("Line one\nLine two\n\nChorus line one\nChorus line two")
        expect(parsed.sections.map((s) => s.label)).toEqual(["Section 1", "Section 2"])
        expect(parsed.warnings).toContain("No explicit section markers found; split on blank lines.")
    })

    it("normalizes ChordPro section directives and strips chords", () => {
        const parsed = parseLyrics("{title: Build My Life}\n{start_of_verse: Verse 1}\n[G]Worthy of every song\n{end_of_verse}\n{soc}\n[C]Holy there is no one\n{eoc}")
        expect(parsed.title).toBe("Build My Life")
        expect(parsed.sections.map((s) => [s.label, s.type, s.text])).toEqual([
            ["Verse 1", "verse", "Worthy of every song"],
            ["Chorus", "chorus", "Holy there is no one"]
        ])
    })
})

describe("parseLyricsFileText", () => {
    it("passes txt files through section detection", () => {
        expect(parseLyricsFileText("song.txt", "[Chorus]\nSing").sections[0]!.label).toBe("Chorus")
    })

    it("extracts OpenSong lyrics text before section detection", () => {
        const parsed = parseLyricsFileText("song.opensong", "<song><title>Way Maker</title><lyrics>[V1]\nYou are here\n\n[C]\nWay maker</lyrics></song>")
        expect(parsed.title).toBe("Way Maker")
        expect(parsed.sections.map((s) => s.label)).toEqual(["Verse 1", "Chorus"])
    })

    it("extracts OpenLyrics verses before section detection", () => {
        const xml = '<song><properties><titles><title>King of Kings</title></titles></properties><lyrics><verse name="v1"><lines>Praise forever</lines></verse><verse name="c"><lines>To the King</lines></verse></lyrics></song>'
        const parsed = parseLyricsFileText("song.xml", xml)
        expect(parsed.title).toBe("King of Kings")
        expect(parsed.sections.map((s) => [s.label, s.text])).toEqual([
            ["Verse 1", "Praise forever"],
            ["Chorus", "To the King"]
        ])
    })

    it("accepts chordpro file extensions", () => {
        expect(parseLyricsFileText("song.chordpro", "{soc}\n[C]Sing\n{eoc}").sections[0]!.label).toBe("Chorus")
    })
})
