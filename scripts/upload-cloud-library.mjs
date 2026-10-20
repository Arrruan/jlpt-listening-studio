import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outputRoot = resolve(root, '.cloudflare-library')
const manifest = JSON.parse(await readFile(resolve(outputRoot, 'upload-manifest.json'), 'utf8'))
const statePath = resolve(outputRoot, 'upload-state.json')
const force = process.argv.includes('--force')
let state = { bucket: manifest.bucket, completed: {} }
try {
  const previous = JSON.parse(await readFile(statePath, 'utf8'))
  if (previous.bucket === manifest.bucket) state = previous
} catch {
  // A missing state file means this is the first upload.
}

const wrangler = resolve(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const run = (args) => new Promise((resolveRun, reject) => {
  const child = spawn(process.execPath, [wrangler, ...args], { cwd: root, stdio: 'inherit', windowsHide: true })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`wrangler 退出代码 ${code ?? 'unknown'}`)))
})

let uploaded = 0
let skipped = 0
for (const [index, item] of manifest.uploads.entries()) {
  if (!force && state.completed[item.objectKey] === item.signature) {
    skipped += 1
    continue
  }
  console.log(`[${index + 1}/${manifest.uploads.length}] 上传 ${item.objectKey} (${(item.size / 1024 / 1024).toFixed(1)} MB)`)
  await run([
    'r2', 'object', 'put', `${manifest.bucket}/${item.objectKey}`,
    '--file', resolve(root, item.localPath),
    '--content-type', item.contentType,
    '--remote',
  ])
  state.completed[item.objectKey] = item.signature
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  uploaded += 1
}
console.log(`R2 上传完成：新上传 ${uploaded}，已跳过 ${skipped}。目录索引最后发布。`)
