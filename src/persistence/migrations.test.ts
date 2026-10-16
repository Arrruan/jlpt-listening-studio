import { describe, expect, it } from 'vitest'
import { createMockWorkspace } from '../data/mockData'
import { migrateWorkspace } from './migrations'

describe('工作区数据迁移', () => {
  it('把 V1 数据升级为 V2 并保留原对象 ID', () => {
    const current = createMockWorkspace()
    const legacy = {
      ...current,
      schemaVersion: 1,
      preferences: {
        theme: current.preferences.theme,
        defaultLoopCount: current.preferences.defaultLoopCount,
        loopPauseMs: current.preferences.loopPauseMs,
      },
      analyses: undefined,
    }
    const migrated = migrateWorkspace(legacy)
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.activeExamId).toBe('exam_demo')
    expect(migrated.preferences.aiModelSize).toBe('small')
    expect(migrated.analyses).toEqual({})
  })
})
