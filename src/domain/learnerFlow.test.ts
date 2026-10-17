import { describe, expect, it } from 'vitest'
import { createInitialLibrary } from '../library/demoData'
import {
  answerQuestion,
  clearExamAnswers,
  enterIntensive,
  leaveIntensive,
  openExam,
  orderedExamQuestions,
  revealAnswer,
  selectQuestion,
} from './learnerFlow'

describe('学习模式核心流程', () => {
  it('按大题顺序列出题目，并让第18与19题共用同一材料', () => {
    const state = createInitialLibrary()
    const questions = orderedExamQuestions(state, 'demo-n1-learning-flow')

    expect(questions.map((item) => item.number)).toEqual(['1', '18', '19'])
    expect(questions[1].passageId).toBe(questions[2].passageId)
    expect(state.passages[questions[1].passageId].segmentIds).toHaveLength(4)
  })

  it('共享 Passage 的题目切换不要求重载音频，也不会破坏各自答案', () => {
    let state = openExam(createInitialLibrary(), 'demo-n1-learning-flow')
    state = selectQuestion(state, 'demo-question-18').state
    state = answerQuestion(state, 'demo-n1-learning-flow', 'demo-question-18', 'demo-q18-2', '2026-10-16T01:00:00Z')

    const transition = selectQuestion(state, 'demo-question-19')
    state = answerQuestion(transition.state, 'demo-n1-learning-flow', 'demo-question-19', 'demo-q19-4', '2026-10-16T01:01:00Z')

    expect(transition.shouldReloadAudio).toBe(false)
    expect(transition.passageChanged).toBe(false)
    expect(state.learning['demo-n1-learning-flow'].answers['demo-question-18'].selectedChoiceId).toBe('demo-q18-2')
    expect(state.learning['demo-n1-learning-flow'].answers['demo-question-19'].selectedChoiceId).toBe('demo-q19-4')
  })

  it('从第18题进入精听后返回同一题，并保留选择', () => {
    let state = openExam(createInitialLibrary(), 'demo-n1-learning-flow')
    state = selectQuestion(state, 'demo-question-18').state
    state = answerQuestion(state, 'demo-n1-learning-flow', 'demo-question-18', 'demo-q18-3')
    state = enterIntensive(state)

    expect(state.navigation.screen).toBe('intensive')
    expect(state.navigation.intensiveReturnQuestionId).toBe('demo-question-18')

    state = leaveIntensive(state)
    expect(state.navigation.screen).toBe('practice')
    expect(state.navigation.questionId).toBe('demo-question-18')
    expect(state.learning['demo-n1-learning-flow'].answers['demo-question-18'].selectedChoiceId).toBe('demo-q18-3')
  })

  it('只允许存在核实答案的题目显示答案，不为缺失答案的题评分', () => {
    let state = openExam(createInitialLibrary(), 'demo-n1-learning-flow')
    state = revealAnswer(state, 'demo-n1-learning-flow', 'demo-question-1', '2026-10-16T02:00:00Z')
    expect(state.learning['demo-n1-learning-flow'].answers['demo-question-1'].answerRevealedAt).toBeTruthy()
    expect(() => revealAnswer(state, 'demo-n1-learning-flow', 'demo-question-18')).toThrow('没有已核实')
  })

  it('清除本卷作答时保留题库和当前题号', () => {
    let state = openExam(createInitialLibrary(), 'demo-n1-learning-flow')
    state = selectQuestion(state, 'demo-question-19').state
    state = answerQuestion(state, 'demo-n1-learning-flow', 'demo-question-19', 'demo-q19-1')
    state = clearExamAnswers(state, 'demo-n1-learning-flow')

    expect(state.learning['demo-n1-learning-flow'].answers).toEqual({})
    expect(state.learning['demo-n1-learning-flow'].activeQuestionId).toBe('demo-question-19')
    expect(state.exams['demo-n1-learning-flow']).toBeTruthy()
  })
})
