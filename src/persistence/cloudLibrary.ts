import type { ExamPackagePayload, LibraryExam, LibraryState } from '../library/types'
import { validateExamPackage } from './examPackage'

const CLOUD_LIBRARY_URL = `${import.meta.env.BASE_URL}api/library/catalog`

export interface CloudExamResource {
  id: string
  examId: string
  title: string
  year: number | null
  month: 7 | 12 | null
  sectionCount: number
  questionCount: number
  segmentCount: number
  reviewStatus?: LibraryExam['reviewStatus']
  analysisId: string
  builderVersion: number
  updatedAt: string
  audioSize: number
  duration: number
  payloadPath: string
}

export interface CloudLibraryCatalog {
  format: 'jlpt-listening-cloud-library'
  version: 1
  generatedAt: string
  totalAudioBytes: number
  exams: CloudExamResource[]
}

const request = async (url: string, timeoutMs: number) => {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'same-origin',
    })
  } finally {
    window.clearTimeout(timeout)
  }
}

const appPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

const isCloudExamResource = (value: unknown): value is CloudExamResource => {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<CloudExamResource>
  return typeof item.id === 'string'
    && typeof item.examId === 'string'
    && typeof item.title === 'string'
    && typeof item.analysisId === 'string'
    && typeof item.builderVersion === 'number'
    && typeof item.payloadPath === 'string'
    && typeof item.questionCount === 'number'
}

export const discoverCloudLibrary = async (): Promise<CloudLibraryCatalog> => {
  const response = await request(CLOUD_LIBRARY_URL, 10_000)
  if (!response.ok) throw new Error(`云端题库返回 ${response.status}`)
  const value = await response.json() as Partial<CloudLibraryCatalog>
  if (
    value.format !== 'jlpt-listening-cloud-library'
    || value.version !== 1
    || !Array.isArray(value.exams)
    || !value.exams.every(isCloudExamResource)
  ) {
    throw new Error('云端题库索引格式无效。')
  }
  return value as CloudLibraryCatalog
}

export const downloadCloudExam = async (resource: CloudExamResource): Promise<ExamPackagePayload> => {
  const response = await request(appPath(resource.payloadPath), 30_000)
  if (!response.ok) throw new Error(`无法读取云端试卷：${response.status}`)
  const payload = validateExamPackage(await response.json())
  if (payload.exam.id !== resource.examId) throw new Error('云端试卷与索引 ID 不一致。')
  for (const asset of payload.audioAssets) {
    if (asset.storageMode !== 'remote' || !asset.remotePath || !/^api\/media\/[a-zA-Z0-9._%-]+$/.test(asset.remotePath)) {
      throw new Error(`云端音频映射无效：${asset.id}`)
    }
  }
  return payload
}

export const isCloudExamCurrent = (
  resource: CloudExamResource,
  installed: LibraryExam | undefined,
  state: LibraryState,
) => Boolean(
  installed
  && installed.sourceAnalysisId === resource.analysisId
  && installed.sourcePackageVersion === resource.builderVersion
  && installed.audioAssetIds.every((assetId) => state.audioAssets[assetId]?.storageMode === 'remote'),
)

export const resolveRemoteAudioPath = (path: string) => appPath(path)
