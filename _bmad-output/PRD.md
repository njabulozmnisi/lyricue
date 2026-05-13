# Product Requirements Document: WorshipSync

**Version:** 1.0 DRAFT
**Phase:** BMAD Phase 2 — Planning
**Agent:** PM Agent
**Date:** 2026-05-12
**Input Dependency:** `product-brief.md` (Phase 1)

---

## 1. Purpose & Scope

This document defines the functional and non-functional requirements for WorshipSync — an AI-powered lyric synchronization extension for FreeShow that automates worship lyric advancement with word-level karaoke-style highlighting.

**In scope (MVP):** Song learning pipeline, karaoke renderer, live tempo sync, STT position correction, manual override & graceful degradation.

**Out of scope (MVP):** Rehearsal learning, arrangement builder, multilingual lyrics, chord chart sync, community song library, companion phone view, auto-subtitles. These are documented in [Section 9: Post-MVP Roadmap](#9-post-mvp-roadmap) for continuity.

---

## 2. User Personas

### P1: Thabo — Volunteer Tech Operator
- **Context:** Runs lyrics at a 200-person church in Pretoria every Sunday. Not a developer. Uses FreeShow on a Windows laptop connected to a projector.
- **Pain:** Misses cues when the worship leader deviates from the printed order. Gets blamed when slides are late.
- **Goal:** A system that handles slide timing so he can focus on other AV tasks (sound, livestream).
- **Tech comfort:** Can install software, follow setup guides, but won't touch config files or terminal commands.

### P2: Nomsa — Worship Leader
- **Context:** Leads worship at a multilingual church in Johannesburg. Sometimes repeats choruses, extends bridges for prayer, or changes the setlist moments before service.
- **Pain:** Feels constrained by the slide operator's ability to keep up. Avoids spontaneity because she knows the slides will fall behind.
- **Goal:** Lead worship freely, trusting that the lyrics will follow her.
- **Tech comfort:** Uses her phone and basic apps. Will not interact with the sync system directly during worship.

### P3: Sipho — Church IT / AV Lead
- **Context:** Oversees all technology at a mid-size church. Evaluates tools, manages the volunteer tech team.
- **Pain:** Hard to find and retain skilled slide operators. Training new volunteers takes weeks.
- **Goal:** A reliable system that reduces the skill floor for operating lyrics during worship.
- **Tech comfort:** Comfortable with technical setup, config, troubleshooting. Will manage song learning and system configuration.

---

## 3. User Journeys

### UJ1: Learning a New Song (Pre-Service)

**Actor:** Sipho (AV Lead)
**Trigger:** Worship leader adds a new song to next Sunday's setlist.

1. Sipho opens FreeShow and navigates to the song library.
2. He creates a new song entry (or selects an existing one) and enters/pastes the lyrics, structured into sections (verse 1, chorus, verse 2, etc.).
3. He clicks **"Learn Song"** and is prompted to provide a reference audio file (MP3/WAV) — either from local disk or by pasting a URL.
4. The system displays a progress indicator: "Isolating vocals… Aligning lyrics… Detecting tempo…"
5. Processing completes in under 5 minutes. The system displays a **timing preview**: the lyrics scroll with word-level highlights synced to the reference audio so Sipho can verify accuracy.
6. Sipho spots that the bridge section was mis-aligned (two words swapped). He clicks the affected words and manually adjusts the timing boundaries via drag handles on a waveform-style timeline.
7. He saves. The song now has a timing map stored alongside the lyrics.

**Acceptance Criteria:**
- AC1.1: System accepts MP3, WAV, FLAC, and OGG audio files ≤50MB.
- AC1.2: Processing completes within 5 minutes for a typical 5-minute song on consumer hardware (4-core CPU, 8GB RAM, no GPU).
- AC1.3: Timing preview plays back with word-level highlighting synced to the reference audio.
- AC1.4: Individual word timing boundaries are manually adjustable via UI.
- AC1.5: Timing map persists across application restarts.
- AC1.6: If processing fails (corrupt audio, unrecognizable vocals), the system displays a clear error message and the song remains usable in traditional (manual) slide mode.

### UJ2: Running Worship with Auto-Sync (Live Service)

**Actor:** Thabo (Tech Operator)
**Trigger:** Worship service begins.

1. Thabo opens the Sunday setlist in FreeShow. Songs with learned timing maps show a **sync icon** (🎵) indicating auto-advance is available.
2. He selects the first song. The output display shows the first section's lyrics.
3. He connects the audio input (selects "Sound Desk Line-In" or "Microphone" from an audio source dropdown).
4. The worship leader begins singing. Thabo clicks **"Start Sync"** (or presses a keyboard shortcut).
5. The system detects the tempo, locks onto the song position, and begins word-by-word highlighting on the projector output.
6. The congregation sees each word highlight as it should be sung, with the next line fading in below.
7. Mid-song, the worship leader repeats the chorus unexpectedly. The system detects chorus lyrics via STT and snaps back to the chorus slide with correct word highlighting.
8. The worship leader pauses singing and begins praying. The system detects the silence/speech shift and holds the current display (does not advance).
9. The worship leader resumes singing the bridge. The system picks up from the bridge and continues.
10. The song ends. The system auto-transitions to the next song in the setlist and waits for singing to begin.

**Acceptance Criteria:**
- AC2.1: Sync icon visible on songs with learned timing data.
- AC2.2: Audio input source is selectable from available system audio devices.
- AC2.3: Start Sync is triggerable via UI button and keyboard shortcut (configurable).
- AC2.4: Word highlighting begins within 5 seconds of the worship leader starting to sing.
- AC2.5: Word highlight timing is accurate within ±300ms of actual singing for ≥85% of words.
- AC2.6: When the worship leader repeats a section, the system correctly repositions within 5 seconds.
- AC2.7: When singing stops (prayer/speaking), the system holds the current display without advancing.
- AC2.8: When singing resumes, the system re-engages sync within 5 seconds.
- AC2.9: Transition between songs in the setlist is seamless — next song loads automatically.

### UJ3: Manual Override During Live Sync

**Actor:** Thabo (Tech Operator)
**Trigger:** The auto-sync system is running but behaves incorrectly or the worship leader does something completely unexpected.

1. During live sync, the system advances to verse 2 but the worship leader is actually singing the chorus again.
2. Thabo presses the **"Previous Section"** shortcut (e.g., Left Arrow).
3. The system immediately jumps back to the chorus, pauses auto-advance for 3 seconds (debounce), then resumes auto-sync from the new position.
4. Alternatively, Thabo presses **"Manual Mode"** (e.g., Escape). Auto-sync disengages entirely and he controls slides manually as in traditional FreeShow.
5. He can re-engage auto-sync at any time by pressing the shortcut again.

**Acceptance Criteria:**
- AC3.1: Manual advance/reverse responds within 200ms of keypress.
- AC3.2: After manual intervention, auto-sync resumes from the new position after a configurable debounce period (default 3s).
- AC3.3: Manual Mode fully disengages auto-sync; all standard FreeShow slide controls work normally.
- AC3.4: Re-engaging auto-sync from Manual Mode attempts to detect current song position before resuming.
- AC3.5: The current mode (Auto / Timer / Manual) is always visible on the operator's screen.

### UJ4: Configuring Display Preferences

**Actor:** Sipho (AV Lead)
**Trigger:** Initial setup or adjusting for congregation feedback.

1. Sipho opens WorshipSync settings.
2. He configures the **display mode**: Full Karaoke (word-by-word), Section Advance (slide-by-slide auto-advance, no word highlighting), or Traditional (manual only).
3. He sets the **lead time** — how many seconds before a section change the next slide appears (default: 2 seconds).
4. He customizes **highlight style**: color, animation type (sweep, glow, bold), font size.
5. He sets the **held note behavior**: pulse, glow, or static highlight.
6. He saves preferences. They apply globally and persist across sessions.

**Acceptance Criteria:**
- AC4.1: Three display modes available: Full Karaoke, Section Advance, Traditional.
- AC4.2: Lead time is configurable from 0–5 seconds in 0.5s increments.
- AC4.3: Highlight color is selectable from a palette or custom hex input.
- AC4.4: Animation type is selectable: sweep, glow, bold.
- AC4.5: Settings persist across application restarts.
- AC4.6: Changing display mode mid-service takes effect immediately on the output display.

### UJ5: Sourcing Lyrics for a New Song

**Actor:** Sipho (AV Lead)
**Trigger:** Worship leader sends a WhatsApp message: "We're doing 'Build My Life' this Sunday" — Sipho doesn't have the lyrics.

1. Sipho opens FreeShow and clicks **New Show**.
2. He types "Build My Life" and clicks **Search Lyrics** (FreeShow's existing web search feature).
3. The search returns results from free online lyrics sources. He selects the correct one.
4. The lyrics are populated into the editor, auto-split into sections: `[Verse 1]`, `[Chorus]`, `[Verse 2]`, `[Bridge]`.
5. Sipho reviews the sections — the system detected them correctly. He tweaks one label from "Verse 3" to "Bridge 2".
6. He saves the show. A **"Learn Song"** button appears since the lyrics are now in place.
7. He attaches a reference audio file and proceeds through the learning pipeline (UJ1 continues from step 4).

**Alternatively**, the worship leader sends lyrics as a Word document or copied text in WhatsApp:

1. Sipho opens FreeShow, clicks **New Show → Quick Lyrics**.
2. He pastes the text. The system auto-detects section markers (`[Verse]`, blank line separators, or numbered patterns).
3. He reviews, adjusts, saves, and proceeds to learn the song.

**Acceptance Criteria:**
- AC5.1: FreeShow's existing lyrics web search is accessible from within the WorshipSync song learning workflow.
- AC5.2: Pasted plain text is auto-split into sections using bracket markers, blank lines, or common patterns.
- AC5.3: Imported .txt, .docx, or .pdf files with lyrics are parsed and section markers detected.
- AC5.4: The operator can edit section labels and text before proceeding to song learning.
- AC5.5: Songs imported via any method (web search, paste, file import, ProPresenter/EasyWorship import) are eligible for timing map learning.

### UJ6: Running a Multi-Song Worship Set

**Actor:** Thabo (Tech Operator)
**Trigger:** Sunday service worship set has 4 songs in sequence.

1. Sipho (AV Lead) created the Sunday Project in FreeShow during the week, ordering 4 songs: "Way Maker" → "Good Good Father" → "Build My Life" → "Great Are You Lord". All 4 have been learned with timing maps.
2. Thabo opens the Project. The WorshipSync control panel shows the setlist with sync status icons (all green — learned).
3. He connects the audio input and clicks **Start Sync** on the first song, "Way Maker".
4. The worship leader begins singing. Word-level highlighting engages on "Way Maker".
5. "Way Maker" reaches its final chorus. The operator's screen shows **"Next: Good Good Father"**.
6. The worship leader finishes. The band plays a brief transition. The system detects silence in the vocal channel and after 5 seconds, automatically advances to "Good Good Father", displaying the first verse lyrics in a "waiting" state.
7. The worship leader begins "Good Good Father". The system detects singing, locks onto the tempo, and word highlighting begins — no manual intervention from Thabo.
8. This continues through all 4 songs. Between songs 3 and 4, the worship leader pauses for a spoken prayer. The system holds, showing the first section of "Great Are You Lord" without engaging sync until singing resumes.
9. After the final song, Thabo clicks **Stop Sync**. The output returns to FreeShow's normal state.

**Acceptance Criteria:**
- AC6.1: The setlist panel shows all songs in the Project with their sync status (learned/not learned) and current position.
- AC6.2: Auto-advance between songs occurs when singing ends and silence is detected for a configurable period.
- AC6.3: The "waiting for start" state displays the next song's first section without word highlighting.
- AC6.4: Sync engages automatically when singing is detected on the new song.
- AC6.5: Thabo can manually jump to any song in the setlist at any time.
- AC6.6: Non-learned items in the setlist (e.g., scripture readings) fall through to standard FreeShow manual control.
- AC6.7: The "Next up" indicator appears on the operator screen during the final section of each song.

### UJ7: Learning Songs from Thursday Rehearsal

**Actor:** Sipho (AV Lead)
**Trigger:** Thursday night rehearsal — the worship team is running through Sunday's setlist.

1. Sipho opens the Sunday Project in FreeShow. The setlist has 4 songs, all with lyrics entered but none yet learned.
2. He clicks **"Rehearsal Mode"** in the WorshipSync panel. The system prompts him to select the audio input (sound desk line-in).
3. He clicks **"Start Rehearsal"**. The system begins listening and shows a recording indicator.
4. The worship team plays through "Way Maker". Sipho doesn't need to press anything — the system records continuously.
5. They finish "Way Maker", chat for 30 seconds, then start "Good Good Father". The system is still recording.
6. They play through all 4 songs with natural breaks between them.
7. Sipho clicks **"End Rehearsal"**. The system shows a progress screen: "Segmenting songs... Isolating vocals... Aligning lyrics..."
8. The system uses silence detection and lyric matching to split the recording into 4 segments, one per song.
9. A **Rehearsal Summary** appears: "Way Maker ✅ learned (72 BPM), Good Good Father ✅ learned (68 BPM), Build My Life ✅ learned (71 BPM), Great Are You Lord ⚠️ partial — bridge lyrics didn't match, needs review."
10. Sipho clicks into "Great Are You Lord" to review and manually adjust the bridge alignment. The other 3 songs are ready to go.
11. On Sunday, the sync engine uses the rehearsal-learned timing data — reflecting the team's actual tempo and arrangement.

**Acceptance Criteria:**
- AC7.1: Rehearsal mode records continuously from the selected audio input.
- AC7.2: The system segments a multi-song recording into individual songs using silence gaps and lyric matching.
- AC7.3: Each segmented song is processed through the full learning pipeline (Demucs + WhisperX).
- AC7.4: A rehearsal summary shows per-song status: learned, partial, or failed.
- AC7.5: Partially learned songs are flagged for manual review without blocking other songs.
- AC7.6: Rehearsal-learned timing maps replace or coexist with studio-learned maps (operator chooses).

### UJ8: Building a Custom Song Arrangement

**Actor:** Nomsa (Worship Leader) via Sipho (AV Lead)
**Trigger:** Nomsa tells Sipho: "For 'Way Maker' on Sunday, we're doing Verse 1, Chorus, Verse 2, Chorus, Chorus, Bridge, Bridge, Chorus, Outro."

1. Sipho opens "Way Maker" in FreeShow and navigates to the WorshipSync **Arrangement Builder**.
2. The builder shows the available sections as draggable blocks: `Verse 1`, `Verse 2`, `Chorus`, `Bridge`, `Outro`.
3. He drags them into the order Nomsa specified: `V1 → C → V2 → C → C → Br → Br → C → Outro`.
4. The duplicated sections (Chorus ×3, Bridge ×2) each reference the same timing data — no re-learning needed.
5. He saves the arrangement as "Sunday Morning". The original "Default" arrangement remains available.
6. **Alternatively**, Nomsa sends a WhatsApp message: "V1 C V2 C C B B C O". Sipho pastes this into the **Quick Arrangement** field, and the system parses it into the correct section sequence.
7. During live worship, the sync engine follows the custom arrangement, not the original recording order.

**Acceptance Criteria:**
- AC8.1: The arrangement builder displays all available sections as draggable blocks.
- AC8.2: Sections can be duplicated and reordered via drag-and-drop.
- AC8.3: Quick arrangement shorthand (e.g., "V1 C V2 C C B C") is parsed into the correct section sequence.
- AC8.4: Multiple named arrangements can be saved per song.
- AC8.5: The live sync engine follows the selected arrangement's section order.
- AC8.6: The arrangement maps to a FreeShow Layout for slide ordering consistency.

---

## 4. Functional Requirements

### FR1: Song Learning Pipeline

| ID | Requirement | Priority |
|---|---|---|
| FR1.1 | Accept audio file input (MP3, WAV, FLAC, OGG) via file picker dialog | Must |
| FR1.2 | Run Demucs vocal isolation on the input audio, producing an isolated vocal track | Must |
| FR1.3 | Run WhisperX forced alignment on the isolated vocal track against the song lyrics, producing word-level timestamps (start time, end time per word) | Must |
| FR1.4 | Detect BPM from the reference audio and store alongside the timing map | Must |
| FR1.5 | Auto-detect section boundaries (verse, chorus, bridge) using lyric repetition analysis and audio energy contour | Should |
| FR1.6 | Allow manual section boundary definition/correction if auto-detection is inaccurate | Must |
| FR1.7 | Store timing map as structured JSON linked to the FreeShow song entry | Must |
| FR1.8 | Display processing progress with stage indicators (isolating, aligning, detecting) | Must |
| FR1.9 | Provide a timing preview player that plays reference audio with word-level highlighting | Must |
| FR1.10 | Allow manual timing adjustment for individual words via drag-handle UI on a waveform/timeline view | Should |
| FR1.11 | Support re-learning a song with a different reference recording (overwrite or version timing maps) | Should |
| FR1.12 | Validate lyrics text is present and non-empty before starting pipeline | Must |
| FR1.13 | Handle pipeline failures gracefully — display error, preserve song in manual mode | Must |

### FR2: Word-Level Karaoke Renderer

| ID | Requirement | Priority |
|---|---|---|
| FR2.1 | Render lyrics on the output display with per-word highlighting driven by the timing map | Must |
| FR2.2 | Active word displays with configurable visual treatment (color change, scale, sweep animation) | Must |
| FR2.3 | Sweep animation fills the word from left to right over the word's duration (not binary on/off) | Should |
| FR2.4 | Sung (past) words reduce opacity to visually indicate progression | Must |
| FR2.5 | Next line or section is visible below the current line at reduced opacity (read-ahead) | Must |
| FR2.6 | Held/sustained notes display a pulsing glow animation for the duration of the hold | Should |
| FR2.7 | Line transitions (moving to a new line) animate smoothly (scroll or fade, not jump) | Must |
| FR2.8 | Section transitions (verse → chorus) animate with a configurable lead time before the new section starts | Must |
| FR2.9 | Font size, font family, and line spacing are configurable | Must |
| FR2.10 | Background is configurable (solid color, gradient, or image) consistent with FreeShow's existing background system | Should |
| FR2.11 | Renderer adapts to output resolution (1080p, 720p, 4K, ultrawide) | Must |

### FR3: Live Tempo Sync Engine

| ID | Requirement | Priority |
|---|---|---|
| FR3.1 | Capture audio from a selectable system audio input device (mic, line-in, virtual device) | Must |
| FR3.2 | Perform real-time beat detection on the incoming audio stream | Must |
| FR3.3 | Estimate rolling live BPM from detected beats (windowed average, not instantaneous) | Must |
| FR3.4 | Calculate tempo ratio (live BPM / reference BPM) and scale all word timestamps proportionally | Must |
| FR3.5 | Apply a configurable lead-time offset so the display runs ahead of the actual audio position | Must |
| FR3.6 | Provide a "Start Sync" trigger (button + keyboard shortcut) that establishes the song start time | Must |
| FR3.7 | Continuously adjust the playback cursor based on live tempo drift (not just initial BPM snap) | Should |
| FR3.8 | Smoothly handle tempo changes (accelerando, ritardando) without visual stutter | Should |
| FR3.9 | Detect silence or non-musical audio (speech, ambient noise) and pause advance when detected | Must |
| FR3.10 | Resume advance when singing/music is detected again | Must |
| FR3.11 | Handle song transitions in a setlist — auto-load next song's timing map when current song ends or operator advances | Must |

### FR4: STT Position Correction

| ID | Requirement | Priority |
|---|---|---|
| FR4.1 | Run local STT model (Whisper.cpp via Node.js addon) in the background during live sync — fully offline, no cloud dependency | Must |
| FR4.2 | Continuously compare recognized words against the full song lyrics using fuzzy string matching | Must |
| FR4.3 | If recognized text matches a section that is different from the current predicted position, trigger a position correction | Must |
| FR4.4 | Position correction transitions smoothly (animated jump, not visual glitch) | Should |
| FR4.5 | Detect repeated sections (e.g., chorus sung again after bridge) and correctly reposition | Must |
| FR4.6 | Debounce position corrections — do not jump on a single recognized word; require a phrase-level match (≥3 consecutive words) | Must |
| FR4.7 | Log position corrections for post-service review (debugging/tuning) | Should |

### FR5: Manual Override & Graceful Degradation

| ID | Requirement | Priority |
|---|---|---|
| FR5.1 | Provide keyboard shortcuts for: next section, previous section, toggle manual mode, re-engage auto-sync | Must |
| FR5.2 | Shortcuts are configurable in settings | Should |
| FR5.3 | After manual intervention, auto-sync pauses for a configurable debounce period before resuming | Must |
| FR5.4 | Support three control tiers: Full AI Sync → Timer-Based Advance → Manual Control | Must |
| FR5.5 | Fallback from AI Sync to Timer-Based occurs automatically when beat detection confidence drops below threshold for >10 seconds | Should |
| FR5.6 | Fallback from Timer-Based to Manual occurs automatically if timer drift exceeds a configurable threshold | Should |
| FR5.7 | Current control tier is always displayed on the operator screen | Must |
| FR5.8 | Operator can force any tier manually regardless of automatic fallback logic | Must |
| FR5.9 | In Manual Mode, all standard FreeShow slide navigation controls function normally | Must |

### FR6: Lyrics Sourcing & Import

*FreeShow already provides a "Web Search for Lyrics" feature and a "Quick Lyrics" paste mode when creating a new show. WorshipSync extends this by integrating lyrics sourcing directly into the song learning workflow.*

| ID | Requirement | Priority |
|---|---|---|
| FR6.1 | Integrate with FreeShow's existing lyrics web search — when creating a song, the operator can search for lyrics online, and the result is pre-populated into the show's text items | Must |
| FR6.2 | Support pasting plain text lyrics directly into the song learning workflow (bypassing FreeShow's show editor if the operator just wants to learn a song quickly) | Must |
| FR6.3 | Support importing lyrics from common file formats: plain text (.txt), Word (.docx), PDF, and common church presentation formats (OpenSong XML, OpenLyrics XML, ChordPro) | Should |
| FR6.4 | Auto-detect section markers in imported/pasted text — lines like `[Verse]`, `[Chorus]`, `[Bridge]`, or common patterns (blank line separators, numbered verses) — and map them to FreeShow slide groups | Must |
| FR6.5 | When lyrics are sourced from any method, present a review screen where the operator can verify sections are correctly split before proceeding to audio learning | Must |
| FR6.6 | Support a "Search & Learn" shortcut workflow: search lyrics online → review/edit → attach reference audio → learn timing → ready to use, all from one wizard-style flow | Should |
| FR6.7 | Preserve any existing FreeShow import pathways (ProPresenter, EasyWorship, OpenLP, Planning Center) — WorshipSync must not break these; imported songs simply gain a "Learn Song" option | Must |

### FR7: Service Setlist & Continuous Playback

*FreeShow's "Projects" already function as ordered setlists, and spacebar at the end of a show advances to the next item. WorshipSync extends this with auto-sync-aware transitions between songs.*

| ID | Requirement | Priority |
|---|---|---|
| FR7.1 | Read the current FreeShow Project as the service setlist — the ordered list of shows is the song sequence | Must |
| FR7.2 | Display the full setlist in the operator's WorshipSync control panel, showing: song name, sync status (learned/not learned), current position indicator | Must |
| FR7.3 | When the current song ends (final section completed or operator manually advances), automatically load the next song's timing map and enter a "waiting for start" state | Must |
| FR7.4 | In the "waiting for start" state, display the first section of the next song on the output (so the congregation can see what's coming) but do not begin word highlighting until singing is detected or the operator triggers Start Sync | Must |
| FR7.5 | Detect the transition between songs: when the sync engine detects silence or non-singing for a configurable duration after the final section, auto-advance to the next song | Should |
| FR7.6 | Support songs in the setlist that do NOT have timing maps (e.g., scripture readings, announcements) — these pass through to FreeShow's normal manual slide control | Must |
| FR7.7 | Allow the operator to jump to any song in the setlist at any time (click in setlist panel or keyboard shortcut) | Must |
| FR7.8 | Show a "next up" indicator on the operator screen during the current song's final section (e.g., "Next: How Great Is Our God") | Should |
| FR7.9 | Support re-ordering the setlist from the WorshipSync control panel without leaving the live view (drag-and-drop or move up/down buttons) — syncs back to FreeShow's Project order | Should |

### FR8: Rehearsal Learning Mode

*The worship team rehearses on Thursday night. The system listens, learns their specific arrangement, tempo, and transitions. On Sunday, the timing data reflects how THIS team plays THIS song — not a studio recording.*

| ID | Requirement | Priority |
|---|---|---|
| FR8.1 | Provide a "Rehearsal Mode" that captures live audio input and records it as a reference track for song learning | Must |
| FR8.2 | Rehearsal mode is activated per-song from the setlist: the operator selects a song, clicks "Learn from Rehearsal", and the system begins recording when the team starts playing | Must |
| FR8.3 | The operator marks the start and end of the rehearsal take (or the system auto-detects silence boundaries) | Must |
| FR8.4 | After the rehearsal take is captured, run the same song learning pipeline (Demucs → WhisperX) on the recorded audio against the song's existing lyrics | Must |
| FR8.5 | If a timing map already exists for the song (e.g., from a studio recording), offer to replace it or keep both versions ("Studio" vs. "Rehearsal") | Should |
| FR8.6 | Support learning an entire setlist in one rehearsal session: the operator starts rehearsal mode, the team plays through all songs, and the system segments the recording into individual songs based on silence gaps and lyric matching | Should |
| FR8.7 | Display a "Rehearsal Summary" after the session showing which songs were successfully learned, which need re-takes, and detected BPM per song | Should |
| FR8.8 | Rehearsal recordings are stored locally and can be deleted after learning to save disk space | Must |
| FR8.9 | If the team plays a song differently from the expected lyrics (extra ad-libs, skipped sections), the system still aligns what it can and flags unmatched segments for manual review | Should |

### FR9: Arrangement Builder

*Worship leaders often sing songs with a different section order than the original recording. The arrangement builder lets them define their specific sequence without re-learning the song.*

| ID | Requirement | Priority |
|---|---|---|
| FR9.1 | Provide a visual arrangement editor where sections (Verse 1, Chorus, Bridge, etc.) are displayed as draggable blocks | Must |
| FR9.2 | The available sections are derived from the song's learned timing map and/or FreeShow slide groups | Must |
| FR9.3 | The operator or worship leader can reorder sections by dragging them into the desired sequence | Must |
| FR9.4 | Sections can be duplicated (e.g., Chorus appears 3 times) — each instance uses the same timing data | Must |
| FR9.5 | Sections can be removed from the arrangement (e.g., skip Verse 3) without deleting the underlying timing data | Must |
| FR9.6 | The arrangement is saved as part of the song's timing map, linked to a FreeShow Layout — multiple arrangements per song are supported (e.g., "Sunday Morning" vs. "Evening Service") | Should |
| FR9.7 | The arrangement maps directly to FreeShow's existing Layout concept — reordering sections in WorshipSync updates the corresponding Layout's slide order | Must |
| FR9.8 | The live sync engine follows the defined arrangement sequence, not the default section order from the reference recording | Must |
| FR9.9 | Provide a "quick arrangement" mode: a simple text-based shorthand (e.g., "V1 C V2 C C B C") that the worship leader can type or send via message, which the system parses into the arrangement | Should |

### FR10: Multilingual Parallel Lyrics

*South Africa has 11 official languages, and many churches sing songs in multiple languages. The system displays synchronized lyrics in two (or more) languages simultaneously.*

| ID | Requirement | Priority |
|---|---|---|
| FR10.1 | Support adding one or more translation tracks to any song — each translation is a parallel set of lyrics mapped to the same sections | Must |
| FR10.2 | Translations are entered per-section (Verse 1 in Zulu, Chorus in Zulu, etc.) alongside the primary language lyrics | Must |
| FR10.3 | The karaoke renderer displays the primary language lyrics with word-level highlighting AND the translation below (or above, configurable) at reduced size | Must |
| FR10.4 | The translation text advances section-by-section in sync with the primary lyrics but does NOT have word-level highlighting (word counts differ between languages) | Must |
| FR10.5 | Support configuring which language is primary and which is secondary — the operator can swap them per service (e.g., Zulu primary with English secondary for a Zulu-language service) | Should |
| FR10.6 | FreeShow already supports per-textbox `language` fields — WorshipSync should use this mechanism to store translations, maintaining compatibility | Must |
| FR10.7 | The translation display is toggleable — can be turned on/off per service without modifying the song data | Must |
| FR10.8 | Support displaying up to 2 parallel translations simultaneously (e.g., English + Zulu + Sotho) without overcrowding the screen — font sizes auto-adjust based on number of languages shown | Should |

### FR11: Community Song Library

*Once one church learns a song with timing data, that timing map can be shared. Other churches import it and immediately have word-level sync without running the ML pipeline.*

| ID | Requirement | Priority |
|---|---|---|
| FR11.1 | Support exporting a song's timing map as a standalone shareable file (`.wstiming` or similar) that includes: timing data, section labels, BPM, reference metadata (but NOT the audio file) | Must |
| FR11.2 | Support importing a `.wstiming` file and linking it to an existing FreeShow song entry by matching song title/lyrics | Must |
| FR11.3 | Provide an in-app community library browser where churches can search for songs and download timing maps shared by others | Should |
| FR11.4 | When downloading from the community library, the system verifies that the lyrics in the timing map match the local song's lyrics (fuzzy match to handle minor text differences) | Must |
| FR11.5 | If lyrics don't match exactly, show a diff view and let the operator accept, reject, or manually reconcile | Should |
| FR11.6 | Uploaded timing maps include metadata: church name (optional/anonymous), reference recording description, language, arrangement notes | Should |
| FR11.7 | Community library is hosted as a simple public repository (GitHub repo, or a lightweight API) — no user accounts required for browsing/downloading; optional for uploading | Should |
| FR11.8 | Timing maps can be shared peer-to-peer without the community library: export file → send via WhatsApp/email → recipient imports | Must |
| FR11.9 | Versioning: if a song's timing map is updated (re-learned or manually adjusted), the export includes a version number so recipients know if their copy is outdated | Should |

---

## 5. Non-Functional Requirements

### NFR1: Performance

| ID | Requirement | Target |
|---|---|---|
| NFR1.1 | Song learning pipeline processing time | ≤5 minutes for a 5-minute song on 4-core CPU, 8GB RAM |
| NFR1.2 | Audio input latency (mic/line-in to processing) | ≤100ms |
| NFR1.3 | Word highlight update frequency | ≥30fps (≤33ms per frame) |
| NFR1.4 | Beat detection latency | ≤200ms from beat occurrence to detection |
| NFR1.5 | STT recognition latency | ≤1 second from utterance to recognized text |
| NFR1.6 | Manual override response time | ≤200ms from keypress to display change |
| NFR1.7 | Application startup time (with WorshipSync loaded) | ≤10 seconds additional over base FreeShow |
| NFR1.8 | Memory usage during live sync | ≤500MB additional over base FreeShow |

### NFR2: Reliability

| ID | Requirement | Target |
|---|---|---|
| NFR2.1 | System must not crash during live worship | Zero tolerance — graceful degradation to manual mode on any error |
| NFR2.2 | Word highlight accuracy | ≥85% of words within ±300ms |
| NFR2.3 | Section advance accuracy | ≥90% of sections within ±1 second |
| NFR2.4 | Recovery from audio input loss (mic disconnected) | Fall back to timer-based within 3 seconds; alert operator |
| NFR2.5 | Recovery from Python sidecar crash (learning pipeline) | Display error; song remains in manual mode; no app crash |

### NFR3: Compatibility

| ID | Requirement | Target |
|---|---|---|
| NFR3.1 | Target platforms | Windows 10+, macOS 12+, Linux (Ubuntu 22.04+) |
| NFR3.2 | FreeShow version compatibility | Current stable release at time of development + one prior minor |
| NFR3.3 | Audio input compatibility | Any device exposed as a system audio input (ASIO, WASAPI, CoreAudio, PulseAudio/PipeWire) |
| NFR3.4 | Output resolution support | 720p, 1080p, 4K, ultrawide (16:9 and 21:9) |
| NFR3.5 | Python runtime for ML sidecar | Python 3.10+ bundled or user-installed |

### NFR4: Offline Capability

| ID | Requirement | Target |
|---|---|---|
| NFR4.1 | Live sync engine works fully offline | No network calls during live worship |
| NFR4.2 | Song learning pipeline works offline | All ML models bundled locally |
| NFR4.3 | Song library, timing maps, settings stored locally | No cloud dependency |
| NFR4.4 | Optional online features clearly marked | YouTube reference fetch, community library sync |

### NFR5: Usability

| ID | Requirement | Target |
|---|---|---|
| NFR5.1 | Song learning requires no terminal/CLI interaction | GUI-only workflow |
| NFR5.2 | Live sync requires ≤3 operator actions to start (select song, select audio, start sync) | Minimal friction |
| NFR5.3 | First-time setup guide / onboarding wizard | Guided audio input selection, test sync with demo song |
| NFR5.4 | Error messages in plain language, no stack traces | Non-technical operators must understand what went wrong |

### NFR6: Extensibility

| ID | Requirement | Target |
|---|---|---|
| NFR6.1 | Timing map format is documented and versioned | Enable community tooling and sharing |
| NFR6.2 | Renderer is decoupled from sync engine | Support alternative renderers (post-MVP) |
| NFR6.3 | Audio analysis is decoupled from FreeShow UI | Enable headless song learning (CLI) for power users |
| NFR6.4 | Plugin architecture allows post-MVP features without core modifications | Clean API boundaries |

---

## 6. Data Model (Conceptual)

### Song Timing Map Schema

```json
{
  "$schema": "worshipsync-timing-v1",
  "songId": "string — links to FreeShow song entry",
  "learnedFrom": {
    "filename": "good_good_father_hillsong.mp3",
    "duration": 285.4,
    "learnedAt": "2026-05-10T14:30:00Z"
  },
  "bpm": 68,
  "timeSignature": "4/4",
  "sections": [
    {
      "id": "verse1",
      "type": "verse",
      "label": "Verse 1",
      "slideIndex": 0,
      "startTime": 12.34,
      "endTime": 38.50,
      "words": [
        {
          "word": "Oh",
          "start": 12.340,
          "end": 12.780,
          "confidence": 0.95
        },
        {
          "word": "I've",
          "start": 12.800,
          "end": 13.100,
          "confidence": 0.92
        }
      ]
    }
  ],
  "metadata": {
    "demucsModel": "htdemucs",
    "whisperxModel": "small",
    "version": "1.0.0"
  }
}
```

### Configuration Schema

```json
{
  "display": {
    "mode": "karaoke | section | traditional",
    "leadTimeSeconds": 2.0,
    "highlightColor": "#FFCC00",
    "animationType": "sweep | glow | bold",
    "sungWordOpacity": 0.4,
    "fontSize": 48,
    "fontFamily": "Inter",
    "heldNoteAnimation": "pulse | glow | static"
  },
  "sync": {
    "audioInputDeviceId": "string",
    "tempoSmoothingWindow": 8,
    "sttEnabled": true,
    "positionCorrectionMinWords": 3,
    "fallbackTimerEnabled": true,
    "manualOverrideDebounceSeconds": 3.0
  },
  "shortcuts": {
    "startSync": "Space",
    "nextSection": "ArrowRight",
    "prevSection": "ArrowLeft",
    "toggleManual": "Escape",
    "reEngageSync": "Enter"
  }
}
```

---

## 7. Integration Points with FreeShow

| Integration Point | Type | Description |
|---|---|---|
| Song Library | Data extension | Add `timingMap` field to FreeShow's song data model. Songs with timing maps gain sync capability. |
| Slide Output | Renderer extension | New "Karaoke" output renderer alongside FreeShow's existing slide renderer. Selected per-song or globally. |
| Setlist / Show | Workflow integration | WorshipSync reads the current setlist order, pre-loads timing maps, and transitions between songs. |
| Settings | UI extension | New "WorshipSync" settings panel within FreeShow's settings UI. |
| Audio Input | New subsystem | FreeShow currently has no audio input. WorshipSync adds audio capture for beat detection and STT. |
| Keyboard Shortcuts | Extension | Additional shortcuts for sync controls, registered alongside FreeShow's existing shortcut system. |
| Python Sidecar | New subsystem | A bundled Python process for ML workloads (song learning). Communicates with the Electron app via IPC (stdin/stdout JSON or local HTTP). |

---

## 8. MVP Scope Boundary

### In MVP

- Song learning from local audio file + lyrics → timing map
- **Lyrics sourcing: web search (via FreeShow), plain text paste, and file import (.txt, .docx) with auto section detection**
- Word-level karaoke rendering on projector output
- Live tempo sync via beat detection
- STT position correction (background)
- Manual override + graceful degradation (3-tier fallback)
- **Service setlist: read FreeShow Projects as ordered song sequence, auto-transition between songs, "waiting for start" state, setlist panel with sync status**
- **Rehearsal learning mode: capture live rehearsal audio, learn the team's specific arrangement and tempo**
- **Arrangement builder: drag-and-drop section reordering, quick arrangement shorthand, maps to FreeShow Layouts**
- **Multilingual parallel lyrics: synchronized second-language display, toggleable, auto-sizing**
- **Community song library: export/import timing maps as files, peer-to-peer sharing, in-app community browser**
- Basic settings UI (display mode, colors, lead time, shortcuts)
- Timing preview and manual timing adjustment
- Operator mode indicator (Auto / Timer / Manual)

### Explicitly Not in MVP

- Learning from URL (YouTube/Spotify) — requires download tooling, legal considerations
- Musician chord chart sync view
- Companion phone view
- Auto-subtitles for recordings
- Confidence dashboard (simplified version via mode indicator is in MVP)
- Click track generation

---

## 9. Post-MVP Roadmap

| Phase | Features | Value Unlock |
|---|---|---|
| v1.1 | Confidence dashboard (full version with Green/Yellow/Red indicator) | Deeper operator trust and transparency |
| v1.2 | Companion phone view (QR code synced lyrics on personal devices) | Accessibility; back-row and overflow rooms |
| v1.3 | Musician chord chart sync, click track generation | Full-band integration |
| v1.4 | Auto-subtitles for livestream/recording archives | Accessibility at scale |
| v2.0 | URL-based song learning (YouTube), cloud learning option | Convenience; support for low-spec hardware |

---

## 10. Open Questions — RESOLVED

*All technical questions resolved via deep analysis of the FreeShow codebase (ChurchApps/FreeShow on GitHub), official documentation (freeshow.app/docs), and upstream dependency licensing.*

### OQ1: FreeShow Data Model — Extension Support ✅ RESOLVED

**Finding:** FreeShow stores songs as individual `.show` files (JSON) with a well-documented schema. Each show has a `meta` object that explicitly supports custom keys beyond the defaults (title, artist, CCLI, key, etc.). Songs are indexed in a `shows.json` file. The data directory is user-configurable (defaults to Documents folder).

The `.show` format structure:
```
{
  "name": "...",
  "settings": { "activeLayout": "<id>", "template": null },
  "meta": { "title": "", "artist": "", ... /* custom keys allowed */ },
  "slides": {
    "<slide_id>": {
      "group": "Verse",       // section name — maps directly to our sections
      "children": ["<id>"],   // multi-slide groups
      "items": [{
        "type": "text",
        "lines": [{ "text": [{ "value": "Hello World!", "style": "..." }] }]
      }]
    }
  },
  "layouts": {
    "<layout_id>": {
      "name": "Default",
      "slides": [{ "id": "<slide_id>" }]  // ordered arrangement
    }
  }
}
```

**Decision:** Store the timing map as a **sidecar file** (`<show_id>.timing.json`) in a `TimingMaps/` subdirectory alongside the Show files, rather than embedding in the `meta` field. Rationale:
- The timing map is large (word-level timestamps for every word in a song) and would bloat the `.show` file
- Keeps `.show` format backwards-compatible — FreeShow will not break if WorshipSync is removed
- The `meta` field can hold a lightweight pointer: `"worshipsync": { "hasTimingMap": true, "version": "1.0" }`
- FreeShow's existing `layouts` concept (reorderable slide sequences) maps naturally to our arrangement builder (post-MVP)

**Impact on Architecture:** Timing maps are a parallel data layer, linked to shows by ID. The song's `slides[].group` values ("Verse", "Chorus", "Bridge") provide the section labels that map to timing map sections.

### OQ2: FreeShow Renderer Architecture ✅ RESOLVED

**Finding:** FreeShow's output is a **layered rendering system** in Electron BrowserWindows:
- Layer stack (bottom to top): Background → Slide (text) → Overlay → Audio → Timer
- Each slide renders text items with inline CSS (`style`, `align`, `lines[].text[].value` + `lines[].text[].style`)
- Transitions are prioritized: Textbox > Slide > Output Style > Global
- FreeShow already supports multiple output types: standard Output, Stage Display, NDI, Remote/OutputShow
- Each output type is essentially a separate BrowserWindow with its own rendering logic
- Output windows can be independently locked, toggled, and styled

**Decision:** Create a **new output mode** ("Karaoke Output") rather than modifying the existing slide renderer. Rationale:
- FreeShow's architecture already supports multiple parallel output types (standard, stage, NDI)
- A karaoke output reads the same slide data (lyrics text, group names) but renders with word-level highlighting driven by the timing engine
- The standard output continues to work normally as a fallback
- The operator can run both simultaneously: standard output for the projector (if they prefer), karaoke output for a second screen or as the primary
- This avoids touching FreeShow's core rendering code — cleaner integration boundary

**Rendering approach:** The karaoke output receives the current slide's text items, splits the `value` strings into individual words, and wraps each word in a `<span>` driven by the timing engine. CSS custom properties (`--progress`) animate the sweep highlight per word.

### OQ3: Python Sidecar Bundling Strategy ✅ RESOLVED

**Finding:** FreeShow's build process already requires **Python 3.12** and `setuptools` as build dependencies (for native Node.js module compilation). The README explicitly lists Python as a prerequisite. This means Python is already in the development toolchain, though not necessarily required at runtime for end users.

**Decision:** Tiered approach:
- **MVP:** Require Python 3.10+ installed on the system. The song learning pipeline runs as a spawned Python subprocess via Node.js `child_process`. Communication via stdin/stdout JSON-RPC (simplest, no ports, no HTTP server). This is acceptable because song learning is a pre-service activity done by the tech-savvy AV lead (Persona P3: Sipho), not the casual operator.
- **v1.1+:** Bundle the Python pipeline as a **PyInstaller standalone executable** per platform (Windows .exe, macOS .app, Linux binary). This eliminates the Python installation requirement for end users. The executable is ~400–600MB (Demucs + WhisperX + dependencies) — large but acceptable as a one-time download.
- **Future consideration:** Explore ONNX Runtime in Node.js for the forced alignment step (WhisperX's core model can be exported to ONNX). This would eliminate the Python dependency entirely for song learning, though Demucs is harder to port.

### OQ4: Web Speech API in Electron ⚠️ RESOLVED — DESIGN CHANGE REQUIRED

**Finding:** This is the most impactful finding. The Web Speech API (`webkitSpeechRecognition`) **technically works** in Electron's Chromium renderer with the webkit prefix, BUT:
- **It requires an internet connection** — Chrome streams audio to Google's servers for processing. There is no offline mode.
- Google has historically been inconsistent about supporting it in Electron shell environments (the `electron-speech` library was broken when Google shut down access for non-browser Chromium shells)
- Edge uses Azure Cognitive Services (also cloud-dependent)
- **This directly violates our offline-first requirement (NFR4.1)**

**Decision:** **Do NOT use Web Speech API for STT position correction.** Replace with a local STT solution:
- **Primary option:** Run **Whisper.cpp** (C++ port of Whisper) via a Node.js native addon (`whisper-node` or `@nicoder/whisper.node`). This runs entirely offline, is lightweight (~75MB for the `base` model), and provides word-level output.
- **Alternative:** Use the same WhisperX Python sidecar in streaming mode — spawn it alongside the song learning process, feed it live audio chunks, and receive recognized text back via the JSON-RPC channel.
- **Recommended for MVP:** Whisper.cpp via Node.js addon. It keeps the live sync engine in pure JS/Node territory (no Python dependency at runtime), runs offline, and the `base` model is fast enough for real-time position correction (we don't need high accuracy — just phrase-level matching).

**PRD impact:** FR4.1 is updated from "Web Speech API" to "Local STT model (Whisper.cpp)". NFR4.1 (offline live sync) is preserved.

### OQ5: Licensing for ML Dependencies ✅ RESOLVED

**Finding:**

| Dependency | License | GPL-3.0 Compatible | Commercial Use | Notes |
|---|---|---|---|---|
| Demucs (Meta) | MIT | ✅ Yes | ✅ Yes | Fully permissive. No longer actively maintained at facebookresearch; forked to adefossez/demucs |
| WhisperX | BSD-2-Clause | ✅ Yes | ✅ Yes | Permissive with attribution |
| OpenAI Whisper | MIT | ✅ Yes | ✅ Yes | Underlying model |
| Whisper.cpp | MIT | ✅ Yes | ✅ Yes | C++ port, no Python needed |
| wav2vec2 EN model (WAV2VEC2_ASR_BASE_960H) | MIT | ✅ Yes | ✅ Yes | English forced alignment |
| wav2vec2 non-EN models (VOXPOPULI) | CC-BY-NC 4.0 | ⚠️ Non-commercial only | ❌ No | French, German, Spanish, Italian alignment models |
| FreeShow | GPL-3.0 | N/A (host project) | ✅ Yes (FOSS) | Copyleft — derivative works must also be GPL-3.0 |

**Decision:** All core dependencies are MIT/BSD — fully compatible with FreeShow's GPL-3.0 license. The only concern is the **non-English wav2vec2 alignment models** which are CC-BY-NC. For MVP (English-focused), this is not an issue. For multilingual support (post-MVP F8), we must source MIT/Apache-licensed alignment models for non-English languages — several community-contributed alternatives exist on Hugging Face.

WorshipSync itself must be released under **GPL-3.0** to comply with FreeShow's copyleft license.

### OQ6: Fork vs. Upstream Contribution ✅ RESOLVED

**Decision:** **Start as a fork, target upstream contribution for core integration points.**

Rationale:
- WorshipSync introduces a Python sidecar dependency and significant new subsystems (audio input, beat detection, timing engine) that may be too invasive for the FreeShow maintainers to accept initially
- The FreeShow project has a small core team (~2–3 active maintainers) and explicitly welcomes contributions via their Slack channel
- The `.show` format already supports custom meta keys, and the output architecture supports new output types — these are natural extension points that don't require core modifications
- **Phase 1:** Fork and develop independently, using clean API boundaries (sidecar files, new output type, separate settings panel)
- **Phase 2:** Once proven in production (3+ churches), propose the core integration hooks as a PR: (a) timing map sidecar file convention, (b) karaoke output type, (c) audio input subsystem
- **Phase 3:** If accepted upstream, WorshipSync becomes a "feature module" within FreeShow rather than a fork — dramatically reducing maintenance burden

---

*BMAD Phase 2: Planning — Product Requirements Document*
*Status: DRAFT — Open Questions Resolved*
*Author: PM Agent*
*Date: 2026-05-13*
*Input: product-brief.md (Phase 1)*
*Research: FreeShow codebase analysis (ChurchApps/FreeShow), freeshow.app/docs, dependency license audit*
*Next: ux-spec.md (Phase 2, optional) → architecture.md (Phase 3)*
