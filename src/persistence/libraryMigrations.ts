import { installExamPackage } from '../domain/learnerFlow'
import { createDemoPackagePayload, createInitialLibrary, DEMO_EXAM_ID } from '../library/demoData'
import type { LibraryState } from '../library/types'

export const migrateLibraryState = (value: unknown): LibraryState => {
  if (!value) return createInitialLibrary()
  if (typeof value !== 'object') throw new Error('本地题库数据格式无效。')
  const source = value as Partial<LibraryState>
  if (source.schemaVersion !== 3) throw new Error(`不支持的题库版本：${String(source.schemaVersion)}`)
  if (!source.exams || !source.sections || !source.passages || !source.questions || !source.segments || !source.audioAssets) {
    throw new Error('本地题库缺少必要数据。')
  }
  const defaults = createInitialLibrary()
  let state: LibraryState = {
    schemaVersion: 3,
    exams: source.exams,
    sections: source.sections,
    passages: source.passages,
    questions: source.questions,
    segments: source.segments,
    audioAssets: source.audioAssets,
    learning: source.learning ?? {},
    preferences: { ...defaults.preferences, ...source.preferences },
    navigation: { ...defaults.navigation, ...source.navigation },
  }
  if (!state.exams[DEMO_EXAM_ID]) {
    state = installExamPackage(state, createDemoPackagePayload())
  }
  return state
}
