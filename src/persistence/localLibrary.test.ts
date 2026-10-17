import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDemoAudioBlob, createDemoPackagePayload } from '../library/demoData'
import { downloadLocalPackage, isLocalPackageCurrent } from './localLibrary'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Listen 本机题库下载', () => {
  it('生成器升级后，即使转录 ID 相同也会重新安装修正版题库', () => {
    const exam = {
      ...createDemoPackagePayload().exam,
      sourceAnalysisId: 'analysis-1',
      sourcePackageVersion: 2,
    }
    const resource = {
      id: 'local-test',
      examId: exam.id,
      examTitle: exam.title,
      fileName: 'demo.wav',
      audioSize: 1,
      duration: 1,
      analysisId: 'analysis-1',
      builderVersion: 3,
      packageSize: 1,
      status: 'ready' as const,
      message: 'ready',
      updatedAt: '2026-10-17T00:00:00Z',
    }

    expect(isLocalPackageCurrent(resource, exam)).toBe(false)
    expect(isLocalPackageCurrent(resource, { ...exam, sourcePackageVersion: 3 })).toBe(true)
  })

  it('使用 ArrayBuffer 完整读取 ZIP，避免 Chromium 的流式 Blob 中断', async () => {
    const payload = createDemoPackagePayload()
    const audio = createDemoAudioBlob()
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify({
      format: 'jlpt-listening-exam-package',
      version: 1,
      exportedAt: '2026-10-16T00:00:00Z',
      dataFile: 'exam.json',
      audioFiles: { 'demo-tone-audio': 'audio/demo-tone-audio.wav' },
    }))
    zip.file('exam.json', JSON.stringify(payload))
    zip.file('audio/demo-tone-audio.wav', audio, { compression: 'STORE' })
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const buffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buffer).set(bytes)
    const responseBlob = vi.spyOn(Response.prototype, 'blob')
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(buffer, { status: 200 })))

    const installed = await downloadLocalPackage({
      id: 'local-test',
      examId: payload.exam.id,
      examTitle: payload.exam.title,
      fileName: 'demo.wav',
      audioSize: audio.size,
      duration: 12,
      analysisId: 'test-analysis',
      packageSize: buffer.byteLength,
      status: 'ready',
      message: 'ready',
      updatedAt: '2026-10-16T00:00:00Z',
    })

    expect(installed.payload.exam.id).toBe(payload.exam.id)
    expect(installed.audio.get('demo-tone-audio')?.size).toBe(audio.size)
    expect(responseBlob).not.toHaveBeenCalled()
  })
})
