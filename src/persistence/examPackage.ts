import JSZip from 'jszip'
import type { ExamPackagePayload, InstalledExamPackage, LibraryAudioAsset } from '../library/types'
import { loadAudioBlob } from './database'

const FORMAT = 'jlpt-listening-exam-package'
const FORMAT_VERSION = 1
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024

interface ExamPackageManifest {
  format: typeof FORMAT
  version: typeof FORMAT_VERSION
  exportedAt: string
  dataFile: string
  audioFiles: Record<string, string>
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object'
const unique = (values: string[]) => new Set(values).size === values.length

export const validateExamPackage = (value: unknown): ExamPackagePayload => {
  if (!isObject(value) || value.schemaVersion !== 3 || !isObject(value.exam)) {
    throw new Error('exam.json 不是受支持的 schemaVersion 3 题库。')
  }
  const payload = value as unknown as ExamPackagePayload
  if (!Array.isArray(payload.sections) || !Array.isArray(payload.passages) || !Array.isArray(payload.questions) ||
      !Array.isArray(payload.segments) || !Array.isArray(payload.audioAssets)) {
    throw new Error('题库包缺少结构数组。')
  }
  if (!payload.exam.id || !payload.exam.title || payload.sections.length === 0 || payload.questions.length === 0 || payload.audioAssets.length === 0) {
    throw new Error('题库包至少需要一套有题目和音频的试卷。')
  }
  const collections = [payload.sections, payload.passages, payload.questions, payload.segments, payload.audioAssets]
  if (collections.some((items) => items.some((item) => !item?.id || typeof item.id !== 'string'))) {
    throw new Error('题库对象必须使用非空字符串 ID。')
  }
  const allIds = collections.flatMap((items) => items.map((item) => item.id))
  if (!unique(allIds)) throw new Error('题库包中的对象 ID 必须全局唯一。')

  const sectionIds = new Set(payload.sections.map((item) => item.id))
  const passageIds = new Set(payload.passages.map((item) => item.id))
  const questionIds = new Set(payload.questions.map((item) => item.id))
  const segmentIds = new Set(payload.segments.map((item) => item.id))
  const assetIds = new Set(payload.audioAssets.map((item) => item.id))
  if (payload.exam.schemaVersion !== 3 || payload.exam.level !== 'N1') throw new Error('当前播放器仅支持 schemaVersion 3 的 N1 题库。')
  if (!unique(payload.exam.sectionIds) || payload.exam.sectionIds.some((id) => !sectionIds.has(id))) throw new Error('试卷引用了不存在的大题。')
  if (!unique(payload.exam.audioAssetIds) || payload.exam.audioAssetIds.some((id) => !assetIds.has(id))) throw new Error('试卷引用了不存在的音频。')
  if (payload.exam.sectionIds.length !== payload.sections.length) throw new Error('题库包包含未归属试卷的大题。')
  if (payload.exam.audioAssetIds.length !== payload.audioAssets.length) throw new Error('题库包包含未归属试卷的音频。')

  for (const section of payload.sections) {
    if (section.examId !== payload.exam.id) throw new Error(`大题 ${section.id} 的 examId 无效。`)
    if (section.passageIds.some((id) => !passageIds.has(id)) || section.questionIds.some((id) => !questionIds.has(id))) {
      throw new Error(`大题 ${section.id} 含有无效引用。`)
    }
  }
  const listedPassageIds = payload.sections.flatMap((item) => item.passageIds)
  const listedQuestionIds = payload.sections.flatMap((item) => item.questionIds)
  if (!unique(listedPassageIds) || listedPassageIds.length !== payload.passages.length) throw new Error('材料必须且只能归属一个大题。')
  if (!unique(listedQuestionIds) || listedQuestionIds.length !== payload.questions.length) throw new Error('题目必须且只能归属一个大题。')
  for (const passage of payload.passages) {
    if (!sectionIds.has(passage.sectionId) || !assetIds.has(passage.audioAssetId)) throw new Error(`材料 ${passage.id} 含有无效引用。`)
    if (!Number.isFinite(passage.start) || !Number.isFinite(passage.end) || passage.start < 0 || passage.end <= passage.start) {
      throw new Error(`材料 ${passage.id} 的时间边界无效。`)
    }
    if (passage.segmentIds.some((id) => !segmentIds.has(id))) throw new Error(`材料 ${passage.id} 引用了不存在的句子。`)
    const audio = payload.audioAssets.find((item) => item.id === passage.audioAssetId)
    if (audio && audio.duration > 0 && passage.end > audio.duration + 0.01) throw new Error(`材料 ${passage.id} 超出绑定音频时长。`)
  }
  const listedSegmentIds = payload.passages.flatMap((item) => item.segmentIds)
  if (!unique(listedSegmentIds) || listedSegmentIds.length !== payload.segments.length) throw new Error('句子必须且只能归属一个材料。')
  for (const question of payload.questions) {
    if (!sectionIds.has(question.sectionId) || !passageIds.has(question.passageId)) throw new Error(`题目 ${question.id} 含有无效引用。`)
    const passage = payload.passages.find((item) => item.id === question.passageId)
    if (passage?.sectionId !== question.sectionId) throw new Error(`题目 ${question.id} 与材料所属大题不一致。`)
    if (question.correctAnswer && !question.choices?.some((choice) => choice.id === question.correctAnswer)) {
      throw new Error(`题目 ${question.id} 的标准答案不在选项中。`)
    }
    if (question.choices && !unique(question.choices.map((choice) => choice.id))) throw new Error(`题目 ${question.id} 的选项 ID 重复。`)
  }
  for (const segment of payload.segments) {
    const passage = payload.passages.find((item) => item.id === segment.passageId)
    if (!passage) throw new Error(`句子 ${segment.id} 引用了不存在的材料。`)
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < passage.start || segment.end > passage.end || segment.end <= segment.start) {
      throw new Error(`句子 ${segment.id} 的时间边界超出材料。`)
    }
  }
  return payload
}

const safeAudioPath = (path: string) => path.startsWith('audio/') && !path.includes('..') && !path.includes('\\')

export const readExamPackage = async (
  file: File,
  onProgress?: (progress: number, message: string) => void,
): Promise<InstalledExamPackage> => {
  if (file.size > MAX_PACKAGE_BYTES) throw new Error('题库包超过浏览器 2 GB 安全限制。')
  onProgress?.(0.05, '正在检查题库包…')
  const zip = await JSZip.loadAsync(file, { checkCRC32: true })
  const manifestFile = zip.file('manifest.json')
  if (!manifestFile) throw new Error('ZIP 中缺少 manifest.json。')
  const manifest = JSON.parse(await manifestFile.async('string')) as Partial<ExamPackageManifest>
  if (manifest.format !== FORMAT || manifest.version !== FORMAT_VERSION || manifest.dataFile !== 'exam.json') {
    throw new Error('这不是受支持的 JLPT Listening Studio 题库包。')
  }
  const dataFile = zip.file('exam.json')
  if (!dataFile) throw new Error('ZIP 中缺少 exam.json。')
  const payload = validateExamPackage(JSON.parse(await dataFile.async('string')))
  const audio = new Map<string, Blob>()
  const files = Object.entries(manifest.audioFiles ?? {})
  for (let index = 0; index < files.length; index += 1) {
    const [assetId, path] = files[index]
    const asset = payload.audioAssets.find((item) => item.id === assetId)
    if (!asset || !safeAudioPath(path)) throw new Error(`音频映射无效：${assetId}`)
    const entry = zip.file(path)
    if (!entry) throw new Error(`ZIP 中缺少音频文件：${path}`)
    const blob = await entry.async('blob')
    if (blob.size > MAX_PACKAGE_BYTES) throw new Error(`音频 ${path} 超过 2 GB 安全限制。`)
    audio.set(assetId, new Blob([blob], { type: asset.mimeType || blob.type || 'application/octet-stream' }))
    onProgress?.((index + 1) / Math.max(1, files.length), `正在读取 ${asset.name}`)
  }
  if (payload.audioAssets.some((asset) => !audio.has(asset.id))) throw new Error('题库包没有包含全部音频文件。')
  return { payload, audio }
}

const extensionFor = (asset: LibraryAudioAsset) => {
  const extension = asset.name.split('.').pop()?.toLowerCase()
  return extension && /^[a-z0-9]{1,8}$/.test(extension) ? extension : 'bin'
}

/** Reserved for the separated maintainer tool; the learner UI only exposes import. */
export const buildExamPackage = async (payloadValue: ExamPackagePayload): Promise<Blob> => {
  const payload = validateExamPackage(payloadValue)
  const zip = new JSZip()
  const audioFiles: Record<string, string> = {}
  for (const asset of payload.audioAssets) {
    const blob = await loadAudioBlob(asset.id)
    if (!blob) throw new Error(`本机缺少音频“${asset.name}”。`)
    const path = `audio/${asset.id}.${extensionFor(asset)}`
    audioFiles[asset.id] = path
    zip.file(path, blob, { compression: 'STORE' })
  }
  const manifest: ExamPackageManifest = {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    dataFile: 'exam.json',
    audioFiles,
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  zip.file('exam.json', JSON.stringify(payload, null, 2))
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}
