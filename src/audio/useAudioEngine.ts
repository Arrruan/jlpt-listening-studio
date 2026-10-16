import { useCallback, useEffect, useRef, useState } from 'react'
import { clampTime, decideAtBoundary, isValidLoopRange, reachedBoundary } from '../domain/loopLogic'
import type { LoopCount, LoopRange } from '../types'

interface StartLoopOptions {
  a: number
  b: number
  count?: LoopCount
  pauseMs?: number
}

const initialLoop: LoopRange = {
  a: null,
  b: null,
  enabled: false,
  count: 5,
  pauseMs: 500,
}

export const useAudioEngine = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  if (!audioRef.current && typeof Audio !== 'undefined') {
    audioRef.current = new Audio()
    audioRef.current.preload = 'metadata'
  }

  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playbackRate, setPlaybackRateState] = useState(1)
  const [loop, setLoopState] = useState<LoopRange>(initialLoop)
  const [completedCycles, setCompletedCycles] = useState(0)
  const [isLoopWaiting, setIsLoopWaiting] = useState(false)

  const loopRef = useRef(loop)
  const durationRef = useRef(duration)
  const completedRef = useRef(0)
  const operationRef = useRef(0)
  const boundaryBusyRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    loopRef.current = loop
  }, [loop])
  useEffect(() => {
    durationRef.current = duration
  }, [duration])

  const clearWaiting = useCallback(() => {
    operationRef.current += 1
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
    boundaryBusyRef.current = false
    setIsLoopWaiting(false)
  }, [])

  const safePlay = useCallback(async () => {
    const audio = audioRef.current
    if (!audio || !audio.src) {
      setError('请先为当前材料导入音频。')
      return false
    }
    try {
      await audio.play()
      setError(null)
      return true
    } catch (playError) {
      setError(playError instanceof Error ? playError.message : '浏览器阻止了音频播放。')
      return false
    }
  }, [])

  const finishBoundary = useCallback(() => {
    const audio = audioRef.current
    const activeLoop = loopRef.current
    if (
      !audio ||
      !activeLoop.enabled ||
      !isValidLoopRange(activeLoop.a, activeLoop.b, durationRef.current) ||
      boundaryBusyRef.current
    ) {
      return
    }

    boundaryBusyRef.current = true
    audio.pause()
    audio.currentTime = activeLoop.b as number
    setCurrentTime(activeLoop.b as number)
    const decision = decideAtBoundary(completedRef.current, activeLoop.count)
    completedRef.current = decision.completedCycles
    setCompletedCycles(decision.completedCycles)

    if (!decision.shouldContinue) {
      setLoopState((previous) => ({ ...previous, enabled: false }))
      loopRef.current = { ...activeLoop, enabled: false }
      boundaryBusyRef.current = false
      setIsLoopWaiting(false)
      return
    }

    const operation = operationRef.current
    setIsLoopWaiting(true)
    timerRef.current = window.setTimeout(async () => {
      if (operation !== operationRef.current || !loopRef.current.enabled) return
      audio.currentTime = activeLoop.a as number
      setCurrentTime(activeLoop.a as number)
      setIsLoopWaiting(false)
      boundaryBusyRef.current = false
      await safePlay()
    }, Math.max(0, activeLoop.pauseMs))
  }, [safePlay])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const tick = () => {
      setCurrentTime(audio.currentTime)
      const activeLoop = loopRef.current
      if (
        activeLoop.enabled &&
        activeLoop.b !== null &&
        reachedBoundary(audio.currentTime, activeLoop.b)
      ) {
        finishBoundary()
      }
      if (!audio.paused) rafRef.current = window.requestAnimationFrame(tick)
    }
    const onLoadedMetadata = () => {
      const finiteDuration = Number.isFinite(audio.duration) ? audio.duration : 0
      setDuration(finiteDuration)
      setCurrentTime(audio.currentTime)
      setReady(true)
      setError(null)
    }
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
      const activeLoop = loopRef.current
      if (
        activeLoop.enabled &&
        activeLoop.b !== null &&
        reachedBoundary(audio.currentTime, activeLoop.b)
      ) {
        finishBoundary()
      }
    }
    const onPlay = () => {
      setPlaying(true)
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current)
      rafRef.current = window.requestAnimationFrame(tick)
    }
    const onPause = () => setPlaying(false)
    const onEnded = () => {
      setPlaying(false)
      setCurrentTime(audio.duration || 0)
    }
    const onError = () => {
      const detail = audio.error?.message || '音频解码失败，请确认文件格式受浏览器支持。'
      setError(detail)
      setReady(false)
    }
    const onDurationChange = () => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration)
    }

    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    return () => {
      audio.pause()
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current)
    }
  }, [finishBoundary])

  const loadSource = useCallback((url: string, name: string) => {
    const audio = audioRef.current
    if (!audio) return
    clearWaiting()
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    setReady(false)
    setDuration(0)
    setCurrentTime(0)
    setCompletedCycles(0)
    completedRef.current = 0
    setLoopState((previous) => ({ ...previous, a: null, b: null, enabled: false }))
    loopRef.current = { ...loopRef.current, a: null, b: null, enabled: false }
    setSourceUrl(url)
    setFileName(name)
    setError(null)
    audio.src = url
    audio.load()
  }, [clearWaiting])

  const clearSource = useCallback(() => {
    const audio = audioRef.current
    clearWaiting()
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    setSourceUrl(null)
    setFileName('')
    setDuration(0)
    setCurrentTime(0)
    setReady(false)
    setError(null)
    setLoopState(initialLoop)
    loopRef.current = initialLoop
  }, [clearWaiting])

  const pause = useCallback(() => {
    clearWaiting()
    audioRef.current?.pause()
  }, [clearWaiting])

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) return
    if (!audio.paused || isLoopWaiting) pause()
    else await safePlay()
  }, [isLoopWaiting, pause, safePlay])

  const seek = useCallback((time: number, cancelLoop = true) => {
    const audio = audioRef.current
    if (!audio) return
    if (cancelLoop) {
      clearWaiting()
      setLoopState((previous) => ({ ...previous, enabled: false }))
      loopRef.current = { ...loopRef.current, enabled: false }
    }
    const value = clampTime(time, durationRef.current)
    audio.currentTime = value
    setCurrentTime(value)
  }, [clearWaiting])

  const playAll = useCallback(async () => {
    clearWaiting()
    setLoopState((previous) => ({ ...previous, enabled: false }))
    loopRef.current = { ...loopRef.current, enabled: false }
    if (currentTime >= durationRef.current - 0.05 && audioRef.current) {
      audioRef.current.currentTime = 0
      setCurrentTime(0)
    }
    await safePlay()
  }, [clearWaiting, currentTime, safePlay])

  const startLoop = useCallback(async ({ a, b, count, pauseMs }: StartLoopOptions) => {
    if (!isValidLoopRange(a, b, durationRef.current)) {
      setError('循环区间无效：B 点必须晚于 A 点，且不能超过音频时长。')
      return false
    }
    clearWaiting()
    const audio = audioRef.current
    if (!audio) return false
    const nextLoop: LoopRange = {
      a,
      b,
      enabled: true,
      count: count ?? loopRef.current.count,
      pauseMs: pauseMs ?? loopRef.current.pauseMs,
    }
    loopRef.current = nextLoop
    setLoopState(nextLoop)
    completedRef.current = 0
    setCompletedCycles(0)
    audio.currentTime = a
    setCurrentTime(a)
    return safePlay()
  }, [clearWaiting, safePlay])

  const setLoopPoint = useCallback((point: 'a' | 'b') => {
    const value = currentTime
    setLoopState((previous) => {
      const next = { ...previous, [point]: value, enabled: false }
      loopRef.current = next
      return next
    })
    completedRef.current = 0
    setCompletedCycles(0)
  }, [currentTime])

  const updateLoopOptions = useCallback((options: Partial<Pick<LoopRange, 'count' | 'pauseMs'>>) => {
    setLoopState((previous) => {
      const next = { ...previous, ...options }
      loopRef.current = next
      return next
    })
  }, [])

  const cancelLoop = useCallback(() => {
    clearWaiting()
    setLoopState((previous) => ({ ...previous, enabled: false }))
    loopRef.current = { ...loopRef.current, enabled: false }
    completedRef.current = 0
    setCompletedCycles(0)
  }, [clearWaiting])

  const resumeConfiguredLoop = useCallback(async () => {
    const configured = loopRef.current
    if (!isValidLoopRange(configured.a, configured.b, durationRef.current)) {
      setError('请先设置有效的 A、B 点。')
      return false
    }
    return startLoop({
      a: configured.a as number,
      b: configured.b as number,
      count: configured.count,
      pauseMs: configured.pauseMs,
    })
  }, [startLoop])

  const setPlaybackRate = useCallback((rate: number) => {
    const value = Math.max(0.5, Math.min(1.5, rate))
    if (audioRef.current) audioRef.current.playbackRate = value
    setPlaybackRateState(value)
  }, [])

  return {
    sourceUrl,
    fileName,
    duration,
    currentTime,
    playing,
    ready,
    error,
    playbackRate,
    loop,
    completedCycles,
    isLoopWaiting,
    loadSource,
    clearSource,
    togglePlayback,
    pause,
    seek,
    playAll,
    startLoop,
    resumeConfiguredLoop,
    setLoopPoint,
    updateLoopOptions,
    cancelLoop,
    setPlaybackRate,
  }
}
