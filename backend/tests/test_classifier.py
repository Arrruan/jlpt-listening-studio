from app.classifier import classify_jlpt_structure
from app.schemas import AssociationStatus, TranscriptSegment


def segment(identifier: str, start: float, end: float, text: str) -> TranscriptSegment:
    return TranscriptSegment(id=identifier, startTime=start, endTime=end, text=text)


def test_explicit_markers_are_confirmed_and_multi_question_passage_is_preserved() -> None:
    source = [
        segment("s1", 0, 2, "問題5では、長めの話を聞きます。"),
        segment("s2", 2, 3, "1番。"),
        segment("s3", 3, 8, "男の人と女の人が話しています。"),
        segment("s4", 8, 10, "質問1、二人は何をしますか。"),
        segment("s5", 10, 12, "質問2、女の人はどうしますか。"),
    ]
    result = classify_jlpt_structure(source)
    assert result.sections[0].status is AssociationStatus.confirmed
    assert result.passages[0].status is AssociationStatus.confirmed
    assert len(result.passages[0].questionIds) == 2
    assert {question.passageId for question in result.questions} == {result.passages[0].id}


def test_missing_markers_stay_unresolved_instead_of_inventing_structure() -> None:
    source = [segment("s1", 0, 3, "今日は会議について説明します。")]
    result = classify_jlpt_structure(source)
    assert result.sections[0].status is AssociationStatus.unresolved
    assert result.passages[0].status is AssociationStatus.unresolved
    assert result.questions == []


def test_ordinary_ichiban_phrase_is_not_an_item_boundary() -> None:
    source = [
        segment("s1", 0, 2, "問題1です。"),
        segment("s2", 2, 3, "1番。"),
        segment("s3", 3, 6, "女の人と男の人が話しています。"),
        segment("s4", 6, 10, "一番いいものを選びたいですね。"),
    ]

    result = classify_jlpt_structure(source)

    assert len(result.passages) == 1
    assert result.passages[0].title == "1番"


def test_repeated_section_cue_and_item_after_prompt_are_grouped() -> None:
    source = [
        segment("s1", 0, 1, "問題1。"),
        segment("s2", 2, 5, "問題1では、まず質問を聞いてください。"),
        segment("s3", 6, 8, "では始めます。1番"),
        segment("s4", 9, 12, "女の人と男の人が話しています。"),
        segment("s5", 13, 16, "男の人は何をしますか?"),
        segment("s6", 30, 33, "男の人は何をしますか?2番"),
        segment("s7", 34, 37, "先生と学生が話しています。"),
        segment("s8", 38, 41, "学生はどうしますか?"),
    ]

    result = classify_jlpt_structure(source)

    assert len(result.sections) == 1
    assert [passage.title for passage in result.passages] == ["1番", "2番"]
    assert len(result.questions) == 2
    assert result.questions[0].prompt == "男の人は何をしますか?"


def test_numbered_questions_attach_the_following_prompt() -> None:
    source = [
        segment("s1", 0, 1, "問題五。"),
        segment("s2", 2, 3, "一番。"),
        segment("s3", 4, 10, "二人が話しています。"),
        segment("s4", 20, 21, "質問1。"),
        segment("s5", 21, 24, "二人はどのコースに行きますか?"),
        segment("s6", 25, 26, "質問2。"),
        segment("s7", 26, 29, "女の人はどうしますか?"),
    ]

    result = classify_jlpt_structure(source)

    assert result.sections[0].title == "問題5"
    assert result.passages[0].title == "1番"
    assert [question.label for question in result.questions] == ["質問1", "質問2"]
    assert all(len(question.sourceSegmentIds) == 2 for question in result.questions)
    assert len(result.passages[0].questionIds) == 2


def test_skipped_item_number_marks_previous_boundary_as_inferred() -> None:
    source = [
        segment("s1", 0, 1, "問題2。"),
        segment("s2", 2, 3, "1番。"),
        segment("s3", 4, 8, "女の人が話しています。"),
        segment("s4", 9, 10, "3番。"),
        segment("s5", 11, 15, "男の人が話しています。"),
    ]

    result = classify_jlpt_structure(source)

    assert result.passages[0].status is AssociationStatus.inferred
    assert "跳号" in result.passages[0].note
    assert result.passages[1].status is AssociationStatus.confirmed
