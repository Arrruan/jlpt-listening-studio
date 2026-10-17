import type { LoopCount } from '../types'
import { formatTime } from '../utils/format'

interface StudyPlayerProps {
  title: string
  fileName: string
  start: number
  end: number
  currentTime: number
  ready: boolean
  playing: boolean
  waiting: boolean
  error: string | null
  rate: number
  loopActive: boolean
  completedCycles: number
  loopCount: LoopCount
  activeLoopCount: LoopCount
  intensive: boolean
  onToggle: () => void
  onReplay: () => void
  onSeek: (time: number) => void
  onSkip: (seconds: number) => void
  onPrevious?: () => void
  onNext?: () => void
  onRate: (rate: number) => void
  onLoopCount: (count: LoopCount) => void
}

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))

export function StudyPlayer(props: StudyPlayerProps) {
  const passageDuration = Math.max(0, props.end - props.start)
  const timeInPassage = clamp(props.currentTime - props.start, 0, passageDuration)
  const status = props.waiting
    ? '循环间隔'
    : props.loopActive
      ? `区间播放 ${props.completedCycles}/${props.activeLoopCount === 'infinite' ? '∞' : props.activeLoopCount}`
      : props.ready ? '可以播放' : '正在载入音频'

  return (
    <section className="study-player" aria-label="听力播放器">
      <div className="player-topline">
        <div className="player-track">
          <span>{props.intensive ? '精听材料' : '当前材料'}</span>
          <strong>{props.title}</strong>
          <small title={props.fileName}>{props.fileName || '本机音频不可用'}</small>
        </div>
        <span className={`play-status ${props.loopActive ? 'active' : ''}`}>{status}</span>
      </div>

      <label className="passage-timeline">
        <span className="sr-only">材料播放进度</span>
        <input
          type="range"
          min={props.start}
          max={props.end}
          step={0.01}
          value={clamp(props.currentTime, props.start, props.end)}
          disabled={!props.ready}
          onChange={(event) => props.onSeek(Number(event.target.value))}
          style={{ '--player-progress': `${passageDuration ? (timeInPassage / passageDuration) * 100 : 0}%` } as React.CSSProperties}
        />
        <span className="time-labels"><span>{formatTime(timeInPassage)}</span><span>{formatTime(passageDuration)}</span></span>
      </label>

      <div className="player-buttons">
        {props.intensive && <button onClick={props.onPrevious} disabled={!props.ready || !props.onPrevious} aria-label="上一句">上一句</button>}
        <button onClick={() => props.onSkip(-2)} disabled={!props.ready} aria-label="后退两秒">−2s</button>
        <button className="main-play" onClick={props.onToggle} disabled={!props.ready}>
          {props.playing || props.waiting ? '暂停' : '播放'}
        </button>
        <button onClick={() => props.onSkip(2)} disabled={!props.ready} aria-label="前进两秒">+2s</button>
        {props.intensive && <button onClick={props.onNext} disabled={!props.ready || !props.onNext} aria-label="下一句">下一句</button>}
        <button className="replay-passage" onClick={props.onReplay} disabled={!props.ready}>从头播放材料</button>
      </div>

      <div className="player-options">
        {props.intensive && (
          <label>
            句子循环
            <select value={props.loopCount} onChange={(event) => props.onLoopCount(event.target.value === 'infinite' ? 'infinite' : Number(event.target.value) as 1 | 3 | 5)}>
              <option value={1}>1 次</option>
              <option value={3}>3 次</option>
              <option value={5}>5 次</option>
              <option value="infinite">无限</option>
            </select>
          </label>
        )}
        <label>
          播放速度
          <select value={props.rate} onChange={(event) => props.onRate(Number(event.target.value))}>
            {[0.5, 0.7, 0.8, 1, 1.25, 1.5].map((rate) => <option value={rate} key={rate}>{rate}×</option>)}
          </select>
        </label>
      </div>
      {props.error && <p className="player-error" role="alert">{props.error}</p>}
    </section>
  )
}
