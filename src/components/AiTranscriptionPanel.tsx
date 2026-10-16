import { useEffect, useRef, useState } from 'react'
import { cancelTranscription, checkAiHealth, getTranscriptionJob, getTranscriptionResult, startTranscription } from '../ai/client'
import type { AiHealth, TranscriptionJob, TranscriptionResult } from '../ai/types'
import { loadAudioBlob } from '../persistence/database'
import type { AudioAsset } from '../types'

interface AiTranscriptionPanelProps {
  asset?: AudioAsset
  backendUrl: string
  modelSize: 'small' | 'medium'
  onSettings: (settings: { backendUrl?: string; modelSize?: 'small' | 'medium' }) => void
  onResult: (result: TranscriptionResult) => void
}

const terminalStatuses = new Set<TranscriptionJob['status']>(['completed', 'failed', 'cancelled'])

export function AiTranscriptionPanel({ asset, backendUrl, modelSize, onSettings, onResult }: AiTranscriptionPanelProps) {
  const [health, setHealth] = useState<AiHealth | null>(null)
  const [job, setJob] = useState<TranscriptionJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const pollTokenRef = useRef(0)
  const onResultRef = useRef(onResult)

  useEffect(() => () => { pollTokenRef.current += 1 }, [])
  useEffect(() => { onResultRef.current = onResult }, [onResult])

  const check = async () => {
    setChecking(true)
    setError(null)
    try {
      setHealth(await checkAiHealth(backendUrl))
    } catch (healthError) {
      setHealth(null)
      setError(`无法连接本地 AI 服务：${healthError instanceof Error ? healthError.message : '未知错误'}`)
    } finally {
      setChecking(false)
    }
  }

  const poll = async (initial: TranscriptionJob) => {
    const token = ++pollTokenRef.current
    let current = initial
    while (!terminalStatuses.has(current.status) && token === pollTokenRef.current) {
      await new Promise((resolve) => window.setTimeout(resolve, 1500))
      if (token !== pollTokenRef.current) return
      current = await getTranscriptionJob(backendUrl, current.id)
      setJob(current)
    }
    if (token !== pollTokenRef.current) return
    if (current.status === 'completed') {
      const result = await getTranscriptionResult(backendUrl, current.id)
      onResultRef.current(result)
    } else if (current.status === 'failed') {
      setError(current.error || current.message)
    }
  }

  const start = async () => {
    if (!asset) {
      setError('请先导入整份试卷音频。')
      return
    }
    setError(null)
    try {
      const blob = await loadAudioBlob(asset.id)
      if (!blob) throw new Error('IndexedDB 中没有音频 Blob；请重新导入并勾选“保存音频到本机”。')
      const created = await startTranscription(backendUrl, blob, asset.name, modelSize)
      setJob(created)
      void poll(created).catch((pollError) => {
        setError(pollError instanceof Error ? pollError.message : '轮询转录状态失败。')
      })
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : '无法启动转录。')
    }
  }

  const cancel = async () => {
    if (!job) return
    pollTokenRef.current += 1
    try {
      setJob(await cancelTranscription(backendUrl, job.id))
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : '取消任务失败。')
    }
  }

  const running = Boolean(job && !terminalStatuses.has(job.status))
  return (
    <details className="ai-panel">
      <summary>
        <span><b>本地 AI 转录</b><small>faster-whisper · CPU · 日语词级时间戳</small></span>
        <span className={health ? 'online' : ''}>{health ? '服务已连接' : '需要本地服务'}</span>
      </summary>
      <div className="ai-panel-body">
        <div className="ai-settings">
          <label>
            后端地址
            <input value={backendUrl} onChange={(event) => onSettings({ backendUrl: event.target.value })} />
          </label>
          <label>
            模型
            <select value={modelSize} onChange={(event) => onSettings({ modelSize: event.target.value as 'small' | 'medium' })}>
              <option value="small">small · 默认，更快</option>
              <option value="medium">medium · 更准，更慢</option>
            </select>
          </label>
          <button onClick={() => void check()} disabled={checking || running}>{checking ? '检查中…' : '检查服务'}</button>
          <button className="primary" onClick={() => void start()} disabled={!asset || running}>开始真实转录</button>
          {running && <button className="danger" onClick={() => void cancel()}>取消</button>}
        </div>
        {health && (
          <p className="ai-runtime">Python {health.python} · faster-whisper {health.fasterWhisper} · CTranslate2 {health.ctranslate2} · 已加载模型 {health.modelsLoaded.join(', ') || '无'}</p>
        )}
        {modelSize === 'medium' && <p className="ai-warning">medium 在 CPU 上会明显更慢、占用更多内存；建议先用 small 完成整卷工作流。</p>}
        {job && (
          <div className="ai-job">
            <div className="ai-progress"><i style={{ width: `${Math.max(2, job.progress * 100)}%` }} /></div>
            <div>
              <strong>{Math.round(job.progress * 100)}%</strong>
              <span>{job.message}</span>
              <small>{job.status === 'completed' ? `已生成 ${job.segmentCount} 个句子区间` : `已处理 ${job.segmentCount} 个 Whisper 片段`}</small>
            </div>
          </div>
        )}
        {error && <p className="inline-error" role="alert">{error}</p>}
        <p className="ai-footnote">首次运行会下载模型。分类只生成“确认成功 / 推测关联 / 无法判断”，不会补写音频里没有读出的选项或答案。</p>
      </div>
    </details>
  )
}
