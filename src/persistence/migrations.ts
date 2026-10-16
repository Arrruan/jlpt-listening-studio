import type { WorkspaceState } from '../types'

interface LegacyWorkspace extends Omit<WorkspaceState, 'schemaVersion' | 'preferences' | 'analyses'> {
  schemaVersion: 1 | 2
  preferences: Partial<WorkspaceState['preferences']>
  analyses?: WorkspaceState['analyses']
}

export const migrateWorkspace = (value: unknown): WorkspaceState => {
  if (!value || typeof value !== 'object') throw new Error('本地工作区数据格式无效。')
  const legacy = value as LegacyWorkspace
  if (legacy.schemaVersion !== 1 && legacy.schemaVersion !== 2) {
    throw new Error(`不支持的工作区版本：${String(legacy.schemaVersion)}`)
  }
  if (!legacy.exams || !legacy.sections || !legacy.passages || !legacy.questions || !legacy.segments) {
    throw new Error('本地工作区缺少试卷结构。')
  }
  return {
    ...legacy,
    schemaVersion: 2,
    preferences: {
      theme: legacy.preferences.theme ?? 'light',
      defaultLoopCount: legacy.preferences.defaultLoopCount ?? 5,
      loopPauseMs: legacy.preferences.loopPauseMs ?? 500,
      aiBackendUrl: legacy.preferences.aiBackendUrl ?? 'http://127.0.0.1:8765',
      aiModelSize: legacy.preferences.aiModelSize ?? 'small',
    },
    analyses: legacy.analyses ?? {},
  }
}
