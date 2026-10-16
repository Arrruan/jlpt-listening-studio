import JSZip from 'jszip'
import type { WorkspaceState } from '../types'
import { loadAudioBlob } from './database'
import { migrateWorkspace } from './migrations'

const FORMAT = 'jlpt-listening-study-package'
const FORMAT_VERSION = 2

interface PackageManifest {
  format: typeof FORMAT
  version: 1 | typeof FORMAT_VERSION
  exportedAt: string
  workspaceFile?: string
  workspace?: WorkspaceState
  audioFiles: Record<string, string>
}

export interface ImportedStudyPackage {
  workspace: WorkspaceState
  audio: Map<string, Blob>
  exportedAt: string
}

const extensionFor = (name: string) => {
  const extension = name.split('.').pop()?.toLowerCase()
  return extension && /^[a-z0-9]{1,8}$/.test(extension) ? extension : 'bin'
}

export const buildStudyPackage = async (
  workspace: WorkspaceState,
  onProgress?: (progress: number, message: string) => void,
) => {
  const zip = new JSZip()
  const audioFiles: Record<string, string> = {}
  const assets = Object.values(workspace.audioAssets)
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index]
    onProgress?.(index / Math.max(1, assets.length + 1), `正在读取 ${asset.name}`)
    const blob = await loadAudioBlob(asset.id)
    if (!blob) throw new Error(`学习包缺少音频“${asset.name}”；请重新导入并勾选保存到本机。`)
    const path = `audio/${asset.id}.${extensionFor(asset.name)}`
    audioFiles[asset.id] = path
    zip.file(path, blob, { compression: 'STORE' })
  }
  const manifest: PackageManifest = {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    workspaceFile: 'workspace.json',
    audioFiles,
  }
  zip.file('workspace.json', JSON.stringify(workspace, null, 2))
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  return zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    (metadata) => onProgress?.(metadata.percent / 100, `正在生成 ZIP：${metadata.percent.toFixed(0)}%`),
  )
}

export const readStudyPackage = async (
  file: File,
  onProgress?: (progress: number, message: string) => void,
): Promise<ImportedStudyPackage> => {
  if (file.size > 2 * 1024 * 1024 * 1024) throw new Error('学习包超过 2 GB 浏览器安全限制。')
  onProgress?.(0.05, '正在检查学习包…')
  const zip = await JSZip.loadAsync(file, { checkCRC32: true })
  const manifestFile = zip.file('manifest.json')
  if (!manifestFile) throw new Error('ZIP 中缺少 manifest.json。')
  const rawManifest = JSON.parse(await manifestFile.async('string')) as Partial<PackageManifest>
  if (rawManifest.format !== FORMAT || (rawManifest.version !== 1 && rawManifest.version !== FORMAT_VERSION)) {
    throw new Error('这不是受支持的 JLPT Listening Studio 学习包。')
  }
  let workspaceSource: unknown = rawManifest.workspace
  if (rawManifest.version === FORMAT_VERSION) {
    const workspaceFile = zip.file(rawManifest.workspaceFile ?? 'workspace.json')
    if (!workspaceFile) throw new Error('ZIP 中缺少 workspace.json。')
    workspaceSource = JSON.parse(await workspaceFile.async('string'))
  }
  const workspace = migrateWorkspace(workspaceSource)
  const audio = new Map<string, Blob>()
  const entries = Object.entries(rawManifest.audioFiles ?? {})
  for (let index = 0; index < entries.length; index += 1) {
    const [assetId, path] = entries[index]
    if (!workspace.audioAssets[assetId]) throw new Error(`音频 ${assetId} 没有对应的元数据。`)
    const entry = zip.file(path)
    if (!entry) throw new Error(`ZIP 中缺少音频文件：${path}`)
    const rawBlob = await entry.async('blob')
    if (rawBlob.size > 2 * 1024 * 1024 * 1024) throw new Error(`音频 ${path} 超过 2 GB 安全限制。`)
    const mimeType = workspace.audioAssets[assetId].mimeType || rawBlob.type || 'application/octet-stream'
    audio.set(assetId, new Blob([rawBlob], { type: mimeType }))
    onProgress?.((index + 1) / Math.max(1, entries.length), `正在读取 ${workspace.audioAssets[assetId].name}`)
  }
  return { workspace, audio, exportedAt: rawManifest.exportedAt ?? '' }
}

export const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
