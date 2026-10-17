import { describe, expect, it } from 'vitest'
import { answerQuestion, openExam, selectQuestion } from '../domain/learnerFlow'
import { createInitialLibrary } from '../library/demoData'
import { migrateLibraryState } from './libraryMigrations'

describe('学习端本地数据恢复', () => {
  it('序列化刷新后恢复当前题号、答案和用户设置', () => {
    let state = openExam(createInitialLibrary(), 'demo-n1-learning-flow')
    state = selectQuestion(state, 'demo-question-18').state
    state = answerQuestion(state, 'demo-n1-learning-flow', 'demo-question-18', 'demo-q18-4', '2026-10-16T03:00:00Z')
    state = { ...state, preferences: { ...state.preferences, theme: 'dark', playbackRate: 0.8 } }

    const restored = migrateLibraryState(JSON.parse(JSON.stringify(state)))

    expect(restored.navigation.questionId).toBe('demo-question-18')
    expect(restored.learning['demo-n1-learning-flow'].answers['demo-question-18'].selectedChoiceId).toBe('demo-q18-4')
    expect(restored.preferences).toMatchObject({ theme: 'dark', playbackRate: 0.8 })
  })
})
