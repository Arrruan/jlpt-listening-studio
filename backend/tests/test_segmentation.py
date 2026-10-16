from app.segmentation import RawWord, approximate_words_from_segment, segment_words


def test_sentence_boundaries_use_punctuation_and_pause() -> None:
    words = [
        RawWord(0.0, 0.4, "今日は", 0.9, 0),
        RawWord(0.4, 0.9, "雨です。", 0.8, 0),
        RawWord(1.0, 1.4, "傘を", 0.9, 0),
        RawWord(1.4, 1.9, "持って", 0.9, 1),
        RawWord(2.9, 3.3, "行きます", 0.8, 1),
    ]
    result = segment_words(words)
    assert [segment.text for segment in result] == ["今日は雨です。", "傘を持って", "行きます"]
    assert result[0].startTime == 0.0
    assert result[0].endTime == 0.9


def test_long_segment_breaks_on_soft_pause() -> None:
    words = [RawWord(index * 1.0, index * 1.0 + 0.5, f"語{index}", 0.8, 0) for index in range(14)]
    result = segment_words(words)
    assert len(result) >= 2


def test_missing_word_timestamps_fall_back_to_punctuation() -> None:
    words = approximate_words_from_segment("一文目です。二文目です。", 3.0, 7.0, 2)
    result = segment_words(words)
    assert len(result) == 2
    assert result[0].startTime == 3.0
    assert result[-1].endTime == 7.0
