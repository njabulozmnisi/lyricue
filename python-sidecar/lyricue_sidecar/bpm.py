"""Reference BPM detection for EP-05 STORY-05.4."""
from __future__ import annotations

from typing import Any, Callable, Optional


BpmDetector = Callable[[Any, int], Optional[int]]


def detect_bpm(samples: Any, sample_rate: int, *, detector: BpmDetector | None = None) -> int | None:
    """Detect dominant BPM from the original mix.

    Returns None for very low-energy/spoken content or when librosa cannot produce a
    reliable tempo. The learning pipeline converts None to the TimingMap default.
    """

    active_detector = detector or _librosa_bpm_detector
    return active_detector(samples, sample_rate)


def _librosa_bpm_detector(samples: Any, sample_rate: int) -> int | None:
    try:
        import librosa  # type: ignore[import-not-found]
        import numpy as np  # type: ignore[import-not-found]
    except Exception:
        return None

    arr = np.asarray(samples, dtype=float)
    if arr.size == 0:
        return None
    if float(np.sqrt(np.mean(np.square(arr)))) < 0.005:
        return None

    try:
        onset_env = librosa.onset.onset_strength(y=arr, sr=sample_rate)
        if onset_env.size == 0 or float(np.max(onset_env)) < 0.01:
            return None
        tempo = librosa.beat.tempo(onset_envelope=onset_env, sr=sample_rate)
    except Exception:
        return None

    if len(tempo) == 0:
        return None
    bpm = int(round(float(tempo[0])))
    if bpm < 40 or bpm > 240:
        return None
    return bpm
