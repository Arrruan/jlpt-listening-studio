import type {
  AnswerRecord,
  ExamPackagePayload,
  LibraryQuestion,
  LibraryState,
} from '../library/types'

export const orderedExamQuestions = (state: LibraryState, examId: string): LibraryQuestion[] => {
  const exam = state.exams[examId]
  if (!exam) return []
  return exam.sectionIds
    .map((id) => state.sections[id])
    .filter(Boolean)
    .sort((left, right) => left.order - right.order)
    .flatMap((section) => section.questionIds
      .map((id) => state.questions[id])
      .filter(Boolean)
      .sort((left, right) => left.order - right.order))
}

export const audioAssetIdForQuestion = (state: LibraryState, questionId?: string) => {
  if (!questionId) return undefined
  const question = state.questions[questionId]
  return question ? state.passages[question.passageId]?.audioAssetId : undefined
}

export const selectQuestion = (state: LibraryState, questionId: string) => {
  const question = state.questions[questionId]
  if (!question) throw new Error('题目不存在。')
  const section = state.sections[question.sectionId]
  if (!section) throw new Error('题目所属大题不存在。')
  const previousQuestionId = state.navigation.questionId
  const previousPassageId = previousQuestionId ? state.questions[previousQuestionId]?.passageId : undefined
  const shouldReloadAudio = audioAssetIdForQuestion(state, previousQuestionId) !== audioAssetIdForQuestion(state, questionId)
  const timestamp = new Date().toISOString()
  return {
    shouldReloadAudio,
    passageChanged: previousPassageId !== question.passageId,
    state: {
      ...state,
      learning: {
        ...state.learning,
        [section.examId]: {
          examId: section.examId,
          answers: state.learning[section.examId]?.answers ?? {},
          activeQuestionId: questionId,
          updatedAt: timestamp,
        },
      },
      navigation: {
        ...state.navigation,
        screen: 'practice' as const,
        examId: section.examId,
        questionId,
        intensiveReturnQuestionId: undefined,
      },
    },
  }
}

export const openExam = (state: LibraryState, examId: string): LibraryState => {
  const exam = state.exams[examId]
  if (!exam) throw new Error('试卷不存在。')
  const questions = orderedExamQuestions(state, examId)
  const storedQuestionId = state.learning[examId]?.activeQuestionId
  const questionId = storedQuestionId && state.questions[storedQuestionId]
    ? storedQuestionId
    : questions[0]?.id
  if (!questionId) throw new Error('这套试卷没有可练习的题目。')
  return selectQuestion({
    ...state,
    navigation: { ...state.navigation, questionId: undefined },
  }, questionId).state
}

export const answerQuestion = (
  state: LibraryState,
  examId: string,
  questionId: string,
  choiceId: string,
  answeredAt = new Date().toISOString(),
): LibraryState => {
  const question = state.questions[questionId]
  if (!question || question.sectionId !== state.sections[question.sectionId]?.id) throw new Error('题目不存在。')
  if (!question.choices?.some((choice) => choice.id === choiceId)) throw new Error('选项不存在。')
  const previous = state.learning[examId]
  const record: AnswerRecord = {
    questionId,
    selectedChoiceId: choiceId,
    answeredAt,
    answerRevealedAt: previous?.answers[questionId]?.answerRevealedAt,
  }
  return {
    ...state,
    learning: {
      ...state.learning,
      [examId]: {
        examId,
        activeQuestionId: questionId,
        answers: { ...(previous?.answers ?? {}), [questionId]: record },
        updatedAt: answeredAt,
      },
    },
  }
}

export const revealAnswer = (
  state: LibraryState,
  examId: string,
  questionId: string,
  revealedAt = new Date().toISOString(),
): LibraryState => {
  const question = state.questions[questionId]
  if (!question?.correctAnswer) throw new Error('本题没有已核实的标准答案。')
  const previous = state.learning[examId]
  const selected = previous?.answers[questionId]?.selectedChoiceId ?? ''
  return {
    ...state,
    learning: {
      ...state.learning,
      [examId]: {
        examId,
        activeQuestionId: questionId,
        answers: {
          ...(previous?.answers ?? {}),
          [questionId]: {
            questionId,
            selectedChoiceId: selected,
            answeredAt: previous?.answers[questionId]?.answeredAt ?? revealedAt,
            answerRevealedAt: revealedAt,
          },
        },
        updatedAt: revealedAt,
      },
    },
  }
}

export const clearExamAnswers = (state: LibraryState, examId: string): LibraryState => ({
  ...state,
  learning: {
    ...state.learning,
    [examId]: {
      examId,
      activeQuestionId: state.learning[examId]?.activeQuestionId,
      answers: {},
      updatedAt: new Date().toISOString(),
    },
  },
})

export const enterIntensive = (state: LibraryState): LibraryState => {
  const questionId = state.navigation.questionId
  if (!questionId || !state.questions[questionId]) throw new Error('请先选择题目。')
  return {
    ...state,
    navigation: {
      ...state.navigation,
      screen: 'intensive',
      intensiveReturnQuestionId: questionId,
    },
  }
}

export const leaveIntensive = (state: LibraryState): LibraryState => {
  const questionId = state.navigation.intensiveReturnQuestionId ?? state.navigation.questionId
  return {
    ...state,
    navigation: {
      ...state.navigation,
      screen: 'practice',
      questionId,
      intensiveReturnQuestionId: undefined,
    },
  }
}

const foreignCollision = (record: Record<string, unknown>, ids: string[], allowed: Set<string>) =>
  ids.find((id) => record[id] && !allowed.has(id))

export const installExamPackage = (state: LibraryState, payload: ExamPackagePayload): LibraryState => {
  const existingExam = state.exams[payload.exam.id]
  const oldSectionIds = new Set(existingExam?.sectionIds ?? [])
  const oldPassageIds = new Set(Object.values(state.passages).filter((item) => oldSectionIds.has(item.sectionId)).map((item) => item.id))
  const oldQuestionIds = new Set(Object.values(state.questions).filter((item) => oldSectionIds.has(item.sectionId)).map((item) => item.id))
  const oldSegmentIds = new Set(Object.values(state.segments).filter((item) => oldPassageIds.has(item.passageId)).map((item) => item.id))
  const oldAssetIds = new Set(existingExam?.audioAssetIds ?? [])

  const collisions = [
    foreignCollision(state.sections, payload.sections.map((item) => item.id), oldSectionIds),
    foreignCollision(state.passages, payload.passages.map((item) => item.id), oldPassageIds),
    foreignCollision(state.questions, payload.questions.map((item) => item.id), oldQuestionIds),
    foreignCollision(state.segments, payload.segments.map((item) => item.id), oldSegmentIds),
    foreignCollision(state.audioAssets, payload.audioAssets.map((item) => item.id), oldAssetIds),
  ].find(Boolean)
  if (collisions) throw new Error(`题库包 ID 与另一套试卷冲突：${collisions}`)

  const without = <T>(record: Record<string, T>, ids: Set<string>) =>
    Object.fromEntries(Object.entries(record).filter(([id]) => !ids.has(id))) as Record<string, T>
  const firstQuestionId = [...payload.sections]
    .sort((left, right) => left.order - right.order)
    .flatMap((section) => section.questionIds)[0]
  const nextQuestionMap = Object.fromEntries(payload.questions.map((item) => [item.id, item]))
  const previousLearning = state.learning[payload.exam.id]
  const preservedAnswers = Object.fromEntries(
    Object.entries(previousLearning?.answers ?? {}).filter(([questionId, answer]) => {
      const nextQuestion = nextQuestionMap[questionId]
      return Boolean(nextQuestion) && (!answer.selectedChoiceId || nextQuestion.choices?.some((choice) => choice.id === answer.selectedChoiceId))
    }),
  )
  return {
    ...state,
    exams: { ...state.exams, [payload.exam.id]: payload.exam },
    sections: { ...without(state.sections, oldSectionIds), ...Object.fromEntries(payload.sections.map((item) => [item.id, item])) },
    passages: { ...without(state.passages, oldPassageIds), ...Object.fromEntries(payload.passages.map((item) => [item.id, item])) },
    questions: { ...without(state.questions, oldQuestionIds), ...nextQuestionMap },
    segments: { ...without(state.segments, oldSegmentIds), ...Object.fromEntries(payload.segments.map((item) => [item.id, item])) },
    audioAssets: { ...without(state.audioAssets, oldAssetIds), ...Object.fromEntries(payload.audioAssets.map((item) => [item.id, item])) },
    learning: {
      ...state.learning,
      [payload.exam.id]: existingExam
        ? {
            examId: payload.exam.id,
            activeQuestionId: previousLearning?.activeQuestionId && nextQuestionMap[previousLearning.activeQuestionId]
              ? previousLearning.activeQuestionId
              : firstQuestionId,
            answers: preservedAnswers,
            updatedAt: previousLearning?.updatedAt ?? payload.exam.installedAt,
          }
        : { examId: payload.exam.id, activeQuestionId: firstQuestionId, answers: {}, updatedAt: payload.exam.installedAt },
    },
  }
}
