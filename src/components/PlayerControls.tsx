import type { LoopCount, LoopRange } from '../types'
import { formatTime } from '../utils/format'

interface PlayerControlsProps {
  fileName: string
  duration: number
  currentTime: number
  ready: boolean
  playing: boolean
  waiting: boolean
  error: string | null
  rate: number
  loop: LoopRange
  completedCycles: number
  onToggle: () => void
  onPlayAll: () => void
  onSeek: (time: number) => void
  onSkip: (delta: number) => void
  onPrevious: () => void
  onNext: () => void
  onSetPoint: (point: 'a' | 'b') => void
  onStartLoop: () => void
  onCancelLoop: () => void
  onRate: (rate: number) => void
  onLoopCount: (count: LoopCount) => void
  onPauseMs: (pauseMs: number) => void
}

export function PlayerControls(props: PlayerControlsProps) {
  const progress = props.duration > 0 ? (props.currentTime / props.duration) * 100 : 0
  const loopStatus = props.loop.enabled
    ? `循环 ${props.completedCycles}/${props.loop.count === 'infinite' ? '∞' : props.loop.count}`
    : props.loop.a !== null && props.loop.b !== null
      ? '区间已设置'
      : '未设置区间'

  return (
    <section className="player-panel" aria-label="播放器">
      <div className="player-meta">
        <div>
          <span className="eyebrow">当前音频</span>
          <strong title={props.fileName}>{props.fileName || '尚未导入音频'}</strong>
        </div>
        <span className={`status-pill ${props.loop.enabled ? 'active' : ''}`}>
          {props.waiting ? '循环间隔' : loopStatus}
        </span>
      </div>

      <div className="timeline-wrap">
        <input
          className="timeline"
          aria-label="音频时间轴"
          type="range"
          min={0}
          max={props.duration || 0}
          step={0.01}
          value={Math.min(props.currentTime, props.duration || 0)}
          disabled={!props.ready}
          onChange={(event) => props.onSeek(Number(event.target.value))}
          style={{ '--progress': `${progress}%` } as React.CSSProperties}
        />
        <div className="time-row">
          <span>{formatTime(props.currentTime)}</span>
          <span>{formatTime(props.duration)}</span>
        </div>
      </div>

      <div className="transport-row">
        <button onClick={props.onPrevious} disabled={!props.ready} title="上一句（[）">上一句</button>
        <button onClick={() => props.onSkip(-2)} disabled={!props.ready} title="后退 2 秒（←）">−2s</button>
        <button
          className="play-button"
          onClick={props.onToggle}
          disabled={!props.ready}
          aria-label={props.playing || props.waiting ? '暂停' : '播放'}
        >
          {props.playing || props.waiting ? '暂停' : '播放'}
        </button>
        <button onClick={() => props.onSkip(2)} disabled={!props.ready} title="前进 2 秒（→）">+2s</button>
        <button onClick={props.onNext} disabled={!props.ready} title="下一句（]）">下一句</button>
        <button className="play-all-button" onClick={props.onPlayAll} disabled={!props.ready}>播放全文</button>
      </div>

      <div className="loop-controls">
        <div className="ab-buttons">
          <button onClick={() => props.onSetPoint('a')} disabled={!props.ready}>
            设 A <span>{props.loop.a === null ? '—' : formatTime(props.loop.a)}</span>
          </button>
          <button onClick={() => props.onSetPoint('b')} disabled={!props.ready}>
            设 B <span>{props.loop.b === null ? '—' : formatTime(props.loop.b)}</span>
          </button>
          <button className="primary" onClick={props.onStartLoop} disabled={!props.ready}>开始 A–B</button>
          <button onClick={props.onCancelLoop} disabled={!props.loop.enabled}>取消循环</button>
        </div>
        <div className="playback-options">
          <label>
            次数
            <select
              value={props.loop.count}
              onChange={(event) =>
                props.onLoopCount(event.target.value === 'infinite' ? 'infinite' : Number(event.target.value) as 1 | 3 | 5)
              }
            >
              <option value={1}>1 次</option>
              <option value={3}>3 次</option>
              <option value={5}>5 次</option>
              <option value="infinite">无限</option>
            </select>
          </label>
          <label>
            间隔
            <select value={props.loop.pauseMs} onChange={(event) => props.onPauseMs(Number(event.target.value))}>
              <option value={0}>无</option>
              <option value={300}>0.3 秒</option>
              <option value={500}>0.5 秒</option>
              <option value={1000}>1 秒</option>
              <option value={2000}>2 秒</option>
            </select>
          </label>
          <label>
            速度
            <select value={props.rate} onChange={(event) => props.onRate(Number(event.target.value))}>
              {[0.5, 0.75, 1, 1.25, 1.5].map((rate) => (
                <option value={rate} key={rate}>{rate.toFixed(2)}×</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {props.error && <p className="inline-error" role="alert">{props.error}</p>}
    </section>
  )
}
