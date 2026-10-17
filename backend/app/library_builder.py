from __future__ import annotations

import hashlib
import json
import re
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .schemas import TranscriptionResult
from .transcriber import WhisperTranscriber


AUDIO_EXTENSIONS = {'.mp3', '.m4a', '.mp4', '.wav', '.flac', '.ogg', '.webm'}
PACKAGE_FORMAT = 'jlpt-listening-exam-package'
INDEX_FILE = 'index.json'
BUILDER_VERSION = 3


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _fingerprint(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _probe_duration(path: Path) -> float:
    import av

    with av.open(str(path)) as container:
        if container.duration is not None:
            return float(container.duration / av.time_base)
        durations = [float(stream.duration * stream.time_base) for stream in container.streams if stream.duration]
        return max(durations, default=0.0)


def _load_matching_result(result_root: Path, audio: Path, duration: float) -> tuple[TranscriptionResult, Path] | None:
    candidates: list[tuple[TranscriptionResult, Path]] = []
    for result_path in result_root.glob('*.json'):
        try:
            result = TranscriptionResult.model_validate_json(result_path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        if result.source.fileName != audio.name:
            continue
        if duration > 0 and abs(result.source.duration - duration) > 1.0:
            continue
        candidates.append((result, result_path))
    return max(candidates, key=lambda item: item[0].createdAt, default=None)


def _section_type(title: str) -> str:
    number = re.search(r'問題\s*([1-5])', title)
    return {
        '1': 'task_comprehension',
        '2': 'point_comprehension',
        '3': 'overview_comprehension',
        '4': 'quick_response',
        '5': 'integrated_comprehension',
    }.get(number.group(1) if number else '', 'other')


def _date_from_name(name: str) -> tuple[int | None, int | None]:
    match = re.search(r'(20\d{2})年\s*(1[0-2]|[1-9])月', name)
    return (int(match.group(1)), int(match.group(2))) if match else (None, None)


def _status(value: Any) -> str:
    return str(getattr(value, 'value', value))


def build_exam_payload(audio: Path, result: TranscriptionResult, fingerprint: str) -> dict[str, Any]:
    token = fingerprint[:12].lower()
    exam_id = f'exam-auto-{token}'
    audio_id = f'audio-auto-{token}'
    year, month = _date_from_name(audio.name)
    title_date = f'{year}年{month}月 ' if year and month else ''
    created_at = _now()

    section_ids = {item.id: f'{exam_id}-section-{index + 1}' for index, item in enumerate(result.classification.sections)}
    passage_ids = {item.id: f'{exam_id}-passage-{index + 1}' for index, item in enumerate(result.classification.passages)}
    segment_ids = {item.id: f'{exam_id}-segment-{index + 1}' for index, item in enumerate(result.segments)}
    source_passages = {item.id: item for item in result.classification.passages}

    questions: list[dict[str, Any]] = []
    question_ids_by_passage: dict[str, list[str]] = {item.id: [] for item in result.classification.passages}
    for suggestion in result.classification.questions:
        passage_id = passage_ids.get(suggestion.passageId)
        source_passage = source_passages.get(suggestion.passageId)
        if not passage_id or not source_passage:
            continue
        question_id = f'{exam_id}-question-{len(questions) + 1}'
        question_ids_by_passage[suggestion.passageId].append(question_id)
        questions.append({
            'id': question_id,
            'sectionId': section_ids[source_passage.sectionId],
            'passageId': passage_id,
            'number': suggestion.label,
            'order': len(question_ids_by_passage[suggestion.passageId]) - 1,
            'prompt': suggestion.prompt or None,
            'choicePresentation': 'audio',
            'reviewStatus': _status(suggestion.status),
            'sourceAnalysisId': result.analysisId,
            'reviewNote': suggestion.note,
        })

    # Every detected material must remain playable. A transparent placeholder is not
    # presented as a real question and carries no options, answer, or fabricated number.
    for passage_index, source_passage in enumerate(result.classification.passages):
        if question_ids_by_passage[source_passage.id]:
            continue
        question_id = f'{exam_id}-material-{passage_index + 1}'
        question_ids_by_passage[source_passage.id].append(question_id)
        questions.append({
            'id': question_id,
            'sectionId': section_ids[source_passage.sectionId],
            'passageId': passage_ids[source_passage.id],
            'number': f'材料{passage_index + 1}（待确认）',
            'order': 0,
            'prompt': '自动识别未能可靠确定本材料的题号；可先播放和逐句精听，未生成选项或答案。',
            'choicePresentation': 'audio',
            'reviewStatus': 'unresolved',
            'sourceAnalysisId': result.analysisId,
            'reviewNote': '为保证材料可访问而建立的待确认入口，不代表真实题号。',
        })

    passages: list[dict[str, Any]] = []
    for index, item in enumerate(result.classification.passages):
        source_segments = [segment_ids[segment_id] for segment_id in item.sourceSegmentIds if segment_id in segment_ids]
        passages.append({
            'id': passage_ids[item.id],
            'sectionId': section_ids[item.sectionId],
            'title': item.title,
            'audioAssetId': audio_id,
            'start': round(item.startTime, 3),
            'end': round(item.endTime, 3),
            'segmentIds': source_segments,
            'order': index,
            'reviewStatus': _status(item.status),
            'sourceAnalysisId': result.analysisId,
            'reviewNote': item.note,
        })

    # The classifier is deliberately conservative and can leave introductions,
    # instructions, or uncertain materials unassigned. Keep every transcribed
    # sentence available in intensive listening without inventing a question.
    assigned_source_ids = {segment_id for item in result.classification.passages for segment_id in item.sourceSegmentIds}
    unresolved_segments = []
    for item in result.segments:
        if item.id in assigned_source_ids:
            continue
        containing = [
            (source.endTime - source.startTime, source)
            for source in result.classification.passages
            if item.startTime >= source.startTime - 0.05 and item.endTime <= source.endTime + 0.05
        ]
        if containing:
            source_passage = min(containing, key=lambda candidate: candidate[0])[1]
            passages[next(index for index, passage in enumerate(passages) if passage['id'] == passage_ids[source_passage.id])]['segmentIds'].append(segment_ids[item.id])
            assigned_source_ids.add(item.id)
        else:
            unresolved_segments.append(item)

    def nearest_section_id(start: float, end: float) -> str:
        midpoint = (start + end) / 2
        containing = [item for item in result.classification.sections if item.startTime <= midpoint <= item.endTime]
        if containing:
            return min(containing, key=lambda item: item.endTime - item.startTime).id
        return min(
            result.classification.sections,
            key=lambda item: min(abs(midpoint - item.startTime), abs(midpoint - item.endTime)),
        ).id

    unresolved_ids = {item.id for item in unresolved_segments}
    runs: list[tuple[str, list[Any]]] = []
    current_section_id: str | None = None
    current_run: list[Any] = []
    previous_index: int | None = None
    for source_index, item in enumerate(result.segments):
        if item.id not in unresolved_ids:
            if current_run and current_section_id:
                runs.append((current_section_id, current_run))
            current_section_id, current_run, previous_index = None, [], None
            continue
        section_id = nearest_section_id(item.startTime, item.endTime)
        separated = previous_index is not None and (
            source_index != previous_index + 1
            or section_id != current_section_id
            or item.startTime - current_run[-1].endTime > 12.0
        )
        if separated and current_run and current_section_id:
            runs.append((current_section_id, current_run))
            current_run = []
        current_section_id = section_id
        current_run.append(item)
        previous_index = source_index
    if current_run and current_section_id:
        runs.append((current_section_id, current_run))

    for run_index, (source_section_id, run) in enumerate(runs, start=1):
        passage_id = f'{exam_id}-passage-unclassified-{run_index}'
        question_id = f'{exam_id}-unclassified-{run_index}'
        passages.append({
            'id': passage_id,
            'sectionId': section_ids[source_section_id],
            'title': f'未分类内容 {run_index}（待确认）',
            'audioAssetId': audio_id,
            'start': round(run[0].startTime, 3),
            'end': round(run[-1].endTime, 3),
            'segmentIds': [segment_ids[item.id] for item in run],
            'order': len(passages),
            'reviewStatus': 'unresolved',
            'sourceAnalysisId': result.analysisId,
            'reviewNote': '分类器无法可靠归入已识别材料，已保留原始文本和时间戳。',
        })
        questions.append({
            'id': question_id,
            'sectionId': section_ids[source_section_id],
            'passageId': passage_id,
            'number': f'未分类{run_index}（待确认）',
            'order': len(questions),
            'prompt': '此入口仅用于完整播放与逐句精听，不代表真实题号，也不包含推测答案。',
            'choicePresentation': 'audio',
            'reviewStatus': 'unresolved',
            'sourceAnalysisId': result.analysisId,
            'reviewNote': '自动分类无法判断，请在后续题库校对阶段确认。',
        })

    sections: list[dict[str, Any]] = []
    for index, item in enumerate(result.classification.sections):
        section_id = section_ids[item.id]
        section_passages = [passage for passage in passages if passage['sectionId'] == section_id]
        section_passages.sort(key=lambda passage: (passage['start'], passage['end']))
        for passage_order, passage in enumerate(section_passages):
            passage['order'] = passage_order
        section_question_ids = [question['id'] for question in questions if question['sectionId'] == section_id]
        for question_order, question_id in enumerate(section_question_ids):
            next(question for question in questions if question['id'] == question_id)['order'] = question_order
        sections.append({
            'id': section_ids[item.id],
            'examId': exam_id,
            'title': item.title,
            'type': _section_type(item.title),
            'order': index,
            'passageIds': [passage['id'] for passage in section_passages],
            'questionIds': section_question_ids,
            'reviewStatus': _status(item.status),
            'sourceAnalysisId': result.analysisId,
            'reviewNote': item.note,
        })

    segment_owner = {
        segment_id: passage['id']
        for passage in passages
        for segment_id in passage['segmentIds']
    }
    segments = [
        {
            'id': segment_ids[item.id],
            'passageId': segment_owner[segment_ids[item.id]],
            'start': round(item.startTime, 3),
            'end': round(item.endTime, 3),
            'text': item.text,
            'order': index,
            'reviewStatus': 'inferred',
            'sourceAnalysisId': result.analysisId,
        }
        for index, item in enumerate(result.segments)
        if segment_ids[item.id] in segment_owner
    ]
    for passage in passages:
        ordered = [segment for segment in segments if segment['passageId'] == passage['id']]
        ordered.sort(key=lambda segment: (segment['start'], segment['end']))
        for order, segment in enumerate(ordered):
            segment['order'] = order

    return {
        'schemaVersion': 3,
        'exam': {
            'id': exam_id,
            'title': f'{title_date}JLPT N1 听力（自动识别·待校对）',
            'level': 'N1',
            'year': year,
            'month': month if month in (7, 12) else None,
            'sectionIds': [section['id'] for section in sections],
            'audioAssetIds': [audio_id],
            'schemaVersion': 3,
            'source': 'imported',
            'installedAt': created_at,
            'reviewStatus': 'auto_draft',
            'sourceAnalysisId': result.analysisId,
            'sourcePackageVersion': BUILDER_VERSION,
        },
        'sections': sections,
        'passages': passages,
        'questions': questions,
        'segments': segments,
        'audioAssets': [{
            'id': audio_id,
            'name': audio.name,
            'mimeType': 'audio/mp4' if audio.suffix.lower() in {'.m4a', '.mp4'} else f'audio/{audio.suffix.lower().lstrip(".")}',
            'size': audio.stat().st_size,
            'duration': round(result.source.duration, 3),
            'storageMode': 'indexeddb',
            'availability': 'available',
        }],
    }


def write_exam_package(audio: Path, result: TranscriptionResult, package_root: Path) -> dict[str, Any]:
    package_root.mkdir(parents=True, exist_ok=True)
    fingerprint = _fingerprint(audio)
    package_id = fingerprint[:16].lower()
    package_path = package_root / f'{package_id}.jlpt.zip'
    for existing in list_prepared_packages(package_root.parent):
        if (
            existing.get('audioHash') == fingerprint
            and existing.get('analysisId') == result.analysisId
            and existing.get('builderVersion') == BUILDER_VERSION
            and existing.get('packageFile') == package_path.name
            and package_path.is_file()
        ):
            return {
                **existing,
                'status': 'ready',
                'message': existing.get('message') or '题库包已生成。',
                'updatedAt': _now(),
            }
    payload = build_exam_payload(audio, result, fingerprint)
    audio_id = payload['audioAssets'][0]['id']
    audio_path = f'audio/{audio_id}{audio.suffix.lower()}'
    manifest = {
        'format': PACKAGE_FORMAT,
        'version': 1,
        'builderVersion': BUILDER_VERSION,
        'exportedAt': _now(),
        'dataFile': 'exam.json',
        'audioFiles': {audio_id: audio_path},
    }
    temporary_package_path = package_root / f'{package_path.name}.tmp'
    try:
        with zipfile.ZipFile(temporary_package_path, 'w', allowZip64=True) as archive:
            archive.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2), compress_type=zipfile.ZIP_DEFLATED)
            archive.writestr('exam.json', json.dumps(payload, ensure_ascii=False, indent=2), compress_type=zipfile.ZIP_DEFLATED)
            archive.write(audio, audio_path, compress_type=zipfile.ZIP_STORED)
        temporary_package_path.replace(package_path)
    finally:
        temporary_package_path.unlink(missing_ok=True)
    return {
        'id': package_id,
        'examId': payload['exam']['id'],
        'examTitle': payload['exam']['title'],
        'fileName': audio.name,
        'audioHash': fingerprint,
        'audioSize': audio.stat().st_size,
        'duration': result.source.duration,
        'analysisId': result.analysisId,
        'builderVersion': BUILDER_VERSION,
        'packageFile': package_path.name,
        'packageSize': package_path.stat().st_size,
        'status': 'ready',
        'message': f'已生成：{len(payload["sections"])} 个大题、{len(payload["passages"])} 个材料、{len(payload["questions"])} 个练习入口、{len(payload["segments"])} 个句子。',
        'updatedAt': _now(),
    }


def _write_package_index(package_root: Path, resources: list[dict[str, Any]]) -> None:
    """Atomically publish a checkpoint so the learner can install completed exams immediately."""
    package_root.mkdir(parents=True, exist_ok=True)
    index_path = package_root / INDEX_FILE
    temporary_path = package_root / f'{INDEX_FILE}.tmp'
    temporary_path.write_text(json.dumps(resources, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary_path.replace(index_path)


def prepare_listen_resources(
    listen_root: Path,
    data_root: Path,
    model_size: str = 'small',
    transcribe_missing: bool = True,
) -> list[dict[str, Any]]:
    result_root = data_root / 'results'
    package_root = data_root / 'library_packages'
    model_root = data_root / 'models'
    result_root.mkdir(parents=True, exist_ok=True)
    package_root.mkdir(parents=True, exist_ok=True)
    audios = sorted(path for path in listen_root.rglob('*') if path.is_file() and path.suffix.lower() in AUDIO_EXTENSIONS)
    previous = {item.get('fileName'): item for item in list_prepared_packages(data_root) if isinstance(item.get('fileName'), str)}
    resources: list[dict[str, Any]] = []
    for position, audio in enumerate(audios, start=1):
        existing = previous.get(audio.name)
        package_file = existing.get('packageFile') if existing else None
        package_exists = isinstance(package_file, str) and (package_root / package_file).is_file()
        if existing and existing.get('status') == 'ready' and package_exists:
            resources.append({**existing, 'position': position, 'total': len(audios)})
        else:
            resources.append({
                'id': f'pending-{hashlib.sha256(str(audio).encode("utf-8")).hexdigest()[:16]}',
                'fileName': audio.name,
                'status': 'queued',
                'message': '等待本地转录。',
                'position': position,
                'total': len(audios),
                'updatedAt': _now(),
            })
    _write_package_index(package_root, resources)
    transcriber: WhisperTranscriber | None = None
    for index, audio in enumerate(audios):
        position = index + 1
        resources[index] = {
            **resources[index],
            'status': 'processing',
            'message': f'正在处理第 {position} / {len(audios)} 份音频。',
            'updatedAt': _now(),
        }
        _write_package_index(package_root, resources)
        try:
            duration = _probe_duration(audio)
            matching = _load_matching_result(result_root, audio, duration)
            if matching:
                result, _ = matching
            elif transcribe_missing:
                transcriber = transcriber or WhisperTranscriber(model_root)
                fingerprint = _fingerprint(audio)
                analysis_id = f'listen_{fingerprint[:24]}'
                print(f'[Listen] ({position}/{len(audios)}) 正在本地转录：{audio.name}', flush=True)
                result = transcriber.transcribe(
                    audio_path=audio,
                    original_name=audio.name,
                    model_size=model_size,
                    analysis_id=analysis_id,
                    progress=lambda _status, value, message, count: print(f'[Listen] {value:>6.1%} {message} ({count})', flush=True),
                    cancelled=lambda: False,
                )
                (result_root / f'{analysis_id}.json').write_text(result.model_dump_json(indent=2), encoding='utf-8')
            else:
                resources[index] = {
                    **resources[index],
                    'status': 'needs_analysis',
                    'message': '没有匹配的本地转录结果。',
                    'updatedAt': _now(),
                }
                _write_package_index(package_root, resources)
                continue
            print(f'[Listen] ({position}/{len(audios)}) 正在生成题库包：{audio.name}', flush=True)
            resources[index] = {
                **write_exam_package(audio, result, package_root),
                'position': position,
                'total': len(audios),
            }
        except Exception as error:  # Keep the remaining batch useful if one source file is damaged.
            print(f'[Listen] ({position}/{len(audios)}) 处理失败：{audio.name} — {error}', flush=True)
            resources[index] = {
                **resources[index],
                'status': 'failed',
                'message': f'处理失败：{error}',
                'updatedAt': _now(),
            }
        _write_package_index(package_root, resources)
    return resources


def list_prepared_packages(data_root: Path) -> list[dict[str, Any]]:
    index_path = data_root / 'library_packages' / INDEX_FILE
    if not index_path.exists():
        return []
    try:
        value = json.loads(index_path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return []
    return value if isinstance(value, list) else []
