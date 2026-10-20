export type LibraryId = string

export type ExamLevel = 'N1'
export type ExamMonth = 7 | 12 | null
export type ExamSource = 'demo' | 'imported'
export type SectionType =
  | 'task_comprehension'
  | 'point_comprehension'
  | 'overview_comprehension'
  | 'quick_response'
  | 'integrated_comprehension'
  | 'other'

export type ChoicePresentation = 'number_only' | 'audio' | 'text' | 'image' | 'mixed'
export type LibraryScreen = 'home' | 'practice' | 'intensive'
export type QuestionFilter = 'all' | 'answered' | 'unanswered'
export type ReviewStatus = 'confirmed' | 'inferred' | 'unresolved' | 'auto_draft'

export interface LibraryExam {
  id: LibraryId
  title: string
  level: ExamLevel
  /** Demo packages use null instead of pretending to be a real exam year. */
  year: number | null
  month: ExamMonth
  sectionIds: LibraryId[]
  audioAssetIds: LibraryId[]
  schemaVersion: 3
  source: ExamSource
  installedAt: string
  reviewStatus?: ReviewStatus
  sourceAnalysisId?: string
  sourcePackageVersion?: number
}

export interface LibrarySection {
  id: LibraryId
  examId: LibraryId
  title: string
  type: SectionType
  order: number
  passageIds: LibraryId[]
  questionIds: LibraryId[]
  reviewStatus?: ReviewStatus
  sourceAnalysisId?: string
  reviewNote?: string
}

export interface LibraryPassage {
  id: LibraryId
  sectionId: LibraryId
  title: string
  audioAssetId: LibraryId
  /** All times are relative to the bound audio asset. */
  start: number
  end: number
  segmentIds: LibraryId[]
  order: number
  reviewStatus?: ReviewStatus
  sourceAnalysisId?: string
  reviewNote?: string
}

export interface QuestionChoice {
  id: LibraryId
  label: string
  text?: string
  image?: {
    src: string
    alt: string
  }
}

export interface LibraryQuestion {
  id: LibraryId
  sectionId: LibraryId
  passageId: LibraryId
  number: string
  order: number
  prompt?: string
  choicePresentation: ChoicePresentation
  choices?: QuestionChoice[]
  /** Choice id. It is omitted unless the answer has been verified. */
  correctAnswer?: LibraryId
  explanation?: string
  reviewStatus?: ReviewStatus
  sourceAnalysisId?: string
  reviewNote?: string
}

export interface LibrarySegment {
  id: LibraryId
  passageId: LibraryId
  /** All times are relative to the passage's bound audio asset. */
  start: number
  end: number
  text: string
  order: number
  reviewStatus?: ReviewStatus
  sourceAnalysisId?: string
}

export interface LibraryAudioAsset {
  id: LibraryId
  name: string
  mimeType: string
  size: number
  duration: number
  /** Remote assets are streamed from the same protected Cloudflare origin. */
  storageMode: 'indexeddb' | 'remote'
  remotePath?: string
  availability: 'available' | 'missing'
  lastError?: string
}

export interface AnswerRecord {
  questionId: LibraryId
  selectedChoiceId: LibraryId
  answeredAt: string
  answerRevealedAt?: string
}

export interface ExamLearningState {
  examId: LibraryId
  activeQuestionId?: LibraryId
  answers: Record<LibraryId, AnswerRecord>
  updatedAt: string
}

export interface LibraryPreferences {
  theme: 'light' | 'dark'
  defaultLoopCount: 1 | 3 | 5 | 'infinite'
  loopPauseMs: number
  transcriptVisible: boolean
  loopMode: boolean
  playbackRate: 0.5 | 0.7 | 0.8 | 1 | 1.25 | 1.5
}

export interface LibraryNavigation {
  screen: LibraryScreen
  examId?: LibraryId
  questionId?: LibraryId
  intensiveReturnQuestionId?: LibraryId
  questionFilter: QuestionFilter
}

export interface LibraryState {
  schemaVersion: 3
  exams: Record<LibraryId, LibraryExam>
  sections: Record<LibraryId, LibrarySection>
  passages: Record<LibraryId, LibraryPassage>
  questions: Record<LibraryId, LibraryQuestion>
  segments: Record<LibraryId, LibrarySegment>
  audioAssets: Record<LibraryId, LibraryAudioAsset>
  learning: Record<LibraryId, ExamLearningState>
  preferences: LibraryPreferences
  navigation: LibraryNavigation
}

export interface ExamPackagePayload {
  schemaVersion: 3
  exam: LibraryExam
  sections: LibrarySection[]
  passages: LibraryPassage[]
  questions: LibraryQuestion[]
  segments: LibrarySegment[]
  audioAssets: LibraryAudioAsset[]
}

export interface InstalledExamPackage {
  payload: ExamPackagePayload
  audio: Map<LibraryId, Blob>
}
