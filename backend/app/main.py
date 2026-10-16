from __future__ import annotations

import importlib.metadata
import platform
import re
import shutil
import uuid
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .jobs import JobManager
from .schemas import HealthResponse, JobSnapshot, TranscriptionResult


BACKEND_ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = BACKEND_ROOT / "data"
ALLOWED_EXTENSIONS = {".mp3", ".m4a", ".mp4", ".wav", ".flac", ".ogg", ".webm"}
MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024

manager = JobManager(DATA_ROOT)
app = FastAPI(
    title="JLPT Listening Studio Local AI",
    version="2.0.0",
    description="Local-only faster-whisper transcription and conservative JLPT structure suggestions.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_origin_regex=r"^http://192\.168\.\d{1,3}\.\d{1,3}:5173$",
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)


def _version(package: str) -> str | None:
    try:
        return importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        return None


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        python=platform.python_version(),
        fasterWhisper=_version("faster-whisper"),
        ctranslate2=_version("ctranslate2"),
        modelsLoaded=manager.transcriber.loaded_models,
    )


@app.post("/api/transcriptions", response_model=JobSnapshot, status_code=202)
def create_transcription(
    file: Annotated[UploadFile, File(description="Complete JLPT listening audio")],
    model_size: Annotated[Literal["small", "medium"], Form()] = "small",
) -> JobSnapshot:
    original_name = Path(file.filename or "audio.m4a").name
    extension = Path(original_name).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Unsupported audio extension")

    safe_stem = re.sub(r"[^A-Za-z0-9_-]+", "_", Path(original_name).stem)[:60] or "audio"
    upload_path = manager.upload_root / f"pending_{uuid.uuid4().hex}_{safe_stem}{extension}"
    size = 0
    try:
        with upload_path.open("wb") as target:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Audio exceeds 2 GB local upload limit")
                target.write(chunk)
    except Exception:
        upload_path.unlink(missing_ok=True)
        raise
    finally:
        file.file.close()

    return manager.create_job(upload_path, original_name, model_size)


@app.get("/api/transcriptions/{job_id}", response_model=JobSnapshot)
def get_transcription(job_id: str) -> JobSnapshot:
    try:
        return manager.snapshot(job_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Unknown transcription job") from error


@app.get("/api/transcriptions/{job_id}/result", response_model=TranscriptionResult)
def get_transcription_result(job_id: str) -> TranscriptionResult:
    try:
        return manager.result(job_id)
    except KeyError as error:
        raise HTTPException(status_code=409, detail="Transcription result is not ready") from error


@app.delete("/api/transcriptions/{job_id}", response_model=JobSnapshot)
def cancel_transcription(job_id: str) -> JobSnapshot:
    try:
        return manager.cancel(job_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Unknown transcription job") from error
