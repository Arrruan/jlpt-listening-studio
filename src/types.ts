export type EntityId = string

export type RecognitionStatus =
  | 'unrecognized'
  | 'transcribed'
  | 'auto_classified_pending'
  | 'human_corrected'

export type ClassificationStatus =
  | 'not_started'
  | 'pending_confirmation'
  | 'confirmed'
  | 'failed'

export type AssociationStatus = 'confirmed' | 'inferred' | 'unresolved'
export type EntityOrigin = 'manual' | 'ai'

interface BaseEntity {
  id: EntityId
  createdAt: string
  updatedAt: string
}

export interface Exam extends BaseEntity {
  title: string
  date?: string
  /** Default full-exam audio. A passage may override it with its own asset. */
  audioAssetId?: EntityId
  sectionIds: EntityId[]
  recognitionStatus: RecognitionStatus
}

export interface Section extends BaseEntity {
  examId: EntityId
  title: string
  order: number
  passageIds: EntityId[]
  recognitionStatus: RecognitionStatus
  startTime?: number
  endTime?: number
  associationStatus?: AssociationStatus
  origin?: EntityOrigin
  analysisId?: string
}

export interface Passage extends BaseEntity {
  sectionId: EntityId
  title: string
  order: number
  audioAssetId?: EntityId
  questionIds: EntityId[]
  segmentIds: EntityId[]
  recognitionStatus: RecognitionStatus
  classificationStatus: ClassificationStatus
  classificationNote?: string
  startTime?: number
  endTime?: number
  associationStatus?: AssociationStatus
  origin?: EntityOrigin
  analysisId?: string
}

export interface Question extends BaseEntity {
  passageId: EntityId
  label: string
  prompt: string
  order: number
  /** One question can cite any number of segments from its passage. */
  segmentIds: EntityId[]
  startTime?: number
  endTime?: number
  associationStatus?: AssociationStatus
  origin?: EntityOrigin
  analysisId?: string
}

export interface SegmentWordToken {
  startTime: number
  endTime: number
  text: string
  probability?: number | null
  rawSegmentIndex?: number | null
}

export interface Segment extends BaseEntity {
  passageId: EntityId
  startTime: number
  endTime: number
  text: string
  order: number
  source: 'manual' | 'whisper'
  recognitionStatus: RecognitionStatus
  confidence?: number
  analysisId?: string
  /** Original Whisper word timings remain available after classification. */
  words?: SegmentWordToken[]
  rawSegmentIndexes?: number[]
  role?:
    | 'section_cue'
    | 'item_cue'
    | 'passage_intro'
    | 'question_prompt'
    | 'dialogue'
    | 'explanation'
    | 'unknown'
}

export interface AudioAsset extends BaseEntity {
  name: string
  mimeType: string
  size: number
  duration: number
  storageMode: 'indexeddb' | 'session'
  availability: 'available' | 'missing'
  lastError?: string
}

export interface PassageProgress {
  passageId: EntityId
  currentTime: number
  playbackRate: number
  transcriptVisible: boolean
  completedSegmentIds: EntityId[]
  lastPlayedAt?: string
}

export interface UserPreferences {
  theme: 'light' | 'dark'
  defaultLoopCount: 1 | 3 | 5 | 'infinite'
  loopPauseMs: number
  aiBackendUrl: string
  aiModelSize: 'small' | 'medium'
}

export interface AnalysisRecord {
  id: string
  examId: EntityId
  createdAt: string
  fileName: string
  modelSize: 'small' | 'medium'
  segmentCount: number
  status: 'imported' | 'failed'
}

export interface WorkspaceState {
  schemaVersion: 2
  exams: Record<EntityId, Exam>
  sections: Record<EntityId, Section>
  passages: Record<EntityId, Passage>
  questions: Record<EntityId, Question>
  segments: Record<EntityId, Segment>
  audioAssets: Record<EntityId, AudioAsset>
  progress: Record<EntityId, PassageProgress>
  preferences: UserPreferences
  analyses: Record<string, AnalysisRecord>
  activeExamId: EntityId
  activePassageId: EntityId
}

export type LoopCount = UserPreferences['defaultLoopCount']
export type AudioBindingScope = 'exam' | 'passage'

export interface LoopRange {
  a: number | null
  b: number | null
  enabled: boolean
  count: LoopCount
  pauseMs: number
}

export const createId = (prefix: string): EntityId =>
  `${prefix}_${crypto.randomUUID()}`

export const nowIso = () => new Date().toISOString()
