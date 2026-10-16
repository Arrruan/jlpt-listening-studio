from __future__ import annotations

import re
from difflib import SequenceMatcher

from .schemas import (
    AssociationStatus,
    ClassificationResult,
    PassageSuggestion,
    QuestionSuggestion,
    SectionSuggestion,
    SegmentRole,
    TranscriptSegment,
)


SECTION_RE = re.compile(r"問題\s*([0-9０-９一二三四五六七八九十]+)")
# Require a cue boundary after 番. This deliberately avoids treating ordinary
# phrases such as 「一番いいもの」 as the start of a new listening item.
ITEM_RE = re.compile(r"(?:^|[。！？!?]\s*)(?:第)?([0-9０-９一二三四五六七八九十]+)番(?:[、，,.。！？!?\s]|$)")
QUESTION_NUMBER_RE = re.compile(r"質問\s*([0-9０-９一二三四五六七八九十]+)")
PASSAGE_INTRO_RE = re.compile(r"(?:男の人|女の人|先生|学生|二人|アナウンサー).{0,18}(?:話して|話を|会話|スピーチ|説明)")
QUESTION_RE = re.compile(
    r"(?:何|どれ|どの|どう|なぜ|いつ|どこ|だれ|誰).{0,38}"
    r"(?:ですか|ますか|ませんか|ましたか|でしょうか)[。！？!?]?"
)
EXPLANATION_RE = re.compile(r"(?:解説|正解|答えは|ポイントは)")


def _number_label(value: str) -> str:
    normalized = value.translate(str.maketrans("０１２３４５６７８９", "0123456789"))
    if normalized.isdigit():
        return normalized
    digits = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
    if normalized == "十":
        return "10"
    if "十" in normalized:
        tens, ones = normalized.split("十", 1)
        value_number = (digits.get(tens, 1) * 10) + digits.get(ones, 0)
        return str(value_number)
    return str(digits.get(normalized, normalized))


def _set_role(segment: TranscriptSegment) -> SegmentRole:
    text = segment.text
    if SECTION_RE.search(text):
        return SegmentRole.section_cue
    if ITEM_RE.search(text):
        return SegmentRole.item_cue
    if EXPLANATION_RE.search(text):
        return SegmentRole.explanation
    if QUESTION_RE.search(text) or QUESTION_NUMBER_RE.search(text):
        return SegmentRole.question_prompt
    if PASSAGE_INTRO_RE.search(text):
        return SegmentRole.passage_intro
    if re.search(r"(?:です|ます|だ|よ|ね|けど|から)[。！？!?]?$", text):
        return SegmentRole.dialogue
    return SegmentRole.unknown


def _normalized_question(text: str) -> str:
    return re.sub(r"[\s、，,.。！？!?・「」『』（）()]", "", text)


def _question_groups(passage_segments: list[TranscriptSegment]) -> list[tuple[list[TranscriptSegment], str | None]]:
    """Return conservative question groups, joining repeated or numbered prompts."""
    explicit: list[tuple[list[TranscriptSegment], str | None]] = []
    consumed_ids: set[str] = set()
    for index, segment in enumerate(passage_segments):
        number_match = QUESTION_NUMBER_RE.search(segment.text)
        if not number_match:
            continue
        label = _number_label(number_match.group(1))
        group = [segment]
        if index + 1 < len(passage_segments) and QUESTION_RE.search(passage_segments[index + 1].text):
            group.append(passage_segments[index + 1])
        consumed_ids.update(item.id for item in group)
        explicit.append((group, label))

    fuzzy_groups: list[list[TranscriptSegment]] = []
    for segment in passage_segments:
        if segment.id in consumed_ids or not QUESTION_RE.search(segment.text):
            continue
        normalized = _normalized_question(segment.text)
        matching_group = next(
            (
                group
                for group in fuzzy_groups
                if SequenceMatcher(None, normalized, _normalized_question(group[0].text)).ratio() >= 0.72
            ),
            None,
        )
        if matching_group is None:
            fuzzy_groups.append([segment])
        else:
            matching_group.append(segment)

    if not fuzzy_groups:
        return explicit

    passage_start = passage_segments[0].startTime
    passage_end = passage_segments[-1].endTime

    def candidate_score(group: list[TranscriptSegment]) -> float:
        repeated_bonus = 100 if len(group) >= 2 else 0
        distance_from_start = min(item.startTime - passage_start for item in group)
        distance_from_end = min(passage_end - item.endTime for item in group)
        boundary_bonus = max(0, 35 - distance_from_start) + max(0, 65 - distance_from_end)
        return repeated_bonus + boundary_bonus

    best_group = max(fuzzy_groups, key=candidate_score)
    if len(best_group) >= 2 or candidate_score(best_group) > 0:
        explicit.append((best_group, None))
    return explicit


def classify_jlpt_structure(segments: list[TranscriptSegment]) -> ClassificationResult:
    if not segments:
        return ClassificationResult(
            sections=[],
            passages=[],
            questions=[],
            unassignedSegmentIds=[],
            warnings=["没有可分类的转录句子。"],
        )

    for segment in segments:
        segment.role = _set_role(segment)

    section_starts: list[tuple[int, str, AssociationStatus]] = []
    for index, segment in enumerate(segments):
        match = SECTION_RE.search(segment.text)
        if match:
            title = f"問題{_number_label(match.group(1))}"
            if section_starts:
                previous_index, previous_title, _ = section_starts[-1]
                if previous_title == title and segment.startTime - segments[previous_index].startTime <= 30:
                    continue
            section_starts.append((index, title, AssociationStatus.confirmed))
    if not section_starts:
        section_starts = [(0, "大题（待确认）", AssociationStatus.unresolved)]

    sections: list[SectionSuggestion] = []
    passages: list[PassageSuggestion] = []
    questions: list[QuestionSuggestion] = []
    assigned: set[str] = set()

    for section_order, (section_index, title, section_status) in enumerate(section_starts):
        next_section_index = section_starts[section_order + 1][0] if section_order + 1 < len(section_starts) else len(segments)
        section_segments = segments[section_index:next_section_index]
        section_id = f"ai_section_{section_order + 1}"
        section = SectionSuggestion(
            id=section_id,
            title=title,
            startTime=section_segments[0].startTime,
            endTime=section_segments[-1].endTime,
            sourceSegmentIds=[section_segments[0].id],
            status=section_status,
            confidence=0.98 if section_status is AssociationStatus.confirmed else 0.25,
            note="检测到音频中明确读出的問題编号。" if section_status is AssociationStatus.confirmed else "未读出明确大题编号，范围需要人工确认。",
        )
        sections.append(section)

        passage_starts: list[tuple[int, str, AssociationStatus]] = []
        for local_index, segment in enumerate(section_segments):
            item_match = ITEM_RE.search(segment.text)
            if item_match:
                passage_starts.append((local_index, f"{_number_label(item_match.group(1))}番", AssociationStatus.confirmed))
            elif PASSAGE_INTRO_RE.search(segment.text) and not passage_starts:
                passage_starts.append((local_index, "听力材料（推测）", AssociationStatus.inferred))
        if not passage_starts:
            passage_starts = [(0, "听力材料（待确认）", AssociationStatus.unresolved)]

        for passage_order, (passage_index, passage_title, passage_status) in enumerate(passage_starts):
            next_passage_index = passage_starts[passage_order + 1][0] if passage_order + 1 < len(passage_starts) else len(section_segments)
            passage_segments = section_segments[passage_index:next_passage_index]
            if not passage_segments:
                continue
            has_number_gap = False
            if passage_order + 1 < len(passage_starts):
                current_number = re.match(r"(\d+)番", passage_title)
                next_number = re.match(r"(\d+)番", passage_starts[passage_order + 1][1])
                has_number_gap = bool(
                    current_number
                    and next_number
                    and int(next_number.group(1)) > int(current_number.group(1)) + 1
                )
            effective_status = (
                AssociationStatus.inferred
                if has_number_gap and passage_status is AssociationStatus.confirmed
                else passage_status
            )
            passage_id = f"{section_id}_passage_{passage_order + 1}"
            passage = PassageSuggestion(
                id=passage_id,
                sectionId=section_id,
                title=passage_title,
                startTime=passage_segments[0].startTime,
                endTime=passage_segments[-1].endTime,
                sourceSegmentIds=[segment.id for segment in passage_segments],
                status=effective_status,
                confidence=0.55 if has_number_gap else 0.95 if effective_status is AssociationStatus.confirmed else 0.62 if effective_status is AssociationStatus.inferred else 0.2,
                note=(
                    "后续题号发生跳号，本材料终点可能包含未识别出的中间材料，必须人工确认。"
                    if has_number_gap
                    else
                    "检测到音频中明确读出的题号。"
                    if effective_status is AssociationStatus.confirmed
                    else "根据材料引导语推测边界。" if effective_status is AssociationStatus.inferred
                    else "没有可靠题号或引导语，整段暂归为一个待确认材料。"
                ),
            )
            passages.append(passage)
            assigned.update(passage.sourceSegmentIds)

            for question_order, (prompt_segments, explicit_number) in enumerate(_question_groups(passage_segments), start=1):
                explicit_prompt = explicit_number is not None
                prompt_segment = prompt_segments[-1]
                label = f"質問{explicit_number}" if explicit_prompt else f"Q{question_order}"
                question_id = f"{passage_id}_question_{question_order}"
                question = QuestionSuggestion(
                    id=question_id,
                    passageId=passage_id,
                    label=label,
                    prompt=prompt_segment.text,
                    startTime=min(item.startTime for item in prompt_segments),
                    endTime=max(item.endTime for item in prompt_segments),
                    sourceSegmentIds=[item.id for item in prompt_segments],
                    status=AssociationStatus.confirmed if explicit_prompt else AssociationStatus.inferred,
                    confidence=0.96 if explicit_prompt else 0.78 if len(prompt_segments) >= 2 else 0.62,
                    note=(
                        "检测到明确的質問编号，并关联紧随其后的题干；同一材料可保留多个小题。"
                        if explicit_prompt
                        else "根据重复题干或材料边界附近的疑问句推测，需人工确认。"
                    ),
                )
                questions.append(question)
                passage.questionIds.append(question_id)

    return ClassificationResult(
        sections=sections,
        passages=passages,
        questions=questions,
        unassignedSegmentIds=[segment.id for segment in segments if segment.id not in assigned],
        warnings=[
            "分类只使用音频中实际转录出的提示语；未读出的题号、选项和答案不会生成。",
            "题号序列跳号时，相邻材料边界会降级为“推测关联”，不会补造缺失题号。",
            "“推测关联”和“无法判断”的范围必须由人工确认，原始时间戳始终保留。",
        ],
    )
