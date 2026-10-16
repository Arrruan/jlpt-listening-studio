import type { TranscriptionResult } from '../ai/types'
import type { Passage, Question, Section, Segment, WorkspaceState } from '../types'
import { nowIso } from '../types'

export interface ImportSummary {
  segmentCount: number
  sectionCount: number
  passageCount: number
  questionCount: number
  preservedHumanSegments: number
  warnings: string[]
}

const localId = (kind: string, analysisId: string, sourceId: string) =>
  `${kind}_${analysisId}_${sourceId.replace(/[^A-Za-z0-9_-]/g, '_')}`

const overlapRatio = (
  first: Pick<Segment, 'startTime' | 'endTime'>,
  second: Pick<Segment, 'startTime' | 'endTime'>,
) => {
  const overlap = Math.max(0, Math.min(first.endTime, second.endTime) - Math.max(first.startTime, second.startTime))
  const shortest = Math.max(0.01, Math.min(first.endTime - first.startTime, second.endTime - second.startTime))
  return overlap / shortest
}

const boundaryOverlap = (
  first: { startTime?: number; endTime?: number },
  second: { startTime: number; endTime: number },
) => first.startTime === undefined || first.endTime === undefined
  ? 0
  : overlapRatio(
      { startTime: first.startTime, endTime: first.endTime },
      { startTime: second.startTime, endTime: second.endTime },
    )

const belongsToExam = (workspace: WorkspaceState, passage: Passage, examId: string) =>
  workspace.sections[passage.sectionId]?.examId === examId

export const importAnalysis = (
  workspace: WorkspaceState,
  result: TranscriptionResult,
  examId: string,
): { workspace: WorkspaceState; summary: ImportSummary } => {
  const timestamp = nowIso()
  const isUntouchedDemo = examId === 'exam_demo' && Object.keys(workspace.analyses).length === 0
  const exam = workspace.exams[examId]
  if (!exam) throw new Error('找不到要导入转录的试卷。')

  const passages: WorkspaceState['passages'] = Object.fromEntries(
    Object.entries(workspace.passages).map(([id, passage]) => [id, { ...passage, questionIds: [...passage.questionIds], segmentIds: [...passage.segmentIds] }]),
  )
  const sections: WorkspaceState['sections'] = Object.fromEntries(
    Object.entries(workspace.sections).map(([id, section]) => [id, { ...section, passageIds: [...section.passageIds] }]),
  )
  const questions: WorkspaceState['questions'] = Object.fromEntries(
    Object.entries(workspace.questions).map(([id, question]) => [id, { ...question, segmentIds: [...question.segmentIds] }]),
  )
  const segments: WorkspaceState['segments'] = Object.fromEntries(
    Object.entries(workspace.segments).map(([id, segment]) => [id, { ...segment }]),
  )
  const progress = { ...workspace.progress }

  const examPassageIds = Object.values(passages)
    .filter((passage) => belongsToExam(workspace, passage, examId))
    .map((passage) => passage.id)
  const protectedSegments = Object.values(segments).filter((segment) =>
    examPassageIds.includes(segment.passageId) &&
    !isUntouchedDemo &&
    (segment.recognitionStatus === 'human_corrected' || segment.source === 'manual'),
  )

  const removablePassageIds = new Set(
    examPassageIds.filter((id) =>
      isUntouchedDemo || (passages[id].origin === 'ai' && passages[id].associationStatus !== 'confirmed'),
    ),
  )
  const removableSectionIds = new Set(
    exam.sectionIds.filter((id) =>
      isUntouchedDemo || (sections[id].origin === 'ai' && sections[id].associationStatus !== 'confirmed'),
    ),
  )
  const removableQuestionIds = new Set(
    Object.values(questions)
      .filter((question) => removablePassageIds.has(question.passageId))
      .map((question) => question.id),
  )

  for (const id of removableQuestionIds) delete questions[id]
  for (const id of removablePassageIds) {
    delete passages[id]
    delete progress[id]
  }
  for (const id of removableSectionIds) delete sections[id]
  for (const section of Object.values(sections)) {
    section.passageIds = section.passageIds.filter((id) => !removablePassageIds.has(id))
  }
  for (const [id, segment] of Object.entries(segments)) {
    if (removablePassageIds.has(segment.passageId) && !protectedSegments.some((item) => item.id === id)) {
      delete segments[id]
    }
  }

  // A fresh analysis replaces machine-generated text, but never a manually created
  // or human-corrected segment. Confirmed structure objects remain in place.
  const oldMachineSegmentIds = new Set(
    Object.values(segments)
      .filter((segment) =>
        examPassageIds.includes(segment.passageId) &&
        segment.source === 'whisper' &&
        segment.recognitionStatus !== 'human_corrected',
      )
      .map((segment) => segment.id),
  )
  oldMachineSegmentIds.forEach((id) => delete segments[id])
  for (const passage of Object.values(passages)) {
    passage.segmentIds = passage.segmentIds.filter((id) => !oldMachineSegmentIds.has(id))
    passage.questionIds = passage.questionIds.filter((id) => Boolean(questions[id]))
  }
  for (const question of Object.values(questions)) {
    question.segmentIds = question.segmentIds.filter((id) => !oldMachineSegmentIds.has(id))
  }

  const retainedSectionIds = exam.sectionIds.filter((id) => !removableSectionIds.has(id))

  const sectionMap = new Map<string, string>()
  const newSectionIds: string[] = []
  result.classification.sections.forEach((suggestion, order) => {
    const confirmedMatch = retainedSectionIds.find((id) =>
      sections[id]?.associationStatus === 'confirmed' && boundaryOverlap(sections[id], suggestion) >= 0.7,
    )
    if (confirmedMatch) {
      sectionMap.set(suggestion.id, confirmedMatch)
      return
    }
    const id = localId('section', result.analysisId, suggestion.id)
    const section: Section = {
      id,
      examId,
      title: suggestion.title,
      order,
      passageIds: [],
      recognitionStatus: suggestion.status === 'confirmed' ? 'transcribed' : 'auto_classified_pending',
      startTime: suggestion.startTime,
      endTime: suggestion.endTime,
      associationStatus: suggestion.status,
      origin: 'ai',
      analysisId: result.analysisId,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    sections[id] = section
    sectionMap.set(suggestion.id, id)
    newSectionIds.push(id)
  })

  const passageMap = new Map<string, string>()
  const sourcePassageBySegment = new Map<string, string>()
  result.classification.passages.forEach((suggestion, order) => {
    const sectionId = sectionMap.get(suggestion.sectionId) ?? newSectionIds[0]
    if (!sectionId) return
    const confirmedMatch = sections[sectionId].passageIds.find((id) =>
      passages[id]?.associationStatus === 'confirmed' && boundaryOverlap(passages[id], suggestion) >= 0.7,
    )
    if (confirmedMatch) {
      passageMap.set(suggestion.id, confirmedMatch)
      suggestion.sourceSegmentIds.forEach((segmentId) => {
        if (!sourcePassageBySegment.has(segmentId)) sourcePassageBySegment.set(segmentId, confirmedMatch)
      })
      return
    }
    const id = localId('passage', result.analysisId, suggestion.id)
    const passage: Passage = {
      id,
      sectionId,
      title: suggestion.title,
      order,
      questionIds: [],
      segmentIds: [],
      recognitionStatus: 'transcribed',
      classificationStatus: suggestion.status === 'confirmed' ? 'confirmed' : 'pending_confirmation',
      classificationNote: suggestion.note,
      startTime: suggestion.startTime,
      endTime: suggestion.endTime,
      associationStatus: suggestion.status,
      origin: 'ai',
      analysisId: result.analysisId,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    passages[id] = passage
    sections[sectionId].passageIds.push(id)
    passageMap.set(suggestion.id, id)
    suggestion.sourceSegmentIds.forEach((segmentId) => {
      if (!sourcePassageBySegment.has(segmentId)) sourcePassageBySegment.set(segmentId, id)
    })
    progress[id] = {
      passageId: id,
      currentTime: suggestion.startTime,
      playbackRate: 1,
      transcriptVisible: true,
      completedSegmentIds: [],
    }
  })

  const fallbackPassageId = passageMap.values().next().value as string | undefined
  const segmentMap = new Map<string, string>()
  for (const suggestion of result.segments) {
    const preserved = protectedSegments.find((segment) => overlapRatio(segment, suggestion) >= 0.65)
    if (preserved) {
      const suggestedPassageId = sourcePassageBySegment.get(suggestion.id) ?? fallbackPassageId
      const passageId = passages[preserved.passageId] ? preserved.passageId : suggestedPassageId
      if (!passageId || !passages[passageId]) continue
      segments[preserved.id] = { ...preserved, passageId, updatedAt: timestamp }
      if (!passages[passageId].segmentIds.includes(preserved.id)) {
        passages[passageId].segmentIds.push(preserved.id)
      }
      segmentMap.set(suggestion.id, preserved.id)
      continue
    }
    const passageId = sourcePassageBySegment.get(suggestion.id) ?? fallbackPassageId
    if (!passageId || !passages[passageId]) continue
    const id = localId('segment', result.analysisId, suggestion.id)
    const segment: Segment = {
      id,
      passageId,
      startTime: suggestion.startTime,
      endTime: suggestion.endTime,
      text: suggestion.text,
      order: passages[passageId].segmentIds.length,
      source: 'whisper',
      recognitionStatus: 'transcribed',
      confidence: suggestion.confidence ?? undefined,
      analysisId: result.analysisId,
      words: suggestion.words.map((word) => ({ ...word })),
      rawSegmentIndexes: [...suggestion.rawSegmentIndexes],
      role: suggestion.role,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    segments[id] = segment
    passages[passageId].segmentIds.push(id)
    segmentMap.set(suggestion.id, id)
  }

  // Reattached human segments may have belonged to an AI passage that was
  // replaced above. Normalize every destination once all mappings are known.
  for (const passage of Object.values(passages)) {
    passage.segmentIds = passage.segmentIds
      .filter((id, index, all) => all.indexOf(id) === index && segments[id]?.passageId === passage.id)
      .sort((left, right) => segments[left].startTime - segments[right].startTime)
    passage.segmentIds.forEach((id, order) => {
      segments[id] = { ...segments[id], order }
    })
  }

  result.classification.questions.forEach((suggestion) => {
    const passageId = passageMap.get(suggestion.passageId)
    if (!passageId || !passages[passageId]) return
    const id = localId('question', result.analysisId, suggestion.id)
    const sourceIds = suggestion.sourceSegmentIds
      .map((sourceId) => segmentMap.get(sourceId))
      .filter((value): value is string => Boolean(value))
      .filter((segmentId) => segments[segmentId]?.passageId === passageId)
      .filter((segmentId, index, all) => all.indexOf(segmentId) === index)
    const confirmedMatch = passages[passageId].questionIds
      .map((id) => questions[id])
      .find((question) => question?.associationStatus === 'confirmed' && question.label === suggestion.label)
    if (confirmedMatch) {
      if (confirmedMatch.segmentIds.length === 0 && sourceIds.length > 0) {
        questions[confirmedMatch.id] = { ...confirmedMatch, segmentIds: sourceIds, updatedAt: timestamp }
      }
      return
    }
    const question: Question = {
      id,
      passageId,
      label: suggestion.label,
      prompt: suggestion.prompt,
      order: passages[passageId].questionIds.length,
      segmentIds: sourceIds,
      startTime: suggestion.startTime,
      endTime: suggestion.endTime,
      associationStatus: suggestion.status,
      origin: 'ai',
      analysisId: result.analysisId,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    questions[id] = question
    passages[passageId].questionIds.push(id)
  })

  const activePassageId = fallbackPassageId ?? workspace.activePassageId
  const nextWorkspace: WorkspaceState = {
    ...workspace,
    exams: {
      ...workspace.exams,
      [examId]: {
        ...exam,
        sectionIds: [...retainedSectionIds, ...newSectionIds],
        recognitionStatus: 'auto_classified_pending',
        updatedAt: timestamp,
      },
    },
    sections,
    passages,
    questions,
    segments,
    progress,
    activePassageId,
    analyses: {
      ...workspace.analyses,
      [result.analysisId]: {
        id: result.analysisId,
        examId,
        createdAt: result.createdAt,
        fileName: result.source.fileName,
        modelSize: result.source.modelSize,
        segmentCount: result.segments.length,
        status: 'imported',
      },
    },
  }

  return {
    workspace: nextWorkspace,
    summary: {
      segmentCount: result.segments.length,
      sectionCount: result.classification.sections.length,
      passageCount: result.classification.passages.length,
      questionCount: result.classification.questions.length,
      preservedHumanSegments: protectedSegments.length,
      warnings: result.classification.warnings,
    },
  }
}
