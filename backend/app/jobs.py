from __future__ import annotations

import json
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from .schemas import JobSnapshot, TranscriptionResult
from .transcriber import TranscriptionCancelled, WhisperTranscriber


def _now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass
class JobRecord:
    id: str
    file_name: str
    model_size: str
    upload_path: Path
    created_at: str
    updated_at: str
    status: str = "queued"
    progress: float = 0
    message: str = "等待本地 CPU 分析。"
    error: str | None = None
    segment_count: int = 0
    result: TranscriptionResult | None = None
    cancel_event: threading.Event = field(default_factory=threading.Event)


class JobManager:
    def __init__(self, data_root: Path) -> None:
        self.upload_root = data_root / "uploads"
        self.result_root = data_root / "results"
        self.model_root = data_root / "models"
        for path in (self.upload_root, self.result_root, self.model_root):
            path.mkdir(parents=True, exist_ok=True)
        self.transcriber = WhisperTranscriber(self.model_root)
        self._jobs: dict[str, JobRecord] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="whisper-cpu")

    def create_job(self, upload_path: Path, file_name: str, model_size: str) -> JobSnapshot:
        job_id = uuid.uuid4().hex
        timestamp = _now()
        record = JobRecord(
            id=job_id,
            file_name=file_name,
            model_size=model_size,
            upload_path=upload_path,
            created_at=timestamp,
            updated_at=timestamp,
        )
        with self._lock:
            self._jobs[job_id] = record
        self._executor.submit(self._run, job_id)
        return self.snapshot(job_id)

    def _update(self, job_id: str, status: str, progress: float, message: str, segment_count: int) -> None:
        with self._lock:
            job = self._jobs[job_id]
            job.status = status
            job.progress = round(max(0, min(1, progress)), 4)
            job.message = message
            job.segment_count = segment_count
            job.updated_at = _now()

    def _run(self, job_id: str) -> None:
        with self._lock:
            job = self._jobs[job_id]
        try:
            result = self.transcriber.transcribe(
                audio_path=job.upload_path,
                original_name=job.file_name,
                model_size=job.model_size,
                analysis_id=job.id,
                progress=lambda status, value, message, count: self._update(job_id, status, value, message, count),
                cancelled=job.cancel_event.is_set,
            )
            with self._lock:
                job.result = result
                job.status = "completed"
                job.progress = 1
                job.message = f"完成：{len(result.segments)} 个句子区间。"
                job.segment_count = len(result.segments)
                job.updated_at = _now()
            result_path = self.result_root / f"{job.id}.json"
            result_path.write_text(result.model_dump_json(indent=2), encoding="utf-8")
        except TranscriptionCancelled:
            self._update(job_id, "cancelled", job.progress, "任务已取消。", job.segment_count)
        except Exception as error:  # The job status must retain model/runtime failures for the UI.
            with self._lock:
                job.status = "failed"
                job.error = f"{type(error).__name__}: {error}"
                job.message = "转录失败；原音频和前端人工数据未被修改。"
                job.updated_at = _now()
        finally:
            try:
                job.upload_path.unlink(missing_ok=True)
            except OSError:
                pass

    def snapshot(self, job_id: str) -> JobSnapshot:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                raise KeyError(job_id)
            return JobSnapshot(
                id=job.id,
                status=job.status,
                progress=job.progress,
                message=job.message,
                modelSize=job.model_size,
                fileName=job.file_name,
                createdAt=job.created_at,
                updatedAt=job.updated_at,
                error=job.error,
                segmentCount=job.segment_count,
            )

    def result(self, job_id: str) -> TranscriptionResult:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job or not job.result:
                raise KeyError(job_id)
            return job.result

    def cancel(self, job_id: str) -> JobSnapshot:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                raise KeyError(job_id)
            job.cancel_event.set()
            if job.status == "queued":
                job.status = "cancelled"
                job.message = "任务已取消。"
                job.updated_at = _now()
        return self.snapshot(job_id)
