import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAudioEngine } from './audio/useAudioEngine'
import type { TranscriptionResult } from './ai/types'
import { AiTranscriptionPanel } from './components/AiTranscriptionPanel'
import { AudioImport } from './components/AudioImport'
import { PlayerControls } from './components/PlayerControls'
import { SegmentEditor } from './components/SegmentEditor'
import { StructureTree } from './components/StructureTree'
import { StudyPackagePanel } from './components/StudyPackagePanel'
import { createMockWorkspace } from './data/mockData'
import { mergeSegments, splitSegment } from './domain/segmentOps'
import { importAnalysis } from './domain/importAnalysis'
import {
  describeStorage,
  isQuotaError,
  loadAudioBlob,
  loadWorkspace,
  replaceAudioBlobs,
  saveAudioBlob,
  saveWorkspace,
} from './persistence/database'
import { migrateWorkspace } from './persistence/migrations'
import { buildStudyPackage, downloadBlob, readStudyPackage } from './persistence/studyPackage'
import type { AudioAsset, AudioBindingScope, LoopCount, Passage, Segment, WorkspaceState } from './types'
import { createId, nowIso } from './types'
import { formatBytes, formatTime } from './utils/format'

type Notice = { tone: 'success' | 'warning' | 'error'; text: string }

const supportedExtensions = new Set(['mp3', 'm4a', 'mp4'])

const updateRecord = <T extends { id: string; updatedAt: string }>(
  record: Record<string, T>,
  id: string,
  changes: Partial<T>,
) => ({ ...record, [id]: { ...record[id], ...changes, updatedAt: nowIso() } })

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(createMockWorkspace)
  const [hydrated, setHydrated] = useState(false)
  const [saveState, setSaveState] = useState<'loading' | 'saved' | 'saving' | 'error'>('loading')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [importing, setImporting] = useState(false)
  const [storage, setStorage] = useState<{ usage: number; quota: number }>()
  const [packageState, setPackageState] = useState({ busy: false, progress: 0, message: '' })
  const engine = useAudioEngine()
  const objectUrlRef = useRef<string | null>(null)
  const loadedAssetIdRef = useRef<string | null>(null)
  const restoredKeyRef = useRef<string | null>(null)
  const currentTimeRef = useRef(0)

  const activeExam = workspace.exams[workspace.activeExamId] ?? Object.values(workspace.exams)[0]
  const activePassage = workspace.passages[workspace.activePassageId]
  const activeSection = activePassage ? workspace.sections[activePassage.sectionId] : undefined
  const sections = useMemo(
    () => activeExam.sectionIds.map((id) => workspace.sections[id]).filter(Boolean).sort((a, b) => a.order - b.order),
    [activeExam.sectionIds, workspace.sections],
  )
  const segments = useMemo(
    () => activePassage
      ? activePassage.segmentIds.map((id) => workspace.segments[id]).filter(Boolean).sort((a, b) => a.startTime - b.startTime || a.order - b.order)
      : [],
    [activePassage, workspace.segments],
  )
  const progress = workspace.progress[workspace.activePassageId] ?? {
    passageId: workspace.activePassageId,
    currentTime: 0,
    playbackRate: 1,
    transcriptVisible: true,
    completedSegmentIds: [],
  }
  const activeSegment = segments.find(
    (segment) => engine.currentTime >= segment.startTime && engine.currentTime < segment.endTime,
  )
  const activeAssetId = activePassage?.audioAssetId ?? activeExam.audioAssetId
  const activeAsset = activeAssetId
    ? workspace.audioAssets[activeAssetId]
    : undefined
  const hasStarterSegments = activePassage?.id === 'passage_1' &&
    activePassage.segmentIds.some((id) => id === 'segment_1' || id === 'segment_2')

  useEffect(() => {
    let cancelled = false
    const hydrate = async () => {
      try {
        const stored = await loadWorkspace()
        if (!cancelled && stored) setWorkspace(migrateWorkspace(stored))
        if (!cancelled) setSaveState('saved')
      } catch (error) {
        if (!cancelled) {
          setSaveState('error')
          setNotice({
            tone: 'error',
            text: `无法读取本地进度：${error instanceof Error ? error.message : '未知错误'}`,
          })
        }
      } finally {
        if (!cancelled) setHydrated(true)
      }
      try {
        const estimate = await describeStorage()
        if (!cancelled) setStorage(estimate)
      } catch {
        // Storage estimates are optional; persistence still works without them.
      }
    }
    void hydrate()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    setSaveState('saving')
    const timer = window.setTimeout(async () => {
      try {
        await saveWorkspace(workspace)
        setSaveState('saved')
      } catch (error) {
        setSaveState('error')
        setNotice({
          tone: 'error',
          text: `进度保存失败：${error instanceof Error ? error.message : '浏览器本地存储不可用'}`,
        })
      }
    }, 450)
    return () => window.clearTimeout(timer)
  }, [hydrated, workspace])

  useEffect(() => {
    document.documentElement.dataset.theme = workspace.preferences.theme
  }, [workspace.preferences.theme])

  useEffect(() => {
    currentTimeRef.current = engine.currentTime
  }, [engine.currentTime])

  useEffect(() => {
    if (!hydrated) return
    const timer = window.setInterval(() => {
      setWorkspace((previous) => {
        const passageId = previous.activePassageId
        const previousProgress = previous.progress[passageId]
        if (!previousProgress || Math.abs(previousProgress.currentTime - currentTimeRef.current) < 0.5) return previous
        return {
          ...previous,
          progress: {
            ...previous.progress,
            [passageId]: {
              ...previousProgress,
              currentTime: currentTimeRef.current,
              lastPlayedAt: new Date().toISOString(),
            },
          },
        }
      })
    }, 1500)
    return () => window.clearInterval(timer)
  }, [hydrated])

  const activateBlob = useCallback((assetId: string, blob: Blob, name: string) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    const url = URL.createObjectURL(blob)
    objectUrlRef.current = url
    loadedAssetIdRef.current = assetId
    restoredKeyRef.current = null
    engine.loadSource(url, name)
  }, [engine.loadSource])

  useEffect(() => {
    if (!hydrated) return
    const assetId = activeAssetId
    if (!assetId) {
      if (loadedAssetIdRef.current !== null) {
        engine.clearSource()
        loadedAssetIdRef.current = null
        restoredKeyRef.current = null
      }
      return
    }
    if (loadedAssetIdRef.current === assetId) return
    const asset = workspace.audioAssets[assetId]
    if (!asset) return
    let cancelled = false
    const restoreAudio = async () => {
      if (asset.storageMode === 'session') {
        engine.clearSource()
        loadedAssetIdRef.current = assetId
        setWorkspace((previous) => ({
          ...previous,
          audioAssets: updateRecord(previous.audioAssets, assetId, { availability: 'missing', lastError: '刷新后需要重新选择原文件。' }),
        }))
        setNotice({ tone: 'warning', text: `“${asset.name}”未保存到 IndexedDB，请重新导入该文件。` })
        return
      }
      try {
        const blob = await loadAudioBlob(assetId)
        if (cancelled) return
        if (!blob) {
          engine.clearSource()
          loadedAssetIdRef.current = assetId
          setWorkspace((previous) => ({
            ...previous,
            audioAssets: updateRecord(previous.audioAssets, assetId, { availability: 'missing', lastError: 'IndexedDB 中没有对应的音频 Blob。' }),
          }))
          setNotice({ tone: 'warning', text: `找不到“${asset.name}”的本地音频数据，请重新导入。` })
          return
        }
        activateBlob(assetId, blob, asset.name)
      } catch (error) {
        if (!cancelled) {
          loadedAssetIdRef.current = assetId
          setNotice({ tone: 'error', text: `读取音频失败：${error instanceof Error ? error.message : '未知错误'}` })
        }
      }
    }
    void restoreAudio()
    return () => { cancelled = true }
  }, [activeAssetId, activateBlob, engine.clearSource, hydrated, workspace.audioAssets])

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [])

  useEffect(() => {
    const assetId = activeAssetId
    if (!engine.ready || !assetId || loadedAssetIdRef.current !== assetId) return
    const restoreKey = `${workspace.activePassageId}:${assetId}`
    if (restoredKeyRef.current === restoreKey) return
    restoredKeyRef.current = restoreKey
    engine.setPlaybackRate(progress.playbackRate)
    if (progress.currentTime > 0 && progress.currentTime < engine.duration) {
      engine.seek(progress.currentTime, false)
    }
  }, [activeAssetId, engine.duration, engine.ready, engine.seek, engine.setPlaybackRate, progress.currentTime, progress.playbackRate, workspace.activePassageId])

  useEffect(() => {
    const assetId = loadedAssetIdRef.current
    if (!engine.ready || !assetId || engine.duration <= 0) return
    setWorkspace((previous) => {
      const asset = previous.audioAssets[assetId]
      if (!asset || Math.abs(asset.duration - engine.duration) < 0.05) return previous
      return {
        ...previous,
        audioAssets: updateRecord(previous.audioAssets, assetId, {
          duration: engine.duration,
          availability: 'available',
          lastError: undefined,
        }),
      }
    })
  }, [engine.duration, engine.ready])

  const handleImport = async (file: File, persist: boolean, scope: AudioBindingScope) => {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!supportedExtensions.has(extension)) {
      setNotice({ tone: 'error', text: '仅支持 MP3、M4A 和浏览器兼容的 MP4 文件。' })
      return
    }
    setImporting(true)
    const id = createId('audio')
    let storageMode: AudioAsset['storageMode'] = persist ? 'indexeddb' : 'session'
    let persistenceFailed = false
    try {
      if (persist) {
        await saveAudioBlob(id, file)
        if (navigator.storage?.persist) void navigator.storage.persist()
      }
    } catch (error) {
      storageMode = 'session'
      persistenceFailed = true
      setNotice({
        tone: 'warning',
        text: isQuotaError(error)
          ? `存储空间不足，${file.name} 本次仍可播放，但刷新后需要重新导入。`
          : `音频无法持久保存，本次按临时文件使用：${error instanceof Error ? error.message : '未知错误'}`,
      })
    }

    const timestamp = nowIso()
    const asset: AudioAsset = {
      id,
      name: file.name,
      mimeType: file.type || `audio/${extension}`,
      size: file.size,
      duration: 0,
      storageMode,
      availability: 'available',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    activateBlob(id, file, file.name)
    setWorkspace((previous) => {
      let exams = previous.exams
      let passages = previous.passages
      if (scope === 'exam') {
        exams = updateRecord(previous.exams, previous.activeExamId, { audioAssetId: id })
        const active = previous.passages[previous.activePassageId]
        if (active.audioAssetId) {
          const { audioAssetId: _removed, ...withoutOverride } = active
          passages = {
            ...previous.passages,
            [active.id]: { ...withoutOverride, updatedAt: nowIso() },
          }
        }
      } else {
        passages = updateRecord(previous.passages, previous.activePassageId, { audioAssetId: id })
      }
      return {
        ...previous,
        exams,
        passages,
        audioAssets: { ...previous.audioAssets, [id]: asset },
      }
    })
    if (!persistenceFailed) {
      setNotice({
        tone: 'success',
        text: persist
          ? `已导入并保存 ${file.name}（${formatBytes(file.size)}），${scope === 'exam' ? '整份试卷共用' : '仅用于当前材料'}。`
          : `已临时导入 ${file.name}，${scope === 'exam' ? '整份试卷共用' : '仅用于当前材料'}；刷新后需重新选择文件。`,
      })
    }
    try {
      setStorage(await describeStorage())
    } catch {
      // Optional UI estimate.
    }
    setImporting(false)
  }

  const selectPassage = (id: string) => {
    engine.pause()
    setWorkspace((previous) => {
      const previousId = previous.activePassageId
      const nextProgress = previous.progress[id] ?? {
        passageId: id,
        currentTime: 0,
        playbackRate: 1,
        transcriptVisible: true,
        completedSegmentIds: [],
      }
      return {
        ...previous,
        activePassageId: id,
        progress: {
          ...previous.progress,
          [previousId]: {
            ...previous.progress[previousId],
            currentTime: currentTimeRef.current,
          },
          [id]: nextProgress,
        },
      }
    })
  }

  const renameExam = (title: string) => setWorkspace((previous) => ({
    ...previous,
    exams: updateRecord(previous.exams, previous.activeExamId, { title }),
  }))
  const renameSection = (id: string, title: string) => setWorkspace((previous) => ({
    ...previous,
    sections: updateRecord(previous.sections, id, { title, recognitionStatus: 'human_corrected', associationStatus: 'confirmed' }),
  }))
  const renamePassage = (id: string, title: string) => setWorkspace((previous) => ({
    ...previous,
    passages: updateRecord(previous.passages, id, { title, recognitionStatus: 'human_corrected', associationStatus: 'confirmed', classificationStatus: 'confirmed' }),
  }))
  const updateQuestionPrompt = (id: string, prompt: string) => setWorkspace((previous) => ({
    ...previous,
    questions: updateRecord(previous.questions, id, { prompt, associationStatus: 'confirmed' }),
  }))

  const addSection = () => {
    const title = window.prompt('新大题名称', `問題${activeExam.sectionIds.length + 1}`)?.trim()
    if (!title) return
    const id = createId('section')
    const timestamp = nowIso()
    setWorkspace((previous) => ({
      ...previous,
      exams: updateRecord(previous.exams, previous.activeExamId, {
        sectionIds: [...previous.exams[previous.activeExamId].sectionIds, id],
      }),
      sections: {
        ...previous.sections,
        [id]: {
          id,
          examId: previous.activeExamId,
          title,
          order: previous.exams[previous.activeExamId].sectionIds.length,
          passageIds: [],
          recognitionStatus: 'unrecognized',
          associationStatus: 'confirmed',
          origin: 'manual',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
    }))
  }

  const addPassage = (sectionId: string) => {
    const section = workspace.sections[sectionId]
    const title = window.prompt('新听力材料名称', `听力材料 ${section.passageIds.length + 1}`)?.trim()
    if (!title) return
    const id = createId('passage')
    const timestamp = nowIso()
    setWorkspace((previous) => ({
      ...previous,
      activePassageId: id,
      sections: updateRecord(previous.sections, sectionId, {
        passageIds: [...previous.sections[sectionId].passageIds, id],
      }),
      passages: {
        ...previous.passages,
        [id]: {
          id,
          sectionId,
          title,
          order: previous.sections[sectionId].passageIds.length,
          questionIds: [],
          segmentIds: [],
          recognitionStatus: 'unrecognized',
          classificationStatus: 'not_started',
          associationStatus: 'confirmed',
          origin: 'manual',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
      progress: {
        ...previous.progress,
        [id]: { passageId: id, currentTime: 0, playbackRate: 1, transcriptVisible: true, completedSegmentIds: [] },
      },
    }))
  }

  const addQuestion = (passageId: string) => {
    const passage = workspace.passages[passageId]
    const prompt = window.prompt('小题题干', '输入题目…')?.trim()
    if (!prompt) return
    const id = createId('question')
    const timestamp = nowIso()
    setWorkspace((previous) => ({
      ...previous,
      passages: updateRecord(previous.passages, passageId, {
        questionIds: [...previous.passages[passageId].questionIds, id],
      }),
      questions: {
        ...previous.questions,
        [id]: {
          id,
          passageId,
          label: `Q${passage.questionIds.length + 1}`,
          prompt,
          order: passage.questionIds.length,
          segmentIds: [],
          associationStatus: 'confirmed',
          origin: 'manual',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
    }))
  }

  const toggleQuestionSegment = (questionId: string, segmentId: string) => setWorkspace((previous) => {
    const question = previous.questions[questionId]
    const segmentIds = question.segmentIds.includes(segmentId)
      ? question.segmentIds.filter((id) => id !== segmentId)
      : [...question.segmentIds, segmentId]
    return { ...previous, questions: updateRecord(previous.questions, questionId, { segmentIds }) }
  })

  const createSegment = () => {
    const duration = engine.duration
    const startTime = duration > 0
      ? Math.min(engine.currentTime, Math.max(0, duration - 0.05))
      : engine.currentTime
    const endTime = duration > 0 ? Math.min(startTime + 3, duration) : startTime + 3
    if (endTime <= startTime) {
      setNotice({ tone: 'warning', text: '当前已在音频结尾，请先移动时间轴。' })
      return
    }
    const id = createId('segment')
    const timestamp = nowIso()
    const segment: Segment = {
      id,
      passageId: workspace.activePassageId,
      startTime: Number(startTime.toFixed(3)),
      endTime: Number(endTime.toFixed(3)),
      text: '',
      order: segments.length,
      source: 'manual',
      recognitionStatus: 'unrecognized',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    setWorkspace((previous) => ({
      ...previous,
      segments: { ...previous.segments, [id]: segment },
      passages: updateRecord(previous.passages, previous.activePassageId, {
        segmentIds: [...previous.passages[previous.activePassageId].segmentIds, id],
      }),
    }))
    if (engine.ready) engine.seek(endTime)
    setNotice({ tone: 'success', text: `已创建 ${formatTime(startTime)}–${formatTime(endTime)} 的 3 秒句子区间。` })
  }

  const useActiveAudioForExam = () => {
    const passageAssetId = activePassage?.audioAssetId
    if (!passageAssetId) return
    setWorkspace((previous) => {
      const passage = previous.passages[previous.activePassageId]
      const { audioAssetId: _removed, ...withoutOverride } = passage
      return {
        ...previous,
        exams: updateRecord(previous.exams, previous.activeExamId, { audioAssetId: passageAssetId }),
        passages: {
          ...previous.passages,
          [passage.id]: { ...withoutOverride, updatedAt: nowIso() },
        },
      }
    })
    setNotice({ tone: 'success', text: '当前音频已设为整份试卷共用，切换大题或材料时无需重新导入。' })
  }

  const clearStarterSegments = () => {
    if (!window.confirm('清除当前材料中的模拟句子？音频文件不会被删除。')) return
    setWorkspace((previous) => {
      const passageId = previous.activePassageId
      const ids = previous.passages[passageId].segmentIds
      const nextSegments = { ...previous.segments }
      ids.forEach((id) => delete nextSegments[id])
      const questions = Object.fromEntries(Object.entries(previous.questions).map(([id, question]) => [
        id,
        question.passageId === passageId
          ? { ...question, segmentIds: [], updatedAt: nowIso() }
          : question,
      ]))
      return {
        ...previous,
        segments: nextSegments,
        questions,
        passages: updateRecord(previous.passages, passageId, { segmentIds: [] }),
      }
    })
    setNotice({ tone: 'success', text: '模拟句子已清除。移动时间轴后可连续创建真实句子区间。' })
  }

  const updateSegment = (id: string, changes: Partial<Pick<Segment, 'startTime' | 'endTime' | 'text'>>) => {
    setWorkspace((previous) => {
      const old = previous.segments[id]
      if (!old) return previous
      const next = { ...old, ...changes }
      if ('startTime' in changes) {
        next.startTime = Math.max(0, Number.isFinite(next.startTime) ? next.startTime : 0)
        if (engine.duration > 0) next.startTime = Math.min(next.startTime, engine.duration - 0.05)
        if (next.startTime >= next.endTime) next.endTime = Math.min(engine.duration || next.startTime + 0.05, next.startTime + 0.05)
      }
      if ('endTime' in changes) {
        next.endTime = Math.max(0.05, Number.isFinite(next.endTime) ? next.endTime : old.endTime)
        if (engine.duration > 0) next.endTime = Math.min(next.endTime, engine.duration)
        if (next.endTime <= next.startTime) next.startTime = Math.max(0, next.endTime - 0.05)
      }
      next.recognitionStatus = 'human_corrected'
      return { ...previous, segments: updateRecord(previous.segments, id, next) }
    })
  }

  const deleteSegment = (id: string) => setWorkspace((previous) => {
    const nextSegments = { ...previous.segments }
    delete nextSegments[id]
    const passageId = previous.segments[id]?.passageId ?? previous.activePassageId
    const questions = Object.fromEntries(Object.entries(previous.questions).map(([questionId, question]) => [
      questionId,
      question.segmentIds.includes(id)
        ? { ...question, segmentIds: question.segmentIds.filter((segmentId) => segmentId !== id), updatedAt: nowIso() }
        : question,
    ]))
    return {
      ...previous,
      segments: nextSegments,
      questions,
      passages: updateRecord(previous.passages, passageId, {
        segmentIds: previous.passages[passageId].segmentIds.filter((segmentId) => segmentId !== id),
      }),
    }
  })

  const handleMerge = (ids: string[]) => {
    try {
      const result = mergeSegments(segments, ids)
      setWorkspace((previous) => {
        const nextSegments = { ...previous.segments }
        result.removedIds.forEach((id) => delete nextSegments[id])
        result.segments.forEach((segment) => { nextSegments[segment.id] = segment })
        const questions = Object.fromEntries(Object.entries(previous.questions).map(([questionId, question]) => {
          const shouldReplace = question.segmentIds.some((id) => result.removedIds.includes(id))
          if (!shouldReplace || !result.replacementId) return [questionId, question]
          const segmentIds = Array.from(new Set(question.segmentIds.map((id) =>
            result.removedIds.includes(id) ? result.replacementId as string : id,
          )))
          return [questionId, { ...question, segmentIds, updatedAt: nowIso() }]
        }))
        return {
          ...previous,
          segments: nextSegments,
          questions,
          passages: updateRecord(previous.passages, previous.activePassageId, {
            segmentIds: result.segments.map((segment) => segment.id),
          }),
        }
      })
      setNotice({ tone: 'success', text: `已合并 ${ids.length} 个句子，题目引用已同步。` })
    } catch (error) {
      setNotice({ tone: 'warning', text: error instanceof Error ? error.message : '无法合并句子。' })
    }
  }

  const handleSplit = (id: string) => {
    const target = workspace.segments[id]
    if (!target) return
    const splitAt = engine.currentTime > target.startTime + 0.05 && engine.currentTime < target.endTime - 0.05
      ? engine.currentTime
      : (target.startTime + target.endTime) / 2
    try {
      const result = splitSegment(segments, id, splitAt, createId('segment'))
      setWorkspace((previous) => {
        const nextSegments = { ...previous.segments }
        result.segments.forEach((segment) => { nextSegments[segment.id] = segment })
        const questions = result.createdId
          ? Object.fromEntries(Object.entries(previous.questions).map(([questionId, question]) => {
              if (!question.segmentIds.includes(id)) return [questionId, question]
              const segmentIds = question.segmentIds.flatMap((segmentId) => segmentId === id ? [id, result.createdId as string] : [segmentId])
              return [questionId, { ...question, segmentIds, updatedAt: nowIso() }]
            }))
          : previous.questions
        return {
          ...previous,
          segments: nextSegments,
          questions,
          passages: updateRecord(previous.passages, previous.activePassageId, {
            segmentIds: result.segments.map((segment) => segment.id),
          }),
        }
      })
      setNotice({ tone: 'success', text: `已在 ${formatTime(splitAt)} 拆分句子。` })
    } catch (error) {
      setNotice({ tone: 'warning', text: error instanceof Error ? error.message : '无法拆分句子。' })
    }
  }

  const playSegment = useCallback((segment: Segment) => {
    void engine.startLoop({
      a: segment.startTime,
      b: segment.endTime,
      count: workspace.preferences.defaultLoopCount,
      pauseMs: workspace.preferences.loopPauseMs,
    })
  }, [engine.startLoop, workspace.preferences.defaultLoopCount, workspace.preferences.loopPauseMs])

  const playRelativeSegment = useCallback((direction: -1 | 1) => {
    if (segments.length === 0) return
    let index = segments.findIndex((segment) => engine.currentTime >= segment.startTime && engine.currentTime < segment.endTime)
    if (index === -1) index = segments.findIndex((segment) => segment.startTime > engine.currentTime)
    if (index === -1) index = segments.length - 1
    const targetIndex = direction === -1 ? Math.max(0, index - 1) : Math.min(segments.length - 1, index + 1)
    playSegment(segments[targetIndex])
  }, [engine.currentTime, playSegment, segments])

  const setRate = (rate: number) => {
    engine.setPlaybackRate(rate)
    setWorkspace((previous) => ({
      ...previous,
      progress: {
        ...previous.progress,
        [previous.activePassageId]: { ...previous.progress[previous.activePassageId], playbackRate: rate },
      },
    }))
  }
  const setLoopCount = (count: LoopCount) => {
    engine.updateLoopOptions({ count })
    setWorkspace((previous) => ({ ...previous, preferences: { ...previous.preferences, defaultLoopCount: count } }))
  }
  const setPauseMs = (loopPauseMs: number) => {
    engine.updateLoopOptions({ pauseMs: loopPauseMs })
    setWorkspace((previous) => ({ ...previous, preferences: { ...previous.preferences, loopPauseMs } }))
  }
  const toggleTranscript = useCallback(() => setWorkspace((previous) => {
    const passageId = previous.activePassageId
    return {
      ...previous,
      progress: {
        ...previous.progress,
        [passageId]: {
          ...previous.progress[passageId],
          transcriptVisible: !previous.progress[passageId].transcriptVisible,
        },
      },
    }
  }), [])

  const updateSectionBoundary = (id: string, field: 'startTime' | 'endTime', value: number) => {
    if (!Number.isFinite(value) || value < 0) return
    setWorkspace((previous) => ({
      ...previous,
      sections: updateRecord(previous.sections, id, {
        [field]: value,
        recognitionStatus: 'human_corrected',
        associationStatus: 'confirmed',
      }),
    }))
  }

  const updatePassageBoundary = (id: string, field: 'startTime' | 'endTime', value: number) => {
    if (!Number.isFinite(value) || value < 0) return
    setWorkspace((previous) => ({
      ...previous,
      passages: updateRecord(previous.passages, id, {
        [field]: value,
        recognitionStatus: 'human_corrected',
        associationStatus: 'confirmed',
        classificationStatus: 'confirmed',
      }),
    }))
  }

  const confirmEntity = (kind: 'section' | 'passage' | 'question', id: string) => setWorkspace((previous) => {
    if (kind === 'section') {
      return { ...previous, sections: updateRecord(previous.sections, id, { associationStatus: 'confirmed', recognitionStatus: 'human_corrected' }) }
    }
    if (kind === 'passage') {
      return { ...previous, passages: updateRecord(previous.passages, id, { associationStatus: 'confirmed', classificationStatus: 'confirmed', recognitionStatus: 'human_corrected' }) }
    }
    return { ...previous, questions: updateRecord(previous.questions, id, { associationStatus: 'confirmed' }) }
  })

  const moveQuestion = (questionId: string, passageId: string) => setWorkspace((previous) => {
    const question = previous.questions[questionId]
    const destination = previous.passages[passageId]
    if (!question || !destination || question.passageId === passageId) return previous
    const source = previous.passages[question.passageId]
    const validSegmentIds = question.segmentIds.filter((id) => previous.segments[id]?.passageId === passageId)
    return {
      ...previous,
      passages: {
        ...previous.passages,
        [source.id]: { ...source, questionIds: source.questionIds.filter((id) => id !== questionId), updatedAt: nowIso() },
        [destination.id]: { ...destination, questionIds: [...destination.questionIds, questionId], updatedAt: nowIso() },
      },
      questions: updateRecord(previous.questions, questionId, {
        passageId,
        segmentIds: validSegmentIds,
        associationStatus: 'confirmed',
      }),
    }
  })

  const mergePassage = (passageId: string) => {
    const passage = workspace.passages[passageId]
    const section = passage && workspace.sections[passage.sectionId]
    const index = section?.passageIds.indexOf(passageId) ?? -1
    if (!section || index <= 0) {
      setNotice({ tone: 'warning', text: '当前材料前面没有可合并的材料。' })
      return
    }
    const previousPassageId = section.passageIds[index - 1]
    setWorkspace((previous) => {
      const current = previous.passages[passageId]
      const target = previous.passages[previousPassageId]
      if (!current || !target) return previous
      const combinedIds = [...target.segmentIds, ...current.segmentIds]
        .filter((id, position, all) => all.indexOf(id) === position)
        .sort((a, b) => previous.segments[a].startTime - previous.segments[b].startTime)
      const nextSegments = { ...previous.segments }
      combinedIds.forEach((id, order) => {
        nextSegments[id] = { ...nextSegments[id], passageId: target.id, order, updatedAt: nowIso() }
      })
      const nextQuestions = { ...previous.questions }
      current.questionIds.forEach((id) => {
        nextQuestions[id] = { ...nextQuestions[id], passageId: target.id, associationStatus: 'confirmed', updatedAt: nowIso() }
      })
      const combinedStarts = [target.startTime, current.startTime, combinedIds.length ? nextSegments[combinedIds[0]].startTime : undefined]
        .filter((value): value is number => value !== undefined)
      const combinedEnds = [target.endTime, current.endTime, combinedIds.length ? nextSegments[combinedIds.at(-1) as string].endTime : undefined]
        .filter((value): value is number => value !== undefined)
      const nextPassages = { ...previous.passages }
      nextPassages[target.id] = {
        ...target,
        segmentIds: combinedIds,
        questionIds: [...target.questionIds, ...current.questionIds]
          .filter((id, position, all) => all.indexOf(id) === position),
        startTime: combinedStarts.length ? Math.min(...combinedStarts) : 0,
        endTime: combinedEnds.length ? Math.max(...combinedEnds) : 0,
        associationStatus: 'confirmed',
        classificationStatus: 'confirmed',
        recognitionStatus: 'human_corrected',
        updatedAt: nowIso(),
      }
      delete nextPassages[current.id]
      const nextProgress = { ...previous.progress }
      delete nextProgress[current.id]
      return {
        ...previous,
        activePassageId: target.id,
        sections: updateRecord(previous.sections, section.id, {
          passageIds: previous.sections[section.id].passageIds.filter((id) => id !== current.id),
          recognitionStatus: 'human_corrected',
          associationStatus: 'confirmed',
        }),
        passages: nextPassages,
        questions: nextQuestions,
        segments: nextSegments,
        progress: nextProgress,
      }
    })
    setNotice({ tone: 'success', text: '两个听力材料已合并，句子与小题关联已同步。' })
  }

  const splitPassageAtPlayhead = (passageId: string) => {
    const passage = workspace.passages[passageId]
    if (!passage) return
    const passageSegments = passage.segmentIds.map((id) => workspace.segments[id]).filter(Boolean)
    const start = passage.startTime ?? (passageSegments.length
      ? Math.min(...passageSegments.map((segment) => segment.startTime))
      : 0)
    const end = passage.endTime ?? (passageSegments.length
      ? Math.max(...passageSegments.map((segment) => segment.endTime))
      : engine.duration)
    const splitAt = engine.currentTime
    if (splitAt <= start + 0.05 || splitAt >= end - 0.05) {
      setNotice({ tone: 'warning', text: '播放头必须位于当前材料边界内部才能拆分。' })
      return
    }
    const newId = createId('passage')
    setWorkspace((previous) => {
      const current = previous.passages[passageId]
      const section = previous.sections[current.sectionId]
      const movedSegmentIds = current.segmentIds.filter((id) => previous.segments[id].startTime >= splitAt)
      const keptSegmentIds = current.segmentIds.filter((id) => !movedSegmentIds.includes(id))
      const nextSegments = { ...previous.segments }
      movedSegmentIds.forEach((id, order) => {
        nextSegments[id] = { ...nextSegments[id], passageId: newId, order, updatedAt: nowIso() }
      })
      keptSegmentIds.forEach((id, order) => {
        nextSegments[id] = { ...nextSegments[id], order, updatedAt: nowIso() }
      })
      const movedQuestionIds: string[] = []
      const keptQuestionIds: string[] = []
      const nextQuestions = { ...previous.questions }
      current.questionIds.forEach((id) => {
        const question = previous.questions[id]
        const references = question.segmentIds
        const moves = references.length > 0
          ? references.every((segmentId) => movedSegmentIds.includes(segmentId))
          : (question.startTime ?? -1) >= splitAt
        if (moves) {
          movedQuestionIds.push(id)
          nextQuestions[id] = { ...question, passageId: newId, associationStatus: 'confirmed', updatedAt: nowIso() }
        } else {
          keptQuestionIds.push(id)
          if (references.some((segmentId) => movedSegmentIds.includes(segmentId))) {
            nextQuestions[id] = {
              ...question,
              segmentIds: references.filter((segmentId) => keptSegmentIds.includes(segmentId)),
              associationStatus: 'unresolved',
              updatedAt: nowIso(),
            }
          }
        }
      })
      const timestamp = nowIso()
      const insertionIndex = section.passageIds.indexOf(current.id) + 1
      const passageIds = [...section.passageIds]
      passageIds.splice(insertionIndex, 0, newId)
      const nextPassages = {
        ...previous.passages,
        [current.id]: {
          ...current,
          endTime: splitAt,
          segmentIds: keptSegmentIds,
          questionIds: keptQuestionIds,
          associationStatus: 'confirmed' as const,
          classificationStatus: 'confirmed' as const,
          recognitionStatus: 'human_corrected' as const,
          updatedAt: timestamp,
        },
        [newId]: {
          ...current,
          id: newId,
          title: `${current.title}（后半）`,
          order: insertionIndex,
          startTime: splitAt,
          endTime: end,
          segmentIds: movedSegmentIds,
          questionIds: movedQuestionIds,
          associationStatus: 'confirmed' as const,
          classificationStatus: 'confirmed' as const,
          recognitionStatus: 'human_corrected' as const,
          origin: 'manual' as const,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      }
      passageIds.forEach((id, order) => { nextPassages[id] = { ...nextPassages[id], order } })
      return {
        ...previous,
        activePassageId: newId,
        sections: updateRecord(previous.sections, section.id, { passageIds, recognitionStatus: 'human_corrected', associationStatus: 'confirmed' }),
        passages: nextPassages,
        questions: nextQuestions,
        segments: nextSegments,
        progress: {
          ...previous.progress,
          [newId]: { passageId: newId, currentTime: splitAt, playbackRate: 1, transcriptVisible: true, completedSegmentIds: [] },
        },
      }
    })
    setNotice({ tone: 'success', text: `已在 ${formatTime(splitAt)} 拆分听力材料；跨边界题目已标记为无法判断。` })
  }

  const updateAiSettings = (settings: { backendUrl?: string; modelSize?: 'small' | 'medium' }) => setWorkspace((previous) => ({
    ...previous,
    preferences: {
      ...previous.preferences,
      aiBackendUrl: settings.backendUrl ?? previous.preferences.aiBackendUrl,
      aiModelSize: settings.modelSize ?? previous.preferences.aiModelSize,
    },
  }))

  const handleAiResult = (result: TranscriptionResult) => {
    try {
      const imported = importAnalysis(workspace, result, workspace.activeExamId)
      setWorkspace(imported.workspace)
      setNotice({
        tone: 'success',
        text: `已导入 ${imported.summary.segmentCount} 句、${imported.summary.sectionCount} 个大题建议、${imported.summary.passageCount} 个材料和 ${imported.summary.questionCount} 个小题；请确认橙色和灰色关联。`,
      })
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'AI 结果导入失败。' })
    }
  }

  const exportPackage = async () => {
    setPackageState({ busy: true, progress: 0, message: '准备学习包…' })
    try {
      const blob = await buildStudyPackage(workspace, (progressValue, message) => {
        setPackageState({ busy: true, progress: progressValue, message })
      })
      const safeTitle = activeExam.title.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 70) || 'JLPT学习包'
      downloadBlob(blob, `${safeTitle}.jlpt.zip`)
      setNotice({ tone: 'success', text: `学习包已导出（${formatBytes(blob.size)}），可传到手机后直接导入。` })
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '学习包导出失败。' })
    } finally {
      setPackageState({ busy: false, progress: 0, message: '' })
    }
  }

  const importPackage = async (file: File) => {
    if (!window.confirm('导入学习包会替换当前浏览器中的整个工作区。继续前请先导出备份。是否继续？')) return
    setPackageState({ busy: true, progress: 0, message: '读取学习包…' })
    try {
      const imported = await readStudyPackage(file, (progressValue, message) => {
        setPackageState({ busy: true, progress: progressValue, message })
      })
      await replaceAudioBlobs(imported.audio)
      const restored: WorkspaceState = {
        ...imported.workspace,
        audioAssets: Object.fromEntries(Object.entries(imported.workspace.audioAssets).map(([id, asset]) => [
          id,
          { ...asset, storageMode: 'indexeddb' as const, availability: imported.audio.has(id) ? 'available' as const : 'missing' as const },
        ])),
      }
      engine.clearSource()
      loadedAssetIdRef.current = null
      restoredKeyRef.current = null
      setWorkspace(restored)
      if (navigator.storage?.persist) void navigator.storage.persist()
      setNotice({ tone: 'success', text: `学习包导入完成：${Object.keys(restored.exams).length} 份试卷、${imported.audio.size} 个音频。` })
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '学习包导入失败。' })
    } finally {
      setPackageState({ busy: false, progress: 0, message: '' })
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
      if (event.code === 'Space') {
        event.preventDefault()
        void engine.togglePlayback()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        engine.seek(engine.currentTime - 2)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        engine.seek(engine.currentTime + 2)
      } else if (event.key.toLowerCase() === 'a') {
        engine.setLoopPoint('a')
      } else if (event.key.toLowerCase() === 'b') {
        engine.setLoopPoint('b')
      } else if (event.key.toLowerCase() === 'l') {
        if (engine.loop.enabled) engine.cancelLoop()
        else void engine.resumeConfiguredLoop()
      } else if (event.key === '[') {
        playRelativeSegment(-1)
      } else if (event.key === ']') {
        playRelativeSegment(1)
      } else if (event.key.toLowerCase() === 'm') {
        toggleTranscript()
      } else if (event.key === 'Escape') {
        engine.cancelLoop()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [engine, playRelativeSegment, toggleTranscript])

  const structureProps = {
    exam: activeExam,
    sections,
    passages: workspace.passages,
    questions: workspace.questions,
    segments: workspace.segments,
    activePassageId: workspace.activePassageId,
    currentTime: engine.currentTime,
    onSelectPassage: selectPassage,
    onRenameExam: renameExam,
    onRenameSection: renameSection,
    onRenamePassage: renamePassage,
    onQuestionPrompt: updateQuestionPrompt,
    onAddSection: addSection,
    onAddPassage: addPassage,
    onAddQuestion: addQuestion,
    onToggleQuestionSegment: toggleQuestionSegment,
    onSectionBoundary: updateSectionBoundary,
    onPassageBoundary: updatePassageBoundary,
    onSplitPassage: splitPassageAtPlayhead,
    onMergePassage: mergePassage,
    onMoveQuestion: moveQuestion,
    onConfirmEntity: confirmEntity,
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">聴</div>
          <div>
            <strong>JLPT Listening Studio</strong>
            <span>N1 精听工作台 · 本地优先</span>
          </div>
        </div>
        <AudioImport onImport={handleImport} busy={importing} storage={storage} />
        <div className="header-actions">
          <span className={`save-indicator ${saveState}`}>
            <i />{saveState === 'saved' ? '已保存' : saveState === 'saving' ? '保存中' : saveState === 'loading' ? '读取中' : '保存失败'}
          </span>
          <button
            className="theme-button"
            onClick={() => setWorkspace((previous) => ({
              ...previous,
              preferences: { ...previous.preferences, theme: previous.preferences.theme === 'light' ? 'dark' : 'light' },
            }))}
            aria-label="切换深浅主题"
          >
            {workspace.preferences.theme === 'light' ? '深色' : '浅色'}
          </button>
        </div>
      </header>

      {notice && (
        <div className={`notice ${notice.tone}`} role="status">
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="关闭提示">×</button>
        </div>
      )}

      <div className="workspace-grid">
        <aside className="desktop-sidebar"><StructureTree {...structureProps} /></aside>
        <main className="main-content">
          <details className="mobile-nav">
            <summary>
              <span><small>{activeSection?.title}</small>{activePassage?.title}</span>
              <span>试卷导航</span>
            </summary>
            <StructureTree {...structureProps} />
          </details>

          <section className="material-heading">
            <div>
              <span className="breadcrumb">{activeSection?.title} / {activePassage?.title}</span>
              <h1>{activePassage?.title}</h1>
              <p>
                {activeAsset
                  ? `${activeAsset.name} · ${formatTime(activeAsset.duration)} · ${activeAsset.storageMode === 'indexeddb' ? '已保存在本机' : '仅本次会话'}`
                  : '为当前材料导入音频，或先编辑句子与题目结构。'}
              </p>
              {activePassage?.audioAssetId && !activeExam.audioAssetId && (
                <button className="promote-audio" onClick={useActiveAudioForExam}>将当前音频用于整份试卷</button>
              )}
            </div>
            <div className="recognition-badge">
              <span>V2 转录状态</span>
              <strong>{activePassage?.recognitionStatus === 'unrecognized' ? '未识别' : activePassage?.recognitionStatus}</strong>
            </div>
          </section>

          {activeAsset?.availability === 'missing' && (
            <div className="missing-audio" role="alert">
              <strong>音频文件不可用</strong>
              <span>{activeAsset.lastError ?? '请重新导入原文件，句子与试卷结构不会丢失。'}</span>
            </div>
          )}

          {activeAsset && hasStarterSegments && (
            <div className="demo-data-banner">
              <div>
                <strong>当前两句是界面演示数据，不是音频转录结果</strong>
                <span>V1 导入音频不会自动断句。清除演示数据后，移动时间轴并连续点击“当前起点 3 秒”即可建立真实区间；每次创建后播放头会自动前进 3 秒。</span>
              </div>
              <button onClick={clearStarterSegments}>清除模拟句子</button>
            </div>
          )}

          <AiTranscriptionPanel
            asset={activeAsset}
            backendUrl={workspace.preferences.aiBackendUrl}
            modelSize={workspace.preferences.aiModelSize}
            onSettings={updateAiSettings}
            onResult={handleAiResult}
          />

          <StudyPackagePanel
            busy={packageState.busy}
            progress={packageState.progress}
            message={packageState.message}
            onExport={exportPackage}
            onImport={importPackage}
          />

          <SegmentEditor
            segments={segments}
            currentTime={engine.currentTime}
            duration={engine.duration}
            transcriptVisible={progress.transcriptVisible}
            activeSegmentId={activeSegment?.id}
            onToggleTranscript={toggleTranscript}
            onCreate={createSegment}
            onUpdate={updateSegment}
            onDelete={deleteSegment}
            onMerge={handleMerge}
            onSplit={handleSplit}
            onPlay={playSegment}
          />

          <div className="shortcut-note">
            快捷键：空格 播放/暂停 · A/B 设置区间 · L 循环 · ←/→ 跳 2 秒 · [/] 上/下一句 · M 隐藏原文 · Esc 取消循环
          </div>

          <PlayerControls
            fileName={engine.fileName}
            duration={engine.duration}
            currentTime={engine.currentTime}
            ready={engine.ready}
            playing={engine.playing}
            waiting={engine.isLoopWaiting}
            error={engine.error}
            rate={engine.playbackRate}
            loop={engine.loop}
            completedCycles={engine.completedCycles}
            onToggle={() => void engine.togglePlayback()}
            onPlayAll={() => void engine.playAll()}
            onSeek={(time) => engine.seek(time)}
            onSkip={(delta) => engine.seek(engine.currentTime + delta)}
            onPrevious={() => playRelativeSegment(-1)}
            onNext={() => playRelativeSegment(1)}
            onSetPoint={engine.setLoopPoint}
            onStartLoop={() => void engine.resumeConfiguredLoop()}
            onCancelLoop={engine.cancelLoop}
            onRate={setRate}
            onLoopCount={setLoopCount}
            onPauseMs={setPauseMs}
          />
        </main>
      </div>
    </div>
  )
}
