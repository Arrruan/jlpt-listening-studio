import { describe, expect, it } from 'vitest'
import type { TranscriptionResult } from '../ai/types'
import { createMockWorkspace } from '../data/mockData'
import { importAnalysis } from './importAnalysis'

const analysis = (id = 'analysis_a'): TranscriptionResult => ({
  schemaVersion: 1,
  analysisId: id,
  createdAt: '2026-10-15T00:00:00Z',
  source: { fileName: 'exam.m4a', duration: 100, detectedLanguage: 'ja', modelSize: 'small', device: 'cpu', computeType: 'int8' },
  segments: [
    { id: 's1', startTime: 0, endTime: 2, text: '問題5です。', words: [{ startTime: 0, endTime: 2, text: '問題5です。', probability: 0.9, rawSegmentIndex: 0 }], rawSegmentIndexes: [0], role: 'section_cue' },
    { id: 's2', startTime: 2, endTime: 8, text: '男の人と女の人が話しています。', words: [], rawSegmentIndexes: [1], role: 'passage_intro' },
    { id: 's3', startTime: 8, endTime: 10, text: '質問1、何をしますか。', words: [], rawSegmentIndexes: [2], role: 'question_prompt' },
    { id: 's4', startTime: 10, endTime: 12, text: '質問2、どれですか。', words: [], rawSegmentIndexes: [3], role: 'question_prompt' },
  ],
  classification: {
    sections: [{ id: 'sec1', title: '問題5', startTime: 0, endTime: 12, sourceSegmentIds: ['s1'], status: 'confirmed', confidence: 0.98, note: 'explicit' }],
    passages: [{ id: 'p1', sectionId: 'sec1', title: '1番', startTime: 2, endTime: 12, sourceSegmentIds: ['s2', 's3', 's4'], questionIds: ['q1', 'q2'], status: 'confirmed', confidence: 0.95, note: 'explicit' }],
    questions: [
      { id: 'q1', passageId: 'p1', label: '質問1', prompt: '質問1、何をしますか。', startTime: 8, endTime: 10, sourceSegmentIds: ['s3'], status: 'confirmed', confidence: 0.95, note: 'explicit' },
      { id: 'q2', passageId: 'p1', label: '質問2', prompt: '質問2、どれですか。', startTime: 10, endTime: 12, sourceSegmentIds: ['s4'], status: 'confirmed', confidence: 0.95, note: 'explicit' },
    ],
    unassignedSegmentIds: ['s1'],
    warnings: ['人工确认が必要'],
  },
})

describe('AI 结果导入', () => {
  it('用真实分类关系替换未使用的演示结构，并保留一材多题', () => {
    const result = importAnalysis(createMockWorkspace(), analysis(), 'exam_demo')
    expect(result.summary).toMatchObject({ sectionCount: 1, passageCount: 1, questionCount: 2 })
    const passage = result.workspace.passages[result.workspace.activePassageId]
    expect(passage.questionIds).toHaveLength(2)
    expect(passage.segmentIds).toHaveLength(4)
    expect(result.workspace.segments[passage.segmentIds[0]].words?.[0]).toMatchObject({ rawSegmentIndex: 0, probability: 0.9 })
  })

  it('重新分析时保留人工校正句子', () => {
    const first = importAnalysis(createMockWorkspace(), analysis('analysis_1'), 'exam_demo').workspace
    const targetId = first.passages[first.activePassageId].segmentIds[0]
    first.segments[targetId] = { ...first.segments[targetId], text: '人工修正', recognitionStatus: 'human_corrected' }
    const second = importAnalysis(first, analysis('analysis_2'), 'exam_demo')
    expect(Object.values(second.workspace.segments).some((segment) => segment.id === targetId && segment.text === '人工修正')).toBe(true)
    const preserved = second.workspace.segments[targetId]
    expect(second.workspace.passages[preserved.passageId]).toBeDefined()
    expect(second.workspace.passages[preserved.passageId].segmentIds).toContain(targetId)
    expect(second.workspace.exams.exam_demo.sectionIds).toHaveLength(1)
    expect(Object.values(second.workspace.passages).filter((passage) => second.workspace.sections[passage.sectionId]?.examId === 'exam_demo')).toHaveLength(1)
  })
})
