import { useEffect, useState } from 'react'
import type { Segment } from '../types'
import { formatTime } from '../utils/format'

interface SegmentEditorProps {
  segments: Segment[]
  currentTime: number
  duration: number
  transcriptVisible: boolean
  activeSegmentId?: string
  onToggleTranscript: () => void
  onCreate: () => void
  onUpdate: (id: string, changes: Partial<Pick<Segment, 'startTime' | 'endTime' | 'text'>>) => void
  onDelete: (id: string) => void
  onMerge: (ids: string[]) => void
  onSplit: (id: string) => void
  onPlay: (segment: Segment) => void
}

export function SegmentEditor(props: SegmentEditorProps) {
  const [selected, setSelected] = useState<string[]>([])
  useEffect(() => {
    setSelected((ids) => ids.filter((id) => props.segments.some((segment) => segment.id === id)))
  }, [props.segments])

  const toggleSelected = (id: string) => {
    setSelected((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    )
  }

  return (
    <section className="transcript-panel">
      <div className="transcript-heading">
        <div>
          <span className="eyebrow">逐句精听</span>
          <h2>{props.segments.length} 个句子区间</h2>
        </div>
        <div className="transcript-actions">
          <button onClick={props.onToggleTranscript}>{props.transcriptVisible ? '隐藏原文' : '显示原文'}</button>
          <button onClick={() => props.onMerge(selected)} disabled={selected.length < 2}>合并所选</button>
          <button className="primary" onClick={props.onCreate}>＋当前起点 3 秒</button>
        </div>
      </div>

      <div className={`segment-list ${props.transcriptVisible ? '' : 'transcript-hidden'}`}>
        {props.segments.length === 0 && (
          <div className="empty-state">
            <span>まだ、文がありません。</span>
            <p>移动时间轴到句子开头，然后创建一个 3 秒区间。</p>
            <button className="primary" onClick={props.onCreate}>创建第一句</button>
          </div>
        )}
        {props.segments.map((segment, index) => (
          <article className={`segment-card ${props.activeSegmentId === segment.id ? 'playing' : ''}`} key={segment.id}>
            <div className="segment-index">
              <label title="选择后可合并">
                <input
                  type="checkbox"
                  checked={selected.includes(segment.id)}
                  onChange={() => toggleSelected(segment.id)}
                />
                <span>{String(index + 1).padStart(2, '0')}</span>
              </label>
              <button className="round-play" onClick={() => props.onPlay(segment)} aria-label={`循环播放第 ${index + 1} 句`}>
                ▶
              </button>
            </div>
            <div className="segment-content">
              <textarea
                className="segment-text"
                aria-label={`第 ${index + 1} 句日语文本`}
                value={segment.text}
                placeholder="输入日语原文…"
                onChange={(event) => props.onUpdate(segment.id, { text: event.target.value })}
              />
              <div className="segment-timing">
                <label>
                  开始
                  <input
                    type="number"
                    min={0}
                    max={props.duration || undefined}
                    step={0.01}
                    value={segment.startTime}
                    onChange={(event) => props.onUpdate(segment.id, { startTime: Number(event.target.value) })}
                  />
                  <span>{formatTime(segment.startTime)}</span>
                </label>
                <span className="time-connector">→</span>
                <label>
                  结束
                  <input
                    type="number"
                    min={0}
                    max={props.duration || undefined}
                    step={0.01}
                    value={segment.endTime}
                    onChange={(event) => props.onUpdate(segment.id, { endTime: Number(event.target.value) })}
                  />
                  <span>{formatTime(segment.endTime)}</span>
                </label>
              </div>
            </div>
            <div className="segment-menu">
              <button onClick={() => props.onSplit(segment.id)} title="在当前播放位置拆分；若不在区间内则按中点拆分">拆分</button>
              <button className="danger" onClick={() => props.onDelete(segment.id)}>删除</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
