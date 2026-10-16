import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { createMockWorkspace } from '../data/mockData'
import { readStudyPackage } from './studyPackage'

const asFile = async (zip: JSZip) => {
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return new File([buffer], 'test.jlpt.zip', { type: 'application/zip' })
}

describe('跨设备学习包', () => {
  it('读取 V2 中独立保存的 workspace.json', async () => {
    const workspace = createMockWorkspace()
    workspace.audioAssets.audio_1 = {
      id: 'audio_1',
      name: 'exam.m4a',
      mimeType: 'audio/mp4',
      size: 3,
      duration: 10,
      storageMode: 'indexeddb',
      availability: 'available',
      createdAt: '2026-10-15T00:00:00Z',
      updatedAt: '2026-10-15T00:00:00Z',
    }
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify({
      format: 'jlpt-listening-study-package',
      version: 2,
      exportedAt: '2026-10-15T00:00:00Z',
      workspaceFile: 'workspace.json',
      audioFiles: { audio_1: 'audio/audio_1.m4a' },
    }))
    zip.file('workspace.json', JSON.stringify(workspace))
    zip.file('audio/audio_1.m4a', new Uint8Array([1, 2, 3]))

    const restored = await readStudyPackage(await asFile(zip))

    expect(restored.workspace.schemaVersion).toBe(2)
    expect(restored.workspace.activeExamId).toBe('exam_demo')
    expect(restored.audio.get('audio_1')).toMatchObject({ size: 3, type: 'audio/mp4' })
  })

  it('继续兼容曾把工作区嵌入 manifest 的 V1 学习包', async () => {
    const workspace = createMockWorkspace()
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify({
      format: 'jlpt-listening-study-package',
      version: 1,
      exportedAt: '2026-10-15T00:00:00Z',
      workspace,
      audioFiles: {},
    }))

    const restored = await readStudyPackage(await asFile(zip))

    expect(Object.keys(restored.workspace.sections)).toHaveLength(2)
  })
})
