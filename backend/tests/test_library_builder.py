from __future__ import annotations

import json
import zipfile
from pathlib import Path

from app import library_builder
from app.library_builder import build_exam_payload, list_prepared_packages, prepare_listen_resources, write_exam_package
from app.schemas import TranscriptionResult


def sample_result() -> TranscriptionResult:
    return TranscriptionResult.model_validate({
        "analysisId": "analysis-test",
        "createdAt": "2026-10-16T00:00:00Z",
        "source": {
            "fileName": "2025年12月N1听力.m4a",
            "duration": 12.0,
            "detectedLanguage": "ja",
            "languageProbability": 1.0,
            "modelSize": "small",
        },
        "segments": [
            {"id": "s1", "startTime": 1.0, "endTime": 3.0, "text": "問題1です。"},
            {"id": "s2", "startTime": 3.0, "endTime": 6.0, "text": "会話の文です。"},
            {"id": "s3", "startTime": 7.0, "endTime": 10.0, "text": "次の材料です。"},
        ],
        "classification": {
            "sections": [{
                "id": "sec1", "title": "問題1", "startTime": 1.0, "endTime": 10.0,
                "sourceSegmentIds": ["s1", "s2", "s3"], "status": "inferred",
                "confidence": 0.8, "note": "test",
            }],
            "passages": [
                {
                    "id": "p1", "sectionId": "sec1", "title": "1番", "startTime": 1.0, "endTime": 6.0,
                    "sourceSegmentIds": ["s1", "s2"], "questionIds": ["q1", "q2"],
                    "status": "inferred", "confidence": 0.8, "note": "shared",
                },
                {
                    "id": "p2", "sectionId": "sec1", "title": "材料2", "startTime": 7.0, "endTime": 10.0,
                    "sourceSegmentIds": ["s3"], "questionIds": [],
                    "status": "unresolved", "confidence": 0.2, "note": "unknown",
                },
            ],
            "questions": [
                {
                    "id": "q1", "passageId": "p1", "label": "18", "prompt": "質問1",
                    "startTime": 1.0, "endTime": 4.0, "sourceSegmentIds": ["s1"],
                    "status": "inferred", "confidence": 0.7, "note": "test",
                },
                {
                    "id": "q2", "passageId": "p1", "label": "19", "prompt": "質問2",
                    "startTime": 4.0, "endTime": 6.0, "sourceSegmentIds": ["s2"],
                    "status": "inferred", "confidence": 0.7, "note": "test",
                },
            ],
            "unassignedSegmentIds": [],
            "warnings": [],
        },
    })


def test_builder_preserves_shared_passage_and_marks_unknown_material(tmp_path: Path) -> None:
    audio = tmp_path / "2025年12月N1听力.m4a"
    audio.write_bytes(b"fake-audio")
    payload = build_exam_payload(audio, sample_result(), "a" * 64)

    assert payload["exam"]["year"] == 2025
    assert payload["exam"]["month"] == 12
    assert payload["exam"]["reviewStatus"] == "auto_draft"
    assert payload["exam"]["sourcePackageVersion"] == library_builder.BUILDER_VERSION
    shared_questions = [question for question in payload["questions"] if question["passageId"] == payload["passages"][0]["id"]]
    assert [question["number"] for question in shared_questions] == ["18", "19"]
    assert len({question["passageId"] for question in shared_questions}) == 1
    placeholder = next(question for question in payload["questions"] if question["passageId"] == payload["passages"][1]["id"])
    assert placeholder["reviewStatus"] == "unresolved"
    assert "correctAnswer" not in placeholder
    assert "choices" not in placeholder
    assert [segment["order"] for segment in payload["segments"] if segment["passageId"] == payload["passages"][0]["id"]] == [0, 1]


def test_builder_keeps_unclassified_segments_available_for_intensive_listening(tmp_path: Path) -> None:
    audio = tmp_path / "2025年7月N1听力.m4a"
    audio.write_bytes(b"fake-audio")
    value = sample_result().model_dump()
    value["segments"].append({
        "id": "s4", "startTime": 10.5, "endTime": 11.5, "text": "未分類の案内です。",
    })
    value["classification"]["unassignedSegmentIds"] = ["s4"]

    payload = build_exam_payload(audio, TranscriptionResult.model_validate(value), "b" * 64)

    assert len(payload["segments"]) == 4
    fallback = next(passage for passage in payload["passages"] if "unclassified" in passage["id"])
    assert fallback["reviewStatus"] == "unresolved"
    assert fallback["segmentIds"] == [payload["segments"][-1]["id"]]
    placeholder = next(question for question in payload["questions"] if question["passageId"] == fallback["id"])
    assert placeholder["reviewStatus"] == "unresolved"
    assert "correctAnswer" not in placeholder


def test_builder_writes_a_self_contained_package_and_index(tmp_path: Path) -> None:
    audio = tmp_path / "2025年12月N1听力.m4a"
    audio.write_bytes(b"fake-audio")
    data_root = tmp_path / "data"
    package_root = data_root / "library_packages"
    resource = write_exam_package(audio, sample_result(), package_root)
    index = [resource]
    (package_root / "index.json").write_text(json.dumps(index), encoding="utf-8")

    package_path = package_root / resource["packageFile"]
    assert package_path.is_file()
    with zipfile.ZipFile(package_path) as archive:
        names = set(archive.namelist())
        assert {"manifest.json", "exam.json"}.issubset(names)
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["format"] == "jlpt-listening-exam-package"
        assert set(manifest["audioFiles"]) == {resource["examId"].replace("exam-", "audio-")}
        assert manifest["audioFiles"][next(iter(manifest["audioFiles"]))] in names

    assert list_prepared_packages(data_root) == index


def test_batch_checkpoints_failure_and_continues_with_next_audio(tmp_path: Path, monkeypatch) -> None:
    listen_root = tmp_path / "Listen"
    listen_root.mkdir()
    broken = listen_root / "01-broken.m4a"
    working = listen_root / "02-working.m4a"
    broken.write_bytes(b"broken")
    working.write_bytes(b"working")

    def probe(path: Path) -> float:
        if path == broken:
            raise ValueError("damaged audio")
        return 12.0

    monkeypatch.setattr(library_builder, "_probe_duration", probe)
    monkeypatch.setattr(library_builder, "_load_matching_result", lambda *_args: (sample_result(), tmp_path / "result.json"))

    resources = prepare_listen_resources(listen_root, tmp_path / "data", transcribe_missing=False)

    assert [item["status"] for item in resources] == ["failed", "ready"]
    assert "damaged audio" in resources[0]["message"]
    assert list_prepared_packages(tmp_path / "data") == resources
