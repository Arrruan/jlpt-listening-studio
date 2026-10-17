import type { InstalledExamPackage, LibraryExam } from '../library/types'
import { readExamPackage } from './examPackage'

const LOCAL_LIBRARY_URL = `${import.meta.env.BASE_URL}api/local-library/packages`

export interface LocalPreparedPackage {
  id: string
  examId: string
  examTitle: string
  fileName: string
  audioSize: number
  duration: number
  analysisId: string
  builderVersion?: number
  packageSize: number
  status: 'ready' | 'queued' | 'processing' | 'needs_analysis' | 'failed'
  message: string
  updatedAt: string
  position?: number
  total?: number
}

const request = async (url: string, timeoutMs: number) => {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal, cache: 'no-store' })
  } finally {
    window.clearTimeout(timeout)
  }
}

export const discoverLocalPackages = async (): Promise<LocalPreparedPackage[]> => {
  const response = await request(LOCAL_LIBRARY_URL, 2500)
  if (!response.ok) throw new Error(`本机资源服务返回 ${response.status}`)
  const value = await response.json() as unknown
  if (!Array.isArray(value)) throw new Error('本机资源索引格式无效。')
  return value as LocalPreparedPackage[]
}

export const isLocalPackageCurrent = (resource: LocalPreparedPackage, installed?: LibraryExam) =>
  Boolean(
    installed
    && installed.sourceAnalysisId === resource.analysisId
    && (resource.builderVersion === undefined || installed.sourcePackageVersion === resource.builderVersion),
  )

export const downloadLocalPackage = async (resource: LocalPreparedPackage): Promise<InstalledExamPackage> => {
  const response = await request(`${LOCAL_LIBRARY_URL}/${encodeURIComponent(resource.id)}`, 60_000)
  if (!response.ok) throw new Error(`无法读取本机题库包：${response.status}`)
  // Chromium on Windows can terminate Response.blob() early for a large streamed
  // localhost response. ArrayBuffer consumes the exact same bytes reliably and
  // JSZip already needs the complete package in memory during validation.
  const buffer = await response.arrayBuffer()
  if (resource.packageSize > 0 && buffer.byteLength !== resource.packageSize) {
    throw new Error(`本机题库包读取不完整：应为 ${resource.packageSize} 字节，实际为 ${buffer.byteLength} 字节`)
  }
  const file = new File([buffer], `${resource.id}.jlpt.zip`, { type: 'application/zip' })
  return readExamPackage(file)
}
