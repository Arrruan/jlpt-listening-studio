from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from .schemas import TranscriptSegment, WordToken


STRONG_END_RE = re.compile(r"[。！？!?][」』】）)]*$")
WEAK_END_RE = re.compile(r"[、，,；;：:][」』】）)]*$")


@dataclass(frozen=True)
class RawWord:
    start: float
    end: float
    text: str
    probability: float | None = None
    raw_segment_index: int | None = None


def _stable_id(start: float, end: float, text: str) -> str:
    payload = f"{start:.2f}|{end:.2f}|{text}".encode("utf-8")
    return f"ai_segment_{hashlib.sha1(payload).hexdigest()[:14]}"


def _join_japanese(parts: list[str]) -> str:
    result = ""
    for part in parts:
        cleaned = part.strip()
        if not cleaned:
            continue
        if result and re.match(r"^[A-Za-z0-9]", cleaned) and re.search(r"[A-Za-z0-9]$", result):
            result += " "
        result += cleaned
    return result


def _to_segment(words: list[RawWord]) -> TranscriptSegment:
    text = _join_japanese([word.text for word in words])
    probabilities = [word.probability for word in words if word.probability is not None]
    confidence = sum(probabilities) / len(probabilities) if probabilities else None
    raw_indexes = sorted({word.raw_segment_index for word in words if word.raw_segment_index is not None})
    return TranscriptSegment(
        id=_stable_id(words[0].start, words[-1].end, text),
        startTime=round(words[0].start, 3),
        endTime=round(words[-1].end, 3),
        text=text,
        confidence=round(confidence, 4) if confidence is not None else None,
        words=[
            WordToken(
                startTime=round(word.start, 3),
                endTime=round(word.end, 3),
                text=word.text.strip(),
                probability=word.probability,
                rawSegmentIndex=word.raw_segment_index,
            )
            for word in words
        ],
        rawSegmentIndexes=raw_indexes,
    )


def segment_words(words: list[RawWord]) -> list[TranscriptSegment]:
    """Build sentence-like ranges from word timestamps, pauses and Japanese punctuation.

    Whisper segment borders are retained only as provenance. They are not treated as
    authoritative sentence boundaries.
    """
    usable = sorted((word for word in words if word.text.strip() and word.end > word.start), key=lambda word: word.start)
    if not usable:
        return []

    groups: list[list[RawWord]] = []
    current: list[RawWord] = []
    for index, word in enumerate(usable):
        current.append(word)
        next_word = usable[index + 1] if index + 1 < len(usable) else None
        text = _join_japanese([item.text for item in current])
        duration = current[-1].end - current[0].start
        gap = max(0.0, next_word.start - word.end) if next_word else float("inf")

        should_break = next_word is None
        should_break = should_break or bool(STRONG_END_RE.search(text))
        should_break = should_break or gap >= 0.78
        should_break = should_break or (bool(WEAK_END_RE.search(text)) and duration >= 4.0 and gap >= 0.18)
        should_break = should_break or (duration >= 11.5 and gap >= 0.28)
        should_break = should_break or duration >= 19.0
        if should_break:
            groups.append(current)
            current = []

    # A one-character breath fragment is usually better attached to its neighbour.
    merged: list[list[RawWord]] = []
    for group in groups:
        text = _join_japanese([item.text for item in group])
        duration = group[-1].end - group[0].start
        if merged and len(text) <= 2 and duration < 0.7 and not STRONG_END_RE.search(text):
            merged[-1].extend(group)
        else:
            merged.append(group)

    return [_to_segment(group) for group in merged if group]


def approximate_words_from_segment(
    text: str,
    start: float,
    end: float,
    raw_segment_index: int,
) -> list[RawWord]:
    """Fallback used only when Whisper omits word timestamps for a segment."""
    chunks = [chunk for chunk in re.split(r"(?<=[。！？!?])", text) if chunk.strip()]
    if not chunks:
        return []
    total_chars = max(1, sum(len(chunk.strip()) for chunk in chunks))
    cursor = start
    result: list[RawWord] = []
    for index, chunk in enumerate(chunks):
        ratio = len(chunk.strip()) / total_chars
        chunk_end = end if index == len(chunks) - 1 else cursor + (end - start) * ratio
        result.append(
            RawWord(
                start=cursor,
                end=max(cursor + 0.01, chunk_end),
                text=chunk,
                probability=None,
                raw_segment_index=raw_segment_index,
            )
        )
        cursor = chunk_end
    return result
