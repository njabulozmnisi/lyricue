# WorshipSync

**AI-powered lyric synchronization for live worship — extending [FreeShow](https://freeshow.app/)**

> "Learn once, sync every time." Feed the system a song recording and lyrics → it learns word-level timing → during live worship, it highlights each word in tempo and advances lyrics predictively, adapting to the worship leader's actual pace.

## What Is This?

WorshipSync is an open-source extension for [FreeShow](https://github.com/ChurchApps/FreeShow) (Electron + Svelte + TypeScript) that automates worship lyric projection with:

- **Word-level karaoke highlighting** — each word highlights as it should be sung, with sweep animations matching the tempo
- **AI song learning** — feed in a recording + lyrics, local ML models (Demucs + WhisperX) produce precise word-level timing
- **Live tempo sync** — beat detection adapts to the worship leader's actual pace in real-time
- **Rehearsal learning** — the system listens during Thursday rehearsal and learns the team's specific arrangement
- **Arrangement builder** — worship leaders define their section order (V1 C V2 C C B C) without re-learning
- **Multilingual lyrics** — synchronized parallel language display for multicultural congregations
- **Community song library** — share learned timing maps between churches
- **Graceful degradation** — three-tier fallback: full AI sync → timer-based → manual control

## Project Status

🚧 **Pre-development — BMAD Planning Phase**

This project is being planned using the [BMAD Method](https://docs.bmad-method.org/) (Breakthrough Method for Agile AI-Driven Development). We are currently in the planning and architecture phases before writing any code.

### BMAD Progress

| Phase | Status | Artifacts |
|---|---|---|
| Phase 1: Analysis | ✅ Complete | `_bmad-output/product-brief.md` |
| Phase 2: Planning | ✅ Complete | `_bmad-output/PRD.md` |
| Phase 2: UX Design | ⬜ Pending | — |
| Phase 3: Architecture | ⬜ Pending | — |
| Phase 3: Epics & Stories | ⬜ Pending | — |
| Phase 4: Implementation | ⬜ Pending | — |

## Technical Approach

- **Platform:** FreeShow extension/fork (Electron + Svelte + TypeScript)
- **ML Stack:** Demucs (vocal isolation, MIT), WhisperX (forced alignment, BSD-2), Whisper.cpp (live STT, MIT)
- **Audio:** Web Audio API + Meyda/Essentia.js for beat detection
- **Offline-first:** All ML models run locally — critical for churches with unreliable connectivity
- **License:** GPL-3.0 (matching FreeShow)

## Target Users

- **Congregation** — see the right words at the right time with tempo guidance
- **Worship leaders** — lead freely without worrying about slides
- **Tech operators** — reduced cognitive load; confidence the system handles sync
- **Church leadership** — reliable worship experience; reduced volunteer burden

## Contributing

This project is in early planning. Once we reach Phase 4 (Implementation), contribution guidelines will be established. For now, review the BMAD artifacts in `_bmad-output/` and open issues for discussion.

## License

GPL-3.0 — see [LICENSE](LICENSE)
