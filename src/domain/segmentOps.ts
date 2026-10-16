import type { EntityId, Segment } from '../types'

export interface SegmentMutationResult {
  segments: Segment[]
  removedIds: EntityId[]
  replacementId?: EntityId
  createdId?: EntityId
}

const sortSegments = (segments: Segment[]) =>
  [...segments]
    .sort((a, b) => a.startTime - b.startTime || a.order - b.order)
    .map((segment, order) => ({ ...segment, order }))

export const normalizeBoundary = (
  startTime: number,
  endTime: number,
  duration: number,
) => {
  const start = Math.max(0, Math.min(startTime, duration))
  const end = Math.max(start + 0.05, Math.min(endTime, duration))
  return { startTime: start, endTime: Math.min(end, duration) }
}

export const mergeSegments = (
  allSegments: Segment[],
  selectedIds: EntityId[],
  timestamp = new Date().toISOString(),
): SegmentMutationResult => {
  const selected = sortSegments(
    allSegments.filter((segment) => selectedIds.includes(segment.id)),
  )
  if (selected.length < 2) {
    throw new Error('请至少选择两个句子进行合并。')
  }
  if (new Set(selected.map((segment) => segment.passageId)).size !== 1) {
    throw new Error('只能合并同一听力材料中的句子。')
  }

  const first = selected[0]
  const removedIds = selected.slice(1).map((segment) => segment.id)
  const merged: Segment = {
    ...first,
    startTime: Math.min(...selected.map((segment) => segment.startTime)),
    endTime: Math.max(...selected.map((segment) => segment.endTime)),
    text: selected.map((segment) => segment.text.trim()).filter(Boolean).join(' '),
    words: selected.flatMap((segment) => segment.words ?? []).sort((a, b) => a.startTime - b.startTime),
    rawSegmentIndexes: [...new Set(selected.flatMap((segment) => segment.rawSegmentIndexes ?? []))].sort((a, b) => a - b),
    recognitionStatus: 'human_corrected',
    updatedAt: timestamp,
  }

  return {
    segments: sortSegments([
      ...allSegments.filter((segment) => !selectedIds.includes(segment.id)),
      merged,
    ]),
    removedIds,
    replacementId: first.id,
  }
}

export const splitSegment = (
  allSegments: Segment[],
  segmentId: EntityId,
  splitAt: number,
  newId: EntityId,
  timestamp = new Date().toISOString(),
): SegmentMutationResult => {
  const target = allSegments.find((segment) => segment.id === segmentId)
  if (!target) throw new Error('找不到要拆分的句子。')
  if (splitAt <= target.startTime + 0.05 || splitAt >= target.endTime - 0.05) {
    throw new Error('拆分点必须位于句子区间内部。')
  }

  const firstText = target.text.trim()
  const firstWords = target.words?.filter((word) => (word.startTime + word.endTime) / 2 < splitAt)
  const secondWords = target.words?.filter((word) => (word.startTime + word.endTime) / 2 >= splitAt)
  const first: Segment = {
    ...target,
    endTime: splitAt,
    text: firstText,
    words: firstWords,
    rawSegmentIndexes: [...new Set((firstWords ?? []).map((word) => word.rawSegmentIndex).filter((value): value is number => value != null))],
    recognitionStatus: 'human_corrected',
    updatedAt: timestamp,
  }
  const second: Segment = {
    ...target,
    id: newId,
    startTime: splitAt,
    text: '',
    words: secondWords,
    rawSegmentIndexes: [...new Set((secondWords ?? []).map((word) => word.rawSegmentIndex).filter((value): value is number => value != null))],
    order: target.order + 1,
    recognitionStatus: 'human_corrected',
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  return {
    segments: sortSegments([
      ...allSegments.filter((segment) => segment.id !== segmentId),
      first,
      second,
    ]),
    removedIds: [],
    replacementId: target.id,
    createdId: newId,
  }
}
