import { describe, expect, it } from 'vitest'
import type { Segment } from '../types'
import { mergeSegments, normalizeBoundary, splitSegment } from './segmentOps'

const makeSegment = (id: string, startTime: number, endTime: number, text: string): Segment => ({
  id,
  passageId: 'passage-a',
  startTime,
  endTime,
  text,
  order: startTime,
  source: 'manual',
  recognitionStatus: 'unrecognized',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

describe('句子区间操作', () => {
  const segments = [
    makeSegment('s1', 0, 3, '一番目。'),
    makeSegment('s2', 3, 6, '二番目。'),
    makeSegment('s3', 6, 9, '三番目。'),
  ]

  it('合并时保留第一个稳定 ID，并按时间重新排序', () => {
    const result = mergeSegments(segments, ['s2', 's1'], '2026-02-01T00:00:00.000Z')
    expect(result.replacementId).toBe('s1')
    expect(result.removedIds).toEqual(['s2'])
    expect(result.segments).toHaveLength(2)
    expect(result.segments[0]).toMatchObject({ id: 's1', startTime: 0, endTime: 6, text: '一番目。 二番目。', order: 0 })
    expect(result.segments[1]).toMatchObject({ id: 's3', order: 1 })
  })

  it('拆分时保留原 ID，并为后半句创建新稳定 ID', () => {
    const result = splitSegment(segments, 's2', 4.5, 's-new', '2026-02-01T00:00:00.000Z')
    expect(result.createdId).toBe('s-new')
    expect(result.segments).toHaveLength(4)
    expect(result.segments.find((segment) => segment.id === 's2')).toMatchObject({ startTime: 3, endTime: 4.5 })
    expect(result.segments.find((segment) => segment.id === 's-new')).toMatchObject({ startTime: 4.5, endTime: 6, text: '' })
  })

  it('拒绝端点拆分并规范化边界', () => {
    expect(() => splitSegment(segments, 's1', 0, 's-new')).toThrow()
    expect(normalizeBoundary(-1, 12, 10)).toEqual({ startTime: 0, endTime: 10 })
  })

  it('拆分时保留并分配原始词级时间戳', () => {
    const timed: Segment = {
      ...makeSegment('timed', 0, 2, '前半後半'),
      source: 'whisper',
      words: [
        { startTime: 0, endTime: 0.8, text: '前半', rawSegmentIndex: 4 },
        { startTime: 1.1, endTime: 2, text: '後半', rawSegmentIndex: 5 },
      ],
      rawSegmentIndexes: [4, 5],
    }

    const result = splitSegment([timed], 'timed', 1, 'timed-2')

    expect(result.segments.find((item) => item.id === 'timed')?.words?.map((word) => word.text)).toEqual(['前半'])
    expect(result.segments.find((item) => item.id === 'timed-2')?.rawSegmentIndexes).toEqual([5])
  })
})
