# Product Brief: WorshipSync

## Vision Statement

An AI-powered lyric display system that learns songs from reference recordings and delivers real-time, word-by-word karaoke-style highlighting during live worship — advancing lyrics predictively so congregations always see what to sing before they need to sing it.

## Problem Statement

In churches worldwide, lyric projection during worship is a manual, error-prone process. A dedicated tech operator must listen to the worship leader and press "next slide" at the right moment. This creates several pain points:

- **Timing mismatches** — slides advance too early or too late, breaking congregational flow
- **Operator dependency** — requires a skilled, attentive person every service; a single lapse disrupts worship
- **No word-level pacing** — even perfectly timed slides show a block of text with no indication of tempo, leaving unfamiliar singers guessing when to sing each word
- **Spontaneity fragility** — when the worship leader repeats a chorus, extends a bridge, or pauses for prayer, the operator scrambles to keep up
- **Rehearsal-production disconnect** — the arrangement practiced on Thursday has no link to Sunday's display system

## Target Users

| User | Role | Primary Need |
|---|---|---|
| Congregation members | Singers / participants | See the right words at the right time with tempo guidance |
| Worship leader | Song leader / vocalist | Freedom to lead spontaneously without worrying about slides |
| Tech operator | Lyric projection controller | Reduced cognitive load; confidence the system handles sync |
| Musicians | Band members | Synchronized chord charts advancing with the same engine |
| Church leadership | Pastoral / admin oversight | Reliable worship experience; reduced volunteer burden |

## Core Value Proposition

**"Learn once, sync every time."** Feed the system a song recording and lyrics → it learns word-level timing → during live worship, it highlights each word in tempo and advances lyrics predictively, adapting to the worship leader's actual pace.

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
- Run lightweight speech-to-text (Web Speech API) as a background safety net
- Use recognized words to confirm or correct the current position in the song
- Handle worship leader repeating sections, skipping verses, or ad-libbing

### F5: Manual Override & Graceful Degradation
- Keyboard/touch shortcuts for manual advance/reverse at any time
- Three-tier fallback: full AI sync → timer-based advance → manual control
- Spontaneous moment detection: when singing stops (prayer, speaking), hold current display

## Key Features (Post-MVP)

### F6: Rehearsal Learning
- System listens during Thursday rehearsal, learns the team's specific arrangement, tempo, and transitions
- Sunday playback uses rehearsal-learned data — zero manual configuration

### F7: Arrangement Builder
- Worship leader drags sections (verse, chorus, bridge) to define their specific arrangement
- System re-sequences timing data to match

### F8: Multilingual Lyrics
- Display synchronized second-language lyrics below primary language
- Critical for South African churches (11 official languages) and international congregations

### F9: Musician Chord Chart Sync
- Separate output view showing chord charts advancing from the same timing engine
- Displayed on musician stage monitors or tablets

### F10: Confidence Dashboard (Operator View)
- Real-time indicator: Green (locked) / Yellow (uncertain) / Red (lost sync)
- Builds operator trust incrementally

### F11: Community Song Library
- Share learned timing maps across churches
- Import a timing map instead of running the ML pipeline locally

### F12: Companion Phone View
- QR code / URL provides congregants a synced lyric view on personal devices
- Accessibility: supports larger fonts, high contrast

### F13: Service Recording with Auto-Subtitles
- Generate word-accurate subtitles from the sync data for livestream/recording archives

## Technical Approach

### Platform Strategy
- **Extend FreeShow** (https://freeshow.app/) — open-source worship presentation software built with Electron + Svelte + TypeScript
- FreeShow already handles song libraries, slide display, and projector output
- WorshipSync adds the AI auto-advance layer as an extension/plugin or fork contribution

### ML Stack (Local, Offline-First)
| Component | Tool | Runs |
|---|---|---|
| Vocal isolation | Demucs (Meta) | Python sidecar, ~300MB model |
| Forced alignment | WhisperX (Whisper + wav2vec2) | Python sidecar, ~500MB–1.5GB |
| Beat detection | Meyda / Essentia.js | In-browser (Electron), lightweight |
| Section detection | Librosa + heuristics | Python sidecar |
| Live STT | Web Speech API | In-browser (Chromium), free |

### Offline-First Requirement
- All ML models, learned song data, and the sync engine must work completely offline
- Internet only needed optionally for pulling reference audio (YouTube) or community library sync
- Critical for churches in South Africa and across Africa with unreliable connectivity

## Competitive Landscape

| Solution | What It Does | Gap |
|---|---|---|
| ProPresenter | Industry-standard church presentation | Manual slide advance only; no auto-sync |
| EasyWorship | Church presentation software | Manual advance; no word-level display |
| FreeShow | Open-source presentation | Manual advance; no AI layer |
| OpenLP | Open-source church projection | Manual advance; basic feature set |
| Karaoke software (various) | Word-level highlighting | Tied to pre-recorded tracks; no live sync |

**No existing solution combines live-performance-aware auto-advance with word-level karaoke highlighting for worship contexts.** This is a genuine whitespace.

## Success Metrics

- **Slide timing accuracy**: ≥90% of slides advance within ±1 second of ideal timing
- **Word highlight accuracy**: ≥85% of words highlighted within ±300ms of actual singing
- **Operator intervention rate**: <10% of songs require manual override during normal worship
- **Song learning time**: <5 minutes to process a new song from audio + lyrics
- **Adoption signal**: At least 3 churches using the system in live worship within 6 months of MVP

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| STT accuracy degrades with singing vs. speech | Position correction fails | Use STT as secondary anchor only; primary sync via beat/tempo tracking |
| Worship leader deviates significantly from learned arrangement | System loses position | Arrangement builder (F7) + manual override (F5) + spontaneous moment detection |
| ML model size too large for low-spec church PCs | Can't run locally | Offer "cloud learning" option; keep live sync engine lightweight |
| FreeShow codebase changes break integration | Maintenance burden | Contribute upstream where possible; maintain clean API boundaries |
| Congregation finds word highlighting distracting | UX failure | Configurable: full karaoke, section-only advance, or traditional slide mode |
| Background music/instruments confuse beat detection | Tempo tracking fails | Use direct sound desk line-in (dry vocal channel) when available |

## Constraints

- Must run on consumer hardware (no GPU requirement for live sync; GPU optional for faster song learning)
- Must be free and open-source (aligning with FreeShow's model)
- Must work offline once songs are learned
- Must not require the worship leader to change their workflow or wear additional equipment

## Project Name Options

- **WorshipSync** — clear, descriptive
- **HymnFlow** — evocative, slightly narrower connotation
- **SongPilot** — emphasizes the auto-advance intelligence
- **LyricLock** — emphasizes the sync precision

Working name for this brief: **WorshipSync**

---

*BMAD Phase 1: Analysis — Product Brief*
*Status: DRAFT*
*Author: Analyst Agent*
*Date: 2026-05-10*
