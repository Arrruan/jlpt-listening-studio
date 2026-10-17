import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const python = resolve(root, '.venv', 'Scripts', 'python.exe')
const vite = resolve(root, 'node_modules', 'vite', 'bin', 'vite.js')

if (!existsSync(python)) {
  console.error('缺少 .venv，请先按 README 安装本地 Python 依赖。')
  process.exit(1)
}

const children = []
const start = (command, args, label) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true })
  child.on('error', (error) => console.error(`[${label}] 启动失败：${error.message}`))
  children.push(child)
  return child
}

start(process.execPath, [vite, '--host', '127.0.0.1'], '学习端')
const prepare = start(python, ['-m', 'backend.app.prepare_library', '--listen-root', 'Listen', '--data-root', 'backend/data', '--model-size', 'small'], 'Listen 自动处理')
prepare.on('exit', (code) => {
  if (code === 0) console.log('[Listen] 本机资源已准备，打开或刷新学习端后会自动安装。')
  else console.error(`[Listen] 自动处理退出，代码 ${code ?? 'unknown'}；学习端仍可使用已有题库。`)
})

let stopping = false
const stop = () => {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (!child.killed) child.kill()
  }
  setTimeout(() => process.exit(0), 300)
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
