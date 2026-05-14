# Product Brief: LyriCue

## Vision Statement

An AI-powered lyric display system that learns songs from reference recordings and delivers real-time, word-by-word karaoke-style highlighting during live performance — advancing lyrics predictively so audiences always see what to sing or follow before they need to.

## Positioning

LyriCue is a **general-purpose live lyric synchronization tool** for any context where lyrics need to follow a lead vocalist in real time. The underlying technology is domain-neutral: a song, an audio signal, and word-level timing. Anywhere those three things exist, LyriCue applies.

**Primary launch market: worship.** Multi-campus churches are the strongest early validation context — they have a real, motivated pain point, an established open-source ecosystem (FreeShow), and a clear "60-venue organization" deployment scenario that exercises the full architecture (offline-first, multi-tenant library, federated content sharing). The pilot deployment in this brief is a 60-campus church.

**But the product is not church-only.** The same capability serves karaoke venues, theater productions, touring live music, sing-along educational content, language-learning tools, conference teleprompting, real-time accessibility captioning, and any other context where a human voice needs to be visually followed in time. Architecture decisions, data models, and naming intentionally avoid coupling to any one domain.

## Problem Statement

Across many live-performance contexts, lyric / text projection is a manual, error-prone process. A dedicated operator must listen to the performer and press "next" at the right moment. This creates several pain points:

- **Timing mismatches** — text advances too early or too late, breaking the audience's flow
- **Operator dependency** — requires a skilled, attentive person every performance; a single lapse disrupts the event
- **No word-level pacing** — even perfectly timed slides show a block of text with no indication of tempo, leaving unfamiliar singers/readers guessing when to sing each word
- **Spontaneity fragility** — when the performer repeats a chorus, extends a bridge, or pauses for monologue, the operator scrambles to keep up
- **Rehearsal–production disconnect** — the arrangement practiced in rehearsal has no link to the live display system

These pain points are not unique to any one domain. They appear identically in worship services, karaoke nights, theater productions, and live concerts.

## Target Users

LyriCue serves a layered set of users that generalizes across performance contexts:

| User | Role (generic) | Worship context example | Other-domain examples | Primary Need |
|---|---|---|---|---|
| **Audience** | Singers / readers / participants | Congregation | Karaoke patrons, theater attendees, students | See the right words at the right time with tempo guidance |
| **Lead performer** | Vocalist / leader | Worship leader | Karaoke singer, lead actor, touring vocalist | Freedom to perform spontaneously without worrying about display |
| **Tech operator** | Live operator / A/V tech | Volunteer tech operator | Karaoke host, stage manager, AV tech | Reduced cognitive load; confidence the system handles sync |
| **Supporting performers** | Band / cast members | Musicians | Backing band, ensemble cast | Synchronized supplementary displays (chord charts, cue sheets) |
| **Org leadership** | Production / venue manager | Pastoral leadership | Venue owner, theater director, school principal | Reliable delivery; reduced staffing burden |

## Core Value Proposition

**"Learn once, sync every time."** Feed the system a song recording and lyrics → it learns word-level timing → during live performance, it highlights each word in tempo and advances lyrics predictively, adapting to the lead vocalist's actual pace.

## Key Features (MVP)

### F1: Song Learning Pipeline
- Accept a reference audio file (MP3/WAV) + lyrics text for any song
- Run local ML models to isolate vocals (Demucs) and produce word-level timestamps (WhisperX forced alignment)
- Output a structured timing map (JSON) with per-word start/end times, detected BPM, and section boundaries
- Store learned song data alongside existing song library entries

### F2: Word-Level Karaoke Renderer
- Display lyrics with real-time word-by-word highlighting
- Active word visually distinct (color, scale, sweep animation)
- Sung words dim; upcoming words visible
- Next line/section previewed below current line
- Smooth CSS-driven transitions matching word duration (no abrupt jumps)
- Held notes indicated by glow/pulse animation

### F3: Live Tempo Sync Engine
- Capture live audio input (mic or line-in from sound desk)
- Detect live BPM via beat tracking (Web Audio API / Meyda / Essentia.js)
- Calculate tempo ratio (live BPM / reference BPM) and scale all word timestamps in real-time
- Predictive advance: display next section ~2 seconds before it's sung

### F4: STT Position Correction
- Run lightweight local speech-to-text (Whisper.cpp) as a background safety net
- Use recognized words to confirm or correct the current position in the song
- Handle the lead vocalist repeating sections, skipping verses, or ad-libbing

### F5: Manual Override & Graceful Degradation
- Keyboard/touch shortcuts for manual advance/reverse at any time
- Three-tier fallback: full AI sync → timer-based advance → manual control
- Spontaneous moment detection: when singing stops (e.g., a speaking interlude), hold current display

## Key Features (Post-MVP)

### F6: Rehearsal Learning
- System listens during rehearsal, learns the team's specific arrangement, tempo, and transitions
- Live playback uses rehearsal-learned data — zero manual configuration

### F7: Arrangement Builder
- Operator or lead performer drags sections (verse, chorus, bridge) to define their specific arrangement
- System re-sequences timing data to match

### F8: Multilingual Lyrics
- Display synchronized second-language lyrics below primary language
- Critical for multilingual congregations and international audiences; also useful for language-learning applications

### F9: Supplementary Display Sync
- Separate output view showing chord charts, cue sheets, stage directions, or other supplementary content advancing from the same timing engine
- Displayed on stage monitors, tablets, or musician/cast personal devices

### F10: Confidence Dashboard (Operator View)
- Real-time indicator: Green (locked) / Yellow (uncertain) / Red (lost sync)
- Builds operator trust incrementally

### F11: Shared Song Library
- Share learned timing maps across venues / organizations
- Import a timing map instead of running the ML pipeline locally
- Multi-tenant catalog with per-organization isolation

### F12: Companion Audience View
- QR code / URL provides audience members a synced lyric view on personal devices
- Accessibility: supports larger fonts, high contrast, language switching

### F13: Recording with Auto-Subtitles
- Generate word-accurate subtitles from the sync data for livestream/recording archives

## Technical Approach

### Platform Strategy
- **Built on top of FreeShow** (https://freeshow.app/) — open-source, domain-neutral presentation software built with Electron + Svelte + TypeScript. Despite being maintained by ChurchApps, FreeShow itself contains no church-specific functionality.
- FreeShow already handles song libraries, slide display, and projector output across any presentation context.
- LyriCue adds the AI live-sync layer. Dual-mode deployment: a FreeShow fork build for max rendering fidelity, **and** a standalone sister-service build that drives FreeShow externally via its existing public APIs for clean separation and lower maintenance. See architecture.md §4.9 (OutputAdapter) and ADR-16.

### ML Stack (Local, Offline-First)
| Component | Tool | Runs |
|---|---|---|
| Vocal isolation | Demucs (Meta) | Python sidecar (PyInstaller-bundled), ~300MB model |
| Forced alignment | WhisperX (Whisper + wav2vec2) | Python sidecar, ~500MB–1.5GB |
| Beat detection | Meyda | In-browser (Electron), lightweight |
| Section detection | Librosa + heuristics | Python sidecar |
| Live STT | Whisper.cpp via native Node addon | In-browser process, fully offline, ~75MB |

No general-purpose LLMs are used at any stage. See architecture.md §2.1.2 for explicit statement.

### Offline-First Requirement
- All ML models, learned song data, and the sync engine must work completely offline
- Internet only needed optionally for one-time model downloads and for content library sync
- Critical for venues in low-connectivity regions (rural churches, touring contexts, theaters with no guest WiFi)

## Competitive Landscape

| Solution | Domain | What It Does | Gap |
|---|---|---|---|
| ProPresenter | Worship-focused presentation | Industry-standard slide projection | Manual advance only; no auto-sync; no word-level |
| EasyWorship | Worship-focused presentation | Slide projection | Manual advance; no word-level display |
| FreeShow | Generic presentation | Open-source slide projection | Manual advance; no AI layer; no word-level |
| OpenLP | Worship presentation | Open-source projection | Manual advance; basic feature set |
| Karafun, Singa, Smule | Karaoke | Pre-recorded backing tracks + word-level highlights | Tied to studio recordings; no live performer following; per-track licensing |
| Theater prompter software (PromptSmart, etc.) | Theater / public speaking | Manual or scroll-rate text following | No music-aware tempo; no word-level karaoke; no learned arrangements |
| Stage monitor lyrics (touring rigs) | Live music | Pre-set scrolling text | Manual rate; no adaptive tempo; not built for amateur operators |

**No existing solution combines live-performance-aware auto-advance with word-level karaoke highlighting and works generically across performance contexts.** This is a genuine whitespace.

## Success Metrics

- **Slide timing accuracy**: ≥90% of slides advance within ±1 second of ideal timing
- **Word highlight accuracy**: ≥85% of words highlighted within ±300ms of actual singing
- **Operator intervention rate**: <10% of songs require manual override during normal performance
- **Song learning time**: <5 minutes to process a new song from audio + lyrics
- **Launch-market adoption**: At least 3 venues using the system in live performance within 6 months of MVP (initially expected to be church venues — the primary validation context)
- **Cross-domain proof**: At least one non-worship deployment (karaoke venue, theater, school, or similar) within 12 months of MVP

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| STT accuracy degrades with singing vs. speech | Position correction fails | Use STT as secondary anchor only; primary sync via beat/tempo tracking |
| Lead vocalist deviates significantly from learned arrangement | System loses position | Arrangement builder (F7) + manual override (F5) + spontaneous moment detection |
| ML model size too large for low-spec venue PCs | Can't run locally | Hardware tiering — CPU-only path works on 8GB/4-core machines |
| FreeShow codebase changes break integration | Maintenance burden | Dual-mode architecture (ADR-16): sister-service mode shields most code from FreeShow changes |
| Audience finds word highlighting distracting | UX failure | Configurable: full karaoke, section-only advance, or traditional slide mode |
| Background music/instruments confuse beat detection | Tempo tracking fails | Use direct sound desk line-in (dry vocal channel) when available |
| Worship branding misread as "this is only for churches" | Limits market | This brief explicitly positions the product as generic; worship is the validation market |

## Constraints

- Must run on consumer hardware (no GPU requirement for live sync; GPU optional for faster song learning; Apple Silicon M1+ is a first-class platform)
- Must be free and open-source (aligning with FreeShow's GPL-3.0 model)
- Must work offline once songs are learned
- Must not require the lead vocalist to change their workflow or wear additional equipment

## Product Name

**LyriCue** — a portmanteau of "lyric" + "cue" (the theater term for a timed prompt). Cross-domain by design: theater uses cues, music uses cues, broadcast uses cues. The name describes what the product is — a system of timed cues for lyric display — without restricting the domain.

Previous working name: WorshipSync (rejected because it locked the product into the church-only market despite the technology being domain-neutral).

---

*BMAD Phase 1: Analysis — Product Brief*
*Status: DRAFT (rev. 2 — generalized positioning)*
*Author: Analyst Agent*
*Date: 2026-05-10 (rev. 2026-05-13)*
*Working name: **LyriCue***
