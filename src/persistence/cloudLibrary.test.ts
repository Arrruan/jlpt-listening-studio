import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDemoPackagePayload } from '../library/demoData'
import { createInitialLibrary } from '../library/demoData'
import { discoverCloudLibrary, downloadCloudExam, isCloudExamCurrent } from './cloudLibrary'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const resource = {
  id: 'cloud-demo',
  examId: 'demo-n1-learning-flow',
  title: '云端演示',
  year: null,
  month: null,
  sectionCount: 2,
  questionCount: 3,
  segmentCount: 7,
  analysisId: 'cloud-analysis',
  builderVersion: 3,
  updatedAt: '2026-10-20T00:00:00Z',
  audioSize: 100,
  duration: 12,
  payloadPath: 'api/library/exams/demo-n1-learning-flow',
} as const

describe('Cloudflare 云端题库', () => {
  it('读取轻量目录，不要求下载音频', async () => {
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      format: 'jlpt-listening-cloud-library',
      version: 1,
      generatedAt: '2026-10-20T00:00:00Z',
      totalAudioBytes: 100,
      exams: [resource],
    }), { status: 200 })))

    const catalog = await discoverCloudLibrary()
    expect(catalog.exams).toHaveLength(1)
    expect(catalog.exams[0].payloadPath).not.toContain('audio')
  })

  it('只接受带受保护远程音频路径的试卷元数据', async () => {
    const payload = createDemoPackagePayload()
    payload.exam.sourceAnalysisId = resource.analysisId
    payload.exam.sourcePackageVersion = resource.builderVersion
    payload.audioAssets = payload.audioAssets.map((asset) => ({
      ...asset,
      storageMode: 'remote',
      remotePath: 'api/media/demo-tone-audio.wav',
    }))
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })))

    const result = await downloadCloudExam(resource)
    expect(result.audioAssets[0]).toMatchObject({ storageMode: 'remote', remotePath: 'api/media/demo-tone-audio.wav' })
  })

  it('本机 Blob 版本不会被误判为当前云端版本', () => {
    const state = createInitialLibrary()
    const installed = {
      ...state.exams['demo-n1-learning-flow'],
      sourceAnalysisId: resource.analysisId,
      sourcePackageVersion: resource.builderVersion,
    }
    expect(isCloudExamCurrent(resource, installed, state)).toBe(false)
    state.audioAssets['demo-tone-audio'] = {
      ...state.audioAssets['demo-tone-audio'],
      storageMode: 'remote',
      remotePath: 'api/media/demo.wav',
    }
    expect(isCloudExamCurrent(resource, installed, state)).toBe(true)
  })
})
