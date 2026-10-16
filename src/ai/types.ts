import type { AssociationStatus, Segment } from '../types'

export interface AiWordToken {
  startTime: number
  endTime: number
  text: string
  probability?: number | null
  rawSegmentIndex?: number | null
}

export interface AiTranscriptSegment {
  id: string
  startTime: number
  endTime: number
  text: string
  confidence?: number | null
  words: AiWordToken[]
  rawSegmentIndexes: number[]
  role: NonNullable<Segment['role']>
}

interface AiSuggestionBase {
  id: string
  startTime: number
  endTime: number
  sourceSegmentIds: string[]
  status: AssociationStatus
  confidence: number
  note: string
}

export interface AiSectionSuggestion extends AiSuggestionBase {
  title: string
}

export interface AiPassageSuggestion extends AiSuggestionBase {
  title: string
  sectionId: string
  questionIds: string[]
}

export interface AiQuestionSuggestion extends AiSuggestionBase {
  passageId: string
  label: string
  prompt: string
}

export interface TranscriptionResult {
  schemaVersion: 1
  analysisId: string
  createdAt: string
  source: {
    fileName: string
    duration: number
    detectedLanguage: string
    languageProbability?: number | null
    modelSize: 'small' | 'medium'
    device: 'cpu'
    computeType: 'int8'
  }
  segments: AiTranscriptSegment[]
  classification: {
    sections: AiSectionSuggestion[]
    passages: AiPassageSuggestion[]
    questions: AiQuestionSuggestion[]
    unassignedSegmentIds: string[]
    warnings: string[]
  }
}

export interface TranscriptionJob {
  id: string
  status: 'queued' | 'loading_model' | 'transcribing' | 'classifying' | 'completed' | 'failed' | 'cancelled'
  progress: number
  message: string
  modelSize: 'small' | 'medium'
  fileName: string
  createdAt: string
  updatedAt: string
  error?: string | null
  segmentCount: number
}

export interface AiHealth {
  status: 'ok'
  python: string
  fasterWhisper: string | null
  ctranslate2: string | null
  modelsLoaded: string[]
}
