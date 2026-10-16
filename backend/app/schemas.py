from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class AssociationStatus(str, Enum):
    confirmed = "confirmed"
    inferred = "inferred"
    unresolved = "unresolved"


class SegmentRole(str, Enum):
    section_cue = "section_cue"
    item_cue = "item_cue"
    passage_intro = "passage_intro"
    question_prompt = "question_prompt"
    dialogue = "dialogue"
    explanation = "explanation"
    unknown = "unknown"


class WordToken(BaseModel):
    startTime: float
    endTime: float
    text: str
    probability: float | None = None
    rawSegmentIndex: int | None = None


class TranscriptSegment(BaseModel):
    id: str
    startTime: float
    endTime: float
    text: str
    confidence: float | None = None
    words: list[WordToken] = Field(default_factory=list)
    rawSegmentIndexes: list[int] = Field(default_factory=list)
    role: SegmentRole = SegmentRole.unknown


class SectionSuggestion(BaseModel):
    id: str
    title: str
    startTime: float
    endTime: float
    sourceSegmentIds: list[str]
    status: AssociationStatus
    confidence: float
    note: str


class PassageSuggestion(BaseModel):
    id: str
    sectionId: str
    title: str
    startTime: float
    endTime: float
    sourceSegmentIds: list[str]
    questionIds: list[str] = Field(default_factory=list)
    status: AssociationStatus
    confidence: float
    note: str


class QuestionSuggestion(BaseModel):
    id: str
    passageId: str
    label: str
    prompt: str
    startTime: float
    endTime: float
    sourceSegmentIds: list[str]
    status: AssociationStatus
    confidence: float
    note: str


class ClassificationResult(BaseModel):
    sections: list[SectionSuggestion]
    passages: list[PassageSuggestion]
    questions: list[QuestionSuggestion]
    unassignedSegmentIds: list[str]
    warnings: list[str]


class SourceInfo(BaseModel):
    fileName: str
    duration: float
    detectedLanguage: str
    languageProbability: float | None = None
    modelSize: Literal["small", "medium"]
    device: Literal["cpu"] = "cpu"
    computeType: Literal["int8"] = "int8"


class TranscriptionResult(BaseModel):
    schemaVersion: Literal[1] = 1
    analysisId: str
    createdAt: str
    source: SourceInfo
    segments: list[TranscriptSegment]
    classification: ClassificationResult


class JobSnapshot(BaseModel):
    id: str
    status: Literal[
        "queued",
        "loading_model",
        "transcribing",
        "classifying",
        "completed",
        "failed",
        "cancelled",
    ]
    progress: float = 0
    message: str
    modelSize: Literal["small", "medium"]
    fileName: str
    createdAt: str
    updatedAt: str
    error: str | None = None
    segmentCount: int = 0


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    python: str
    fasterWhisper: str | None
    ctranslate2: str | None
    modelsLoaded: list[str]
