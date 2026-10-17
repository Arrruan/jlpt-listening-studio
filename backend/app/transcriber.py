from __future__ import annotations

import os
import threading
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .classifier import classify_jlpt_structure
from .schemas import SourceInfo, TranscriptionResult
from .segmentation import RawWord, approximate_words_from_segment, segment_words


ProgressCallback = Callable[[str, float, str, int], None]


class TranscriptionCancelled(Exception):
    pass


class WhisperTranscriber:
    def __init__(self, model_root: Path) -> None:
        self.model_root = model_root
        self.model_root.mkdir(parents=True, exist_ok=True)
        self._models: dict[str, Any] = {}
        self._model_lock = threading.Lock()

    @property
    def loaded_models(self) -> list[str]:
        return sorted(self._models)

    def _get_model(self, model_size: str, progress: ProgressCallback):
        if model_size in self._models:
            return self._models[model_size]
        progress("loading_model", 0.02, f"正在加载 {model_size} 模型；首次运行会从 Hugging Face 下载。", 0)
        with self._model_lock:
            if model_size in self._models:
                return self._models[model_size]
            from faster_whisper import WhisperModel

            configured_threads = os.getenv("JLPT_WHISPER_CPU_THREADS")
            default_threads = max(1, min(4, (os.cpu_count() or 4) // 2))
            cpu_threads = max(1, int(configured_threads)) if configured_threads else default_threads
            model = WhisperModel(
                model_size,
                device="cpu",
                compute_type="int8",
                cpu_threads=cpu_threads,
                num_workers=1,
                download_root=str(self.model_root),
            )
            self._models[model_size] = model
            return model

    def transcribe(
        self,
        audio_path: Path,
        original_name: str,
        model_size: str,
        analysis_id: str,
        progress: ProgressCallback,
        cancelled: Callable[[], bool],
    ) -> TranscriptionResult:
        model = self._get_model(model_size, progress)
        if cancelled():
            raise TranscriptionCancelled()

        progress("transcribing", 0.04, "正在进行日语转录与词级时间戳分析。", 0)
        raw_segments, info = model.transcribe(
            str(audio_path),
            language="ja",
            beam_size=5,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 350},
            condition_on_previous_text=True,
        )

        words: list[RawWord] = []
        processed = 0
        duration = float(getattr(info, "duration", 0) or 0)
        for raw_index, raw_segment in enumerate(raw_segments):
            if cancelled():
                raise TranscriptionCancelled()
            raw_words = list(getattr(raw_segment, "words", None) or [])
            if raw_words:
                for word in raw_words:
                    if word.start is None or word.end is None:
                        continue
                    words.append(
                        RawWord(
                            start=float(word.start),
                            end=float(word.end),
                            text=str(word.word),
                            probability=float(word.probability) if word.probability is not None else None,
                            raw_segment_index=raw_index,
                        )
                    )
            else:
                words.extend(
                    approximate_words_from_segment(
                        str(raw_segment.text),
                        float(raw_segment.start),
                        float(raw_segment.end),
                        raw_index,
                    )
                )
            processed = raw_index + 1
            if duration > 0:
                fraction = min(0.9, max(0.04, float(raw_segment.end) / duration * 0.88))
                progress("transcribing", fraction, f"已分析到 {float(raw_segment.end):.1f} / {duration:.1f} 秒。", processed)

        progress("classifying", 0.92, "正在结合停顿、标点和 JLPT 提示语重新断句并分类。", processed)
        sentence_segments = segment_words(words)
        classification = classify_jlpt_structure(sentence_segments)
        progress("classifying", 0.98, "分类完成，正在保存原始时间戳与建议结构。", len(sentence_segments))

        detected_language = str(getattr(info, "language", "ja") or "ja")
        probability = getattr(info, "language_probability", None)
        return TranscriptionResult(
            analysisId=analysis_id,
            createdAt=datetime.now(UTC).isoformat(),
            source=SourceInfo(
                fileName=original_name,
                duration=duration,
                detectedLanguage=detected_language,
                languageProbability=float(probability) if probability is not None else None,
                modelSize=model_size,
            ),
            segments=sentence_segments,
            classification=classification,
        )
