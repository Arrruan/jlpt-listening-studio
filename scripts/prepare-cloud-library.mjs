import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'
import JSZip from 'jszip'

const root = resolve(import.meta.dirname, '..')
const packageRoot = resolve(root, 'backend', 'data', 'library_packages')
const listenRoot = resolve(root, 'Listen')
const outputRoot = resolve(root, '.cloudflare-library')
const examOutputRoot = resolve(outputRoot, 'library', 'exams')

const walkFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? walkFiles(path) : [path]
  }))
  return nested.flat()
}

const jsonBytes = (value) => `${JSON.stringify(value, null, 2)}\n`
const contentTypeFor = (path) => ({
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}[extname(path).toLowerCase()] ?? 'application/octet-stream')

await mkdir(examOutputRoot, { recursive: true })
const resources = JSON.parse(await readFile(resolve(packageRoot, 'index.json'), 'utf8'))
const listenFiles = await walkFiles(listenRoot)
const listenByName = new Map(listenFiles.map((path) => [path.split(/[\\/]/).pop(), path]))
const exams = []
const audioUploads = []
const metadataUploads = []
const seenExamIds = new Set()
const seenObjectKeys = new Set()

for (const resource of resources) {
  if (resource.status !== 'ready') continue
  const packagePath = resolve(packageRoot, resource.packageFile)
  const zip = await JSZip.loadAsync(await readFile(packagePath))
  const examEntry = zip.file('exam.json')
  if (!examEntry) throw new Error(`${resource.packageFile} 缺少 exam.json`)
  const payload = JSON.parse(await examEntry.async('string'))
  if (seenExamIds.has(payload.exam.id)) throw new Error(`试卷 ID 重复：${payload.exam.id}`)
  seenExamIds.add(payload.exam.id)

  const audioPath = listenByName.get(resource.fileName)
  if (!audioPath) throw new Error(`Listen 中找不到 ${resource.fileName}`)
  if (payload.audioAssets.length !== 1) throw new Error(`${payload.exam.id} 当前应只有一个音频资源`)
  const extension = extname(audioPath).toLowerCase()
  payload.audioAssets = payload.audioAssets.map((asset) => {
    const remoteFileName = `${asset.id}${extension}`
    const objectKey = `media/${remoteFileName}`
    if (seenObjectKeys.has(objectKey)) throw new Error(`R2 对象键重复：${objectKey}`)
    seenObjectKeys.add(objectKey)
    audioUploads.push({
      objectKey,
      localPath: relative(root, audioPath).replaceAll('\\', '/'),
      contentType: contentTypeFor(audioPath),
      size: resource.audioSize,
      kind: 'audio',
    })
    return {
      ...asset,
      storageMode: 'remote',
      remotePath: `api/media/${encodeURIComponent(remoteFileName)}`,
      availability: 'available',
      lastError: undefined,
    }
  })

  const payloadPath = resolve(examOutputRoot, `${payload.exam.id}.json`)
  const payloadText = jsonBytes(payload)
  await writeFile(payloadPath, payloadText, 'utf8')
  const payloadKey = `library/exams/${payload.exam.id}.json`
  metadataUploads.push({
    objectKey: payloadKey,
    localPath: relative(root, payloadPath).replaceAll('\\', '/'),
    contentType: 'application/json; charset=utf-8',
    size: Buffer.byteLength(payloadText),
    kind: 'metadata',
  })
  exams.push({
    id: resource.id,
    examId: payload.exam.id,
    title: payload.exam.title,
    year: payload.exam.year,
    month: payload.exam.month,
    sectionCount: payload.sections.length,
    questionCount: payload.questions.length,
    segmentCount: payload.segments.length,
    reviewStatus: payload.exam.reviewStatus,
    analysisId: resource.analysisId,
    builderVersion: resource.builderVersion,
    updatedAt: resource.updatedAt,
    audioSize: resource.audioSize,
    duration: resource.duration,
    payloadPath: `api/library/exams/${encodeURIComponent(payload.exam.id)}`,
  })
}

exams.sort((left, right) => (right.year ?? 0) - (left.year ?? 0) || (right.month ?? 0) - (left.month ?? 0))
const catalog = {
  format: 'jlpt-listening-cloud-library',
  version: 1,
  generatedAt: new Date().toISOString(),
  totalAudioBytes: audioUploads.reduce((sum, item) => sum + item.size, 0),
  exams,
}
const catalogPath = resolve(outputRoot, 'library', 'catalog.json')
const catalogText = jsonBytes(catalog)
await writeFile(catalogPath, catalogText, 'utf8')

const catalogUpload = {
  objectKey: 'library/catalog.json',
  localPath: relative(root, catalogPath).replaceAll('\\', '/'),
  contentType: 'application/json; charset=utf-8',
  size: Buffer.byteLength(catalogText),
  kind: 'catalog',
}
const uploads = [...audioUploads, ...metadataUploads, catalogUpload]
for (const upload of uploads) {
  const info = await stat(resolve(root, upload.localPath))
  upload.signature = upload.kind === 'audio'
    ? `${info.size}:${Math.round(info.mtimeMs)}`
    : createHash('sha256').update(await readFile(resolve(root, upload.localPath))).digest('hex')
}
await writeFile(resolve(outputRoot, 'upload-manifest.json'), jsonBytes({
  format: 'jlpt-listening-r2-upload',
  version: 1,
  bucket: 'jlpt-listening-private',
  generatedAt: catalog.generatedAt,
  uploads,
}), 'utf8')

console.log(`已准备 ${exams.length} 套云端试卷：${audioUploads.length} 个音频、${metadataUploads.length + 1} 个元数据对象。`)
console.log(`音频总量 ${(catalog.totalAudioBytes / 1024 / 1024).toFixed(1)} MB；生成目录 ${relative(root, outputRoot)}`)
