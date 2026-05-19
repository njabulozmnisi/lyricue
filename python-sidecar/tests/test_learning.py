"""EP-05 song-learning RPC handler tests."""
from __future__ import annotations

from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

from lyricue_sidecar import learning
from lyricue_sidecar.audio_decode import DecodedAudio, TARGET_SAMPLE_RATE
from lyricue_sidecar.jobs import cancel_job_handler
from lyricue_sidecar.learning import learn_song_handler
from lyricue_sidecar.protocol import ERROR_INVALID_PARAMS, ERROR_JOB_CANCELLED, JsonRpcError, RequestContext
from lyricue_sidecar.timing_map import deterministic_align, parse_input_sections, propose_sections
from lyricue_sidecar.vocal_isolation import IsolatedVocals


def progress_context(request_id="req-1"):
    notifications: list[tuple[str, dict]] = []

    def notify(method, params=None):
        notifications.append((method, dict(params or {})))

    return RequestContext(request_id=request_id, notify=notify), notifications


def test_learn_song_requires_params():
    with pytest.raises(JsonRpcError) as exc:
        learn_song_handler(None)

    assert exc.value.code == ERROR_INVALID_PARAMS


def test_learn_song_requires_audio_path():
    with pytest.raises(JsonRpcError) as exc:
        learn_song_handler({"jobId": "j1"})

    assert exc.value.code == ERROR_INVALID_PARAMS


def test_learn_song_rejects_non_string_job_id():
    with pytest.raises(JsonRpcError) as exc:
        learn_song_handler({"jobId": 123, "audioPath": "/tmp/song.wav"})

    assert exc.value.code == ERROR_INVALID_PARAMS


def test_learn_song_requires_show_id():
    with pytest.raises(JsonRpcError) as exc:
        learn_song_handler({"jobId": "j1", "audioPath": "/tmp/song.wav", "lyrics": []})

    assert exc.value.code == ERROR_INVALID_PARAMS


def test_learn_song_returns_timing_map(monkeypatch: pytest.MonkeyPatch):
    def fake_decode(audio_path: str):
        assert audio_path == "/tmp/song.wav"
        return DecodedAudio(
            path=Path(audio_path),
            samples=[0.1] * 200_000,
            sample_rate=TARGET_SAMPLE_RATE,
            duration_seconds=12.5,
            sample_count=200_000,
            byte_size=4096,
        )

    monkeypatch.setattr(learning, "decode_audio_file", fake_decode)
    monkeypatch.setattr(learning, "detect_bpm", lambda _samples, _sample_rate: 96)

    result = learn_song_handler(
        {
            "jobId": "job-1",
            "showId": "show-1",
            "audioPath": "/tmp/song.wav",
            "lyrics": [
                {
                    "id": "verse-1",
                    "type": "verse",
                    "label": "Verse 1",
                    "text": "Amazing grace\nHow sweet the sound",
                    "lines": ["Amazing grace", "How sweet the sound"],
                }
            ],
            "options": {"language": "en", "detectSections": True},
        }
    )

    assert result["jobId"] == "job-1"
    assert result["stage"] == "timing_map_ready"
    assert result["diagnostics"]["alignmentMode"] == "deterministic"
    assert result["diagnostics"]["audio"]["sampleRate"] == TARGET_SAMPLE_RATE
    assert result["proposedSections"] == []

    timing_map = result["timingMap"]
    assert timing_map["$schema"] == "lyricue-timing-v1"
    assert timing_map["showId"] == "show-1"
    assert timing_map["bpm"] == 96
    assert timing_map["language"] == "en"
    assert timing_map["learnedFrom"]["filename"] == "song.wav"
    assert timing_map["sections"][0]["id"] == "verse-1"
    assert [word["text"] for word in timing_map["sections"][0]["words"]] == [
        "Amazing",
        "grace",
        "How",
        "sweet",
        "the",
        "sound",
    ]
    assert timing_map["sections"][0]["lines"] == [
        {"startMs": 0, "endMs": 2983, "wordStartIndex": 0, "wordEndIndex": 2},
        {"startMs": 4166, "endMs": 11315, "wordStartIndex": 2, "wordEndIndex": 6},
    ]


def test_learn_song_emits_progress_notifications(monkeypatch: pytest.MonkeyPatch):
    def fake_decode(audio_path: str):
        return DecodedAudio(
            path=Path(audio_path),
            samples=[0.1] * 32_000,
            sample_rate=TARGET_SAMPLE_RATE,
            duration_seconds=2.0,
            sample_count=32_000,
            byte_size=4096,
        )

    monkeypatch.setattr(learning, "decode_audio_file", fake_decode)
    monkeypatch.setattr(learning, "detect_bpm", lambda _samples, _sample_rate: 120)
    context, notifications = progress_context(7)

    learn_song_handler(
        {
            "jobId": "job-progress",
            "showId": "show-progress",
            "audioPath": "/tmp/song.wav",
            "lyrics": [{"id": "v1", "type": "verse", "label": "Verse 1", "text": "Line one", "lines": ["Line one"]}],
            "options": {"detectSections": True},
        },
        context,
    )

    assert [params["stage"] for method, params in notifications if method == "progress"] == [
        "decode",
        "bpm",
        "alignment",
        "timing_map",
        "section_detection",
        "complete",
    ]
    assert all(params["request_id"] == 7 for method, params in notifications if method == "progress")
    assert all(params["jobId"] == "job-progress" for method, params in notifications if method == "progress")


def test_learn_song_production_mode_uses_vocal_isolation_and_forced_alignment(monkeypatch: pytest.MonkeyPatch):
    from lyricue_sidecar.timing_map import AlignedWord

    def fake_decode(audio_path: str):
        return DecodedAudio(
            path=Path(audio_path),
            samples=[0.2] * 48_000,
            sample_rate=TARGET_SAMPLE_RATE,
            duration_seconds=3.0,
            sample_count=48_000,
            byte_size=4096,
        )

    def fake_isolate(decoded, *, model_name, debug_path=None):
        assert model_name == "htdemucs"
        assert debug_path == "/tmp/vocals.wav"
        return IsolatedVocals(samples=[0.1] * 48_000, sample_rate=decoded.sample_rate, model_name=model_name, rms=0.12, debug_path=debug_path)

    def fake_align(vocals, sections, *, language, model_name):
        assert vocals.model_name == "htdemucs"
        assert language == "zu"
        assert model_name == "small"
        return SimpleNamespace(
            words=[
                AlignedWord("Siyabonga", 0, 700, 0.92, 0, 0),
                AlignedWord("Nkosi", 750, 1300, 0.88, 0, 0),
            ]
        )

    monkeypatch.setattr(learning, "decode_audio_file", fake_decode)
    monkeypatch.setattr(learning, "detect_bpm", lambda _samples, _sample_rate: 100)
    monkeypatch.setattr(learning, "isolate_vocals", fake_isolate)
    monkeypatch.setattr(learning, "align_vocals", fake_align)

    result = learn_song_handler(
        {
            "jobId": "job-prod",
            "showId": "show-prod",
            "audioPath": "/tmp/song.wav",
            "lyrics": [{"id": "v1", "type": "verse", "label": "Verse 1", "text": "Siyabonga Nkosi", "lines": ["Siyabonga Nkosi"]}],
            "options": {"alignmentMode": "production", "language": "zu", "debugVocalsPath": "/tmp/vocals.wav"},
        }
    )

    assert result["diagnostics"]["alignmentMode"] == "production"
    assert result["diagnostics"]["vocals"] == {"model": "htdemucs", "rms": 0.12, "debugPath": "/tmp/vocals.wav"}
    timing_map = result["timingMap"]
    assert timing_map["metadata"]["demucsModel"] == "htdemucs"
    assert timing_map["metadata"]["whisperxModel"] == "small"
    assert [word["confidence"] for word in timing_map["sections"][0]["words"]] == [0.92, 0.88]


def test_learn_song_production_mode_ensures_required_models(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    from lyricue_sidecar.timing_map import AlignedWord

    digest = "a" * 64
    ensured: dict[str, object] = {}

    def fake_decode(audio_path: str):
        return DecodedAudio(
            path=Path(audio_path),
            samples=[0.2] * 48_000,
            sample_rate=TARGET_SAMPLE_RATE,
            duration_seconds=3.0,
            sample_count=48_000,
            byte_size=4096,
        )

    def fake_ensure(specs, *, models_dir, mirror_url=None, context=None):
        ensured["specs"] = list(specs)
        ensured["models_dir"] = models_dir
        ensured["mirror_url"] = mirror_url
        ensured["context"] = context
        return []

    monkeypatch.setattr(learning, "decode_audio_file", fake_decode)
    monkeypatch.setattr(learning, "detect_bpm", lambda _samples, _sample_rate: 100)
    monkeypatch.setattr(learning, "ensure_models", fake_ensure)
    monkeypatch.setattr(learning, "resolve_models_dir", lambda: tmp_path)
    monkeypatch.setattr(learning, "isolate_vocals", lambda decoded, *, model_name, debug_path=None: IsolatedVocals(samples=[0.1] * 48_000, sample_rate=decoded.sample_rate, model_name=model_name, rms=0.12, debug_path=debug_path))
    monkeypatch.setattr(
        learning,
        "align_vocals",
        lambda _vocals, _sections, *, language, model_name: SimpleNamespace(words=[AlignedWord("Siyabonga", 0, 700, 0.92, 0, 0)]),
    )
    context, notifications = progress_context("learn-models")

    learn_song_handler(
        {
            "jobId": "job-models",
            "showId": "show-prod",
            "audioPath": "/tmp/song.wav",
            "lyrics": [{"id": "v1", "type": "verse", "label": "Verse 1", "text": "Siyabonga", "lines": ["Siyabonga"]}],
            "options": {
                "alignmentMode": "production",
                "requiredModels": [{"name": "htdemucs", "version": "v1", "sha256": digest}],
                "modelMirrorUrl": "https://mirror.example/models",
            },
        },
        context,
    )

    specs = ensured["specs"]
    assert specs[0].cache_key == "htdemucs-v1"
    assert ensured["models_dir"] == tmp_path
    assert ensured["mirror_url"] == "https://mirror.example/models"
    assert ensured["context"] is context
    assert "models" in [params["stage"] for method, params in notifications if method == "progress"]


def test_learn_song_rejects_unknown_alignment_mode():
    with pytest.raises(JsonRpcError) as exc:
        learn_song_handler(
            {
                "jobId": "job-mode",
                "showId": "show-1",
                "audioPath": "/tmp/song.wav",
                "lyrics": [{"label": "Verse 1", "text": "Line one", "lines": ["Line one"]}],
                "options": {"alignmentMode": "fast"},
            }
        )

    assert exc.value.code == ERROR_INVALID_PARAMS


def test_cancelled_job_stops_at_checkpoint(monkeypatch: pytest.MonkeyPatch):
    cancel_job_handler({"jobId": "job-cancel"})

    with pytest.raises(JsonRpcError) as exc:
        learn_song_handler(
            {
                "jobId": "job-cancel",
                "showId": "show-1",
                "audioPath": "/tmp/song.wav",
                "lyrics": [{"label": "Verse 1", "text": "Line one", "lines": ["Line one"]}],
            }
        )

    assert exc.value.code == ERROR_JOB_CANCELLED


def test_detect_sections_uses_audio_energy_contours(monkeypatch: pytest.MonkeyPatch):
    np = pytest.importorskip("numpy")

    samples = np.concatenate(
        [
            np.full(16_000, 0.05, dtype=float),
            np.full(16_000, 0.8, dtype=float),
            np.full(16_000, 0.05, dtype=float),
        ]
    )

    def fake_decode(audio_path: str):
        return DecodedAudio(
            path=Path(audio_path),
            samples=samples,
            sample_rate=TARGET_SAMPLE_RATE,
            duration_seconds=3.0,
            sample_count=len(samples),
            byte_size=4096,
        )

    monkeypatch.setattr(learning, "decode_audio_file", fake_decode)
    monkeypatch.setattr(learning, "detect_bpm", lambda _samples, _sample_rate: 120)

    result = learn_song_handler(
        {
            "jobId": "job-energy",
            "showId": "show-energy",
            "audioPath": "/tmp/song.wav",
            "lyrics": [
                {"id": "v1", "type": "verse", "label": "Verse 1", "text": "quiet start", "lines": ["quiet start"]},
                {"id": "lift", "type": "other", "label": "Lift", "text": "loud refrain", "lines": ["loud refrain"]},
                {"id": "v2", "type": "verse", "label": "Verse 2", "text": "quiet end", "lines": ["quiet end"]},
            ],
            "options": {"detectSections": True},
        }
    )

    energy_proposals = [p for p in result["proposedSections"] if p["sectionId"] == "lift"]
    assert energy_proposals
    assert "energy_spike" in energy_proposals[0]["reason"]
    assert energy_proposals[0]["energyScore"] > 1.35


def test_detect_sections_is_best_effort_when_energy_analysis_fails(monkeypatch: pytest.MonkeyPatch):
    def raising_rms(**_kwargs):
        raise RuntimeError("rms unavailable")

    monkeypatch.setitem(
        sys.modules,
        "librosa",
        SimpleNamespace(
            feature=SimpleNamespace(rms=raising_rms),
            frames_to_time=lambda *_args, **_kwargs: [],
        ),
    )

    sections = parse_input_sections(
        [
            {"id": "a", "type": "verse", "label": "Verse A", "text": "same line", "lines": ["same line"]},
            {"id": "b", "type": "verse", "label": "Verse B", "text": "same line", "lines": ["same line"]},
        ]
    )
    aligned = deterministic_align(sections, 2.0)

    proposals = propose_sections(sections, aligned_words=aligned, samples=[0.1] * 32_000, sample_rate=TARGET_SAMPLE_RATE)

    assert proposals == [
        {"sectionId": "a", "suggestedType": "chorus", "reason": "repeated_lyrics"},
        {"sectionId": "b", "suggestedType": "chorus", "reason": "repeated_lyrics"},
    ]
