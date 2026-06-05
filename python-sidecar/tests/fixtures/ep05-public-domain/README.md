# EP-05.8 Public-Domain Audio Fixture

This fixture is a 48-second mono WAV excerpt from the public-domain recording `Amazing_grace.ogg`.

- Source: https://commons.wikimedia.org/wiki/File:Amazing_grace.ogg
- Upstream source noted by Wikimedia: Library of Congress `afc/afcss39/263/2638a2.mp3`
- Public-domain rationale: Wikimedia Commons marks the recording as public domain in the United States.
- Fixture file: `amazing-grace-48s.wav`
- Fixture transform: first 48 seconds, mono, 16 kHz PCM WAV.
- SHA256: `0b4c71c9dbd66e2a02f9cfd7f24b27f5450573153a3ae5e84cbbe3a33e651329`

The production ML integration test is opt-in because it downloads and runs heavyweight Demucs/WhisperX model assets. Run it only from a prepared Python 3.11 ML venv:

```bash
cd python-sidecar
LYRICUE_RUN_ML_FIXTURE=1 .venv-ml/bin/pytest tests/test_learning_production_fixture.py -q
```
