import { describe, expect, it } from 'vitest'
import { createMockWorkspace } from './mockData'

describe('模拟试卷关系', () => {
  it('包含两个大题，且一个材料可以关联两个小题', () => {
    const workspace = createMockWorkspace()
    const exam = workspace.exams[workspace.activeExamId]
    const passage = workspace.passages.passage_1
    expect(exam.sectionIds).toHaveLength(2)
    expect(passage.questionIds).toHaveLength(2)
  })

  it('一个小题可引用同一材料中的多个句子', () => {
    const workspace = createMockWorkspace()
    const question = workspace.questions.question_1
    expect(question.segmentIds).toEqual(['segment_1', 'segment_2'])
    expect(question.segmentIds.every((id) => workspace.segments[id].passageId === question.passageId)).toBe(true)
  })
})
