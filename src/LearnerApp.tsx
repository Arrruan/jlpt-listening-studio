import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAudioEngine } from './audio/useAudioEngine'
import { StudyPlayer } from './components/StudyPlayer'
import {
  answerQuestion,
  clearExamAnswers,
  enterIntensive,
  installExamPackage,
  leaveIntensive,
  openExam,
  orderedExamQuestions,
  revealAnswer,
  selectQuestion,
} from './domain/learnerFlow'
import { createDemoAudioBlob, createInitialLibrary, DEMO_AUDIO_ID } from './library/demoData'
import type {
  LibraryExam,
  LibraryQuestion,
  LibraryState,
  QuestionFilter,
} from './library/types'
import {
  describeStorage,
  isQuotaError,
  loadAudioBlob,
  loadLibraryState,
  saveAudioBlob,
  saveAudioBlobs,
  saveLibraryState,
} from './persistence/database'
import { readExamPackage } from './persistence/examPackage'
import { migrateLibraryState } from './persistence/libraryMigrations'
import { discoverLocalPackages, downloadLocalPackage, isLocalPackageCurrent } from './persistence/localLibrary'
import type { LocalPreparedPackage } from './persistence/localLibrary'
import type { LoopCount } from './types'
import { formatBytes, formatTime } from './utils/format'

type Notice = { tone: 'success' | 'warning' | 'error'; text: string }

const choiceModeLabel: Record<LibraryQuestion['choicePresentation'], string> = {
  number_only: '仅选项编号',
  audio: '选项由音频播报',
  text: '文字选项',
  image: '图示选项',
  mixed: '混合选项',
}

const sortedSections = (state: LibraryState, exam?: LibraryExam) =>
  (exam?.sectionIds ?? [])
    .map((id) => state.sections[id])
    .filter(Boolean)
    .sort((left, right) => left.order - right.order)

interface QuestionNavigationProps {
  state: LibraryState
  exam: LibraryExam
  activeQuestionId?: string
  filter: QuestionFilter
  onFilter: (filter: QuestionFilter) => void
  onSelect: (id: string) => void
}

function QuestionNavigation(props: QuestionNavigationProps) {
  const answers = props.state.learning[props.exam.id]?.answers ?? {}
  const matches = (questionId: string) => {
    const answered = Boolean(answers[questionId]?.selectedChoiceId)
    return props.filter === 'all' || (props.filter === 'answered' ? answered : !answered)
  }
  return (
    <nav className="question-navigation" aria-label="大题和题号导航">
      <div className="nav-heading">
        <span>练习导航</span>
        <small>{Object.values(answers).filter((item) => item.selectedChoiceId).length} / {orderedExamQuestions(props.state, props.exam.id).length} 已作答</small>
      </div>
      <div className="question-filters" aria-label="作答状态筛选">
        {(['all', 'unanswered', 'answered'] as const).map((filter) => (
          <button className={props.filter === filter ? 'active' : ''} onClick={() => props.onFilter(filter)} key={filter}>
            {{ all: '全部', unanswered: '未答', answered: '已答' }[filter]}
          </button>
        ))}
      </div>
      <div className="section-nav-list">
        {sortedSections(props.state, props.exam).map((section) => {
          const questions = section.questionIds.map((id) => props.state.questions[id]).filter(Boolean).filter((item) => matches(item.id))
          return (
            <section className="nav-section" key={section.id}>
              <h2>{section.title}</h2>
              {questions.length ? (
                <div className="question-number-grid">
                  {questions.map((item) => {
                    const answered = Boolean(answers[item.id]?.selectedChoiceId)
                    return (
                      <button
                        className={`${props.activeQuestionId === item.id ? 'active' : ''} ${answered ? 'answered' : ''}`}
                        aria-current={props.activeQuestionId === item.id ? 'page' : undefined}
                        onClick={() => props.onSelect(item.id)}
                        key={item.id}
                      >
                        {item.number}<span className="sr-only">{answered ? '，已作答' : '，未作答'}</span>
                      </button>
                    )
                  })}
                </div>
              ) : <p className="filter-empty">此筛选下没有题目</p>}
            </section>
          )
        })}
      </div>
    </nav>
  )
}

export default function LearnerApp() {
  const [library, setLibrary] = useState<LibraryState>(createInitialLibrary)
  const [hydrated, setHydrated] = useState(false)
  const [saveState, setSaveState] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [packageProgress, setPackageProgress] = useState({ busy: false, message: '', value: 0 })
  const [storage, setStorage] = useState<{ usage: number; quota: number }>()
  const [localPackages, setLocalPackages] = useState<LocalPreparedPackage[]>([])
  const [localSyncState, setLocalSyncState] = useState<'checking' | 'connected' | 'offline'>('checking')
  const engine = useAudioEngine()
  const packageInputRef = useRef<HTMLInputElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const loadedAssetIdRef = useRef<string | null>(null)
  const pendingInitialPositionRef = useRef<number | null>(null)
  const libraryRef = useRef(library)
  const installingLocalRef = useRef(new Set<string>())

  const screen = library.navigation.screen
  const exam = library.navigation.examId ? library.exams[library.navigation.examId] : undefined
  const question = library.navigation.questionId ? library.questions[library.navigation.questionId] : undefined
  const section = question ? library.sections[question.sectionId] : undefined
  const passage = question ? library.passages[question.passageId] : undefined
  const asset = passage ? library.audioAssets[passage.audioAssetId] : undefined
  const segments = useMemo(() => passage
    ? passage.segmentIds.map((id) => library.segments[id]).filter(Boolean).sort((left, right) => left.order - right.order)
    : [], [library.segments, passage])
  const examQuestions = useMemo(() => exam ? orderedExamQuestions(library, exam.id) : [], [exam, library])
  const questionIndex = question ? examQuestions.findIndex((item) => item.id === question.id) : -1
  const activeSegment = segments.find((item) => engine.currentTime >= item.start && engine.currentTime < item.end)
  const activeAudioAssetId = screen !== 'home' ? asset?.id : undefined
  const answer = exam && question ? library.learning[exam.id]?.answers[question.id] : undefined

  useEffect(() => {
    libraryRef.current = library
  }, [library])

  useEffect(() => {
    let cancelled = false
    const hydrate = async () => {
      try {
        const raw = await loadLibraryState()
        let state = migrateLibraryState(raw)
        let demoBlob = await loadAudioBlob(DEMO_AUDIO_ID)
        if (!demoBlob) {
          demoBlob = createDemoAudioBlob()
          await saveAudioBlob(DEMO_AUDIO_ID, demoBlob)
        }
        state = {
          ...state,
          audioAssets: {
            ...state.audioAssets,
            [DEMO_AUDIO_ID]: { ...state.audioAssets[DEMO_AUDIO_ID], size: demoBlob.size, availability: 'available', lastError: undefined },
          },
        }
        if (!cancelled) {
          setLibrary(state)
          setSaveState('saved')
        }
        if (navigator.storage?.persist) void navigator.storage.persist()
      } catch (error) {
        if (!cancelled) {
          setSaveState('error')
          setNotice({ tone: 'error', text: `无法读取本地题库：${error instanceof Error ? error.message : '未知错误'}` })
        }
      } finally {
        if (!cancelled) setHydrated(true)
      }
      try {
        const estimate = await describeStorage()
        if (!cancelled) setStorage(estimate)
      } catch {
        // Storage estimates are optional.
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
        await saveLibraryState(library)
        setSaveState('saved')
      } catch (error) {
        setSaveState('error')
        setNotice({ tone: 'error', text: `本地保存失败：${error instanceof Error ? error.message : '浏览器存储不可用'}` })
      }
    }, 350)
    return () => window.clearTimeout(timer)
  }, [hydrated, library])

  useEffect(() => {
    if (!hydrated) return
    let cancelled = false
    const sync = async () => {
      try {
        const resources = await discoverLocalPackages()
        if (cancelled) return
        setLocalPackages(resources)
        setLocalSyncState('connected')
        for (const resource of resources) {
          if (resource.status !== 'ready' || installingLocalRef.current.has(resource.id)) continue
          const installed = libraryRef.current.exams[resource.examId]
          if (isLocalPackageCurrent(resource, installed)) {
            const needsRepair = installed.audioAssetIds.some((assetId) => libraryRef.current.audioAssets[assetId]?.availability === 'missing')
            if (!needsRepair) continue
          }
          installingLocalRef.current.add(resource.id)
          try {
            const imported = await downloadLocalPackage(resource)
            await saveAudioBlobs(imported.audio)
            if (cancelled) return
            setLibrary((previous) => {
              const next = installExamPackage(previous, imported.payload)
              libraryRef.current = next
              void saveLibraryState(next)
              return next
            })
            if (navigator.storage?.persist) void navigator.storage.persist()
            setNotice({ tone: 'success', text: `已从 Listen 自动安装“${resource.examTitle}”，音频和逐句文本已保存到浏览器。` })
          } catch (error) {
            if (!cancelled) setNotice({ tone: 'error', text: `Listen 自动安装失败：${error instanceof Error ? error.message : '未知错误'}` })
          } finally {
            installingLocalRef.current.delete(resource.id)
          }
        }
      } catch {
        if (!cancelled) setLocalSyncState('offline')
      }
    }
    void sync()
    const timer = window.setInterval(() => void sync(), 10_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [hydrated])

  useEffect(() => {
    document.documentElement.dataset.theme = library.preferences.theme
  }, [library.preferences.theme])

  const activateAudio = useCallback((assetId: string, blob: Blob, name: string, initialPosition: number) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = URL.createObjectURL(blob)
    loadedAssetIdRef.current = assetId
    pendingInitialPositionRef.current = initialPosition
    engine.loadSource(objectUrlRef.current, name)
  }, [engine.loadSource])

  useEffect(() => {
    if (!hydrated) return
    if (!activeAudioAssetId || !asset || !passage) {
      engine.pause()
      return
    }
    if (loadedAssetIdRef.current === activeAudioAssetId) return
    const support = document.createElement('audio').canPlayType(asset.mimeType)
    if (!support && asset.mimeType) {
      engine.clearSource()
      loadedAssetIdRef.current = activeAudioAssetId
      setNotice({ tone: 'error', text: `当前浏览器不支持 ${asset.mimeType}，请改用兼容的 MP3、M4A 或 MP4 音频包。` })
      return
    }
    let cancelled = false
    const restore = async () => {
      try {
        const blob = await loadAudioBlob(activeAudioAssetId)
        if (cancelled) return
        if (!blob) {
          engine.clearSource()
          loadedAssetIdRef.current = activeAudioAssetId
          setLibrary((previous) => ({
            ...previous,
            audioAssets: { ...previous.audioAssets, [activeAudioAssetId]: { ...previous.audioAssets[activeAudioAssetId], availability: 'missing', lastError: 'IndexedDB 中没有音频文件。' } },
          }))
          setNotice({ tone: 'error', text: `找不到“${asset.name}”的本地音频，请重新安装该题库包。` })
          return
        }
        activateAudio(activeAudioAssetId, blob, asset.name, passage.start)
      } catch (error) {
        if (!cancelled) setNotice({ tone: 'error', text: `读取本机音频失败：${error instanceof Error ? error.message : '未知错误'}` })
      }
    }
    void restore()
    return () => { cancelled = true }
  }, [activeAudioAssetId, activateAudio, asset, engine.clearSource, engine.pause, hydrated, passage])

  useEffect(() => {
    if (!engine.ready || pendingInitialPositionRef.current === null) return
    engine.seek(pendingInitialPositionRef.current, false)
    pendingInitialPositionRef.current = null
  }, [engine.ready, engine.seek])

  useEffect(() => {
    engine.setPlaybackRate(library.preferences.playbackRate)
  }, [engine.setPlaybackRate, library.preferences.playbackRate])

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [])

  const updateFilter = (filter: QuestionFilter) => setLibrary((previous) => ({
    ...previous,
    navigation: { ...previous.navigation, questionFilter: filter },
  }))

  const handleOpenExam = (examId: string) => {
    try {
      const next = openExam(library, examId)
      engine.pause()
      engine.cancelLoop()
      setLibrary(next)
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '无法打开这套试卷。' })
    }
  }

  const handleSelectQuestion = useCallback((questionId: string) => {
    const currentScreen = library.navigation.screen
    const previousPassageId = library.navigation.questionId ? library.questions[library.navigation.questionId]?.passageId : undefined
    const nextPassageId = library.questions[questionId]?.passageId
    if (previousPassageId !== nextPassageId) {
      engine.pause()
      engine.cancelLoop()
    }
    setLibrary((previous) => {
      const result = selectQuestion(previous, questionId).state
      return currentScreen === 'intensive'
        ? { ...result, navigation: { ...result.navigation, screen: 'intensive', intensiveReturnQuestionId: questionId } }
        : result
    })
  }, [engine.cancelLoop, engine.pause, library.navigation.questionId, library.navigation.screen, library.questions])

  const goHome = () => {
    engine.pause()
    engine.cancelLoop()
    setLibrary((previous) => ({ ...previous, navigation: { ...previous.navigation, screen: 'home' } }))
  }

  const setTheme = () => setLibrary((previous) => ({
    ...previous,
    preferences: { ...previous.preferences, theme: previous.preferences.theme === 'light' ? 'dark' : 'light' },
  }))

  const handlePackage = async (file?: File) => {
    if (!file) return
    setPackageProgress({ busy: true, value: 0, message: '准备安装…' })
    try {
      const imported = await readExamPackage(file, (value, message) => setPackageProgress({ busy: true, value, message }))
      await saveAudioBlobs(imported.audio)
      if (navigator.storage?.persist) void navigator.storage.persist()
      const installed = installExamPackage(library, imported.payload)
      await saveLibraryState(installed)
      setLibrary(installed)
      setNotice({ tone: 'success', text: `已安装题库“${imported.payload.exam.title}”，下次打开无需重新导入。` })
      setStorage(await describeStorage())
    } catch (error) {
      setNotice({
        tone: 'error',
        text: isQuotaError(error)
          ? '浏览器存储空间不足，题库未安装。请清理站点数据或设备空间后重试。'
          : `题库安装失败：${error instanceof Error ? error.message : '未知错误'}`,
      })
    } finally {
      setPackageProgress({ busy: false, value: 0, message: '' })
      if (packageInputRef.current) packageInputRef.current.value = ''
    }
  }

  const playRange = useCallback((start: number, end: number, count: LoopCount, startAt?: number) => {
    pendingInitialPositionRef.current = null
    void engine.startLoop({ a: start, b: end, startAt, count, pauseMs: library.preferences.loopPauseMs })
  }, [engine.startLoop, library.preferences.loopPauseMs])

  const playPassageFromStart = useCallback(() => {
    if (!passage) return
    void engine.startLoop({ a: passage.start, b: passage.end, count: 1, pauseMs: 0 })
  }, [engine.startLoop, passage])

  const togglePlayback = useCallback(() => {
    if (!passage) return
    if (engine.playing || engine.isLoopWaiting) {
      engine.pause()
      return
    }
    if (engine.loop.enabled && engine.loop.a !== null && engine.loop.b !== null) {
      void engine.togglePlayback()
      return
    }
    const startAt = engine.currentTime >= passage.start && engine.currentTime < passage.end ? engine.currentTime : passage.start
    void engine.startLoop({ a: passage.start, b: passage.end, startAt, count: 1, pauseMs: 0 })
  }, [engine, passage])

  const seekWithinPassage = useCallback((time: number) => {
    if (!passage) return
    const nextTime = Math.max(passage.start, Math.min(passage.end - 0.01, time))
    const resume = engine.playing
    engine.seek(nextTime)
    if (resume) void engine.startLoop({ a: passage.start, b: passage.end, startAt: nextTime, count: 1, pauseMs: 0 })
  }, [engine, passage])

  const playSegment = useCallback((segmentId: string) => {
    const segment = library.segments[segmentId]
    if (!segment) return
    const count = library.preferences.loopMode ? library.preferences.defaultLoopCount : 1
    playRange(segment.start, segment.end, count)
  }, [library.preferences.defaultLoopCount, library.preferences.loopMode, library.segments, playRange])

  const playRelativeSegment = useCallback((direction: -1 | 1) => {
    if (!segments.length) return
    const activeIndex = activeSegment ? segments.findIndex((item) => item.id === activeSegment.id) : -1
    const fallback = direction === 1
      ? segments.findIndex((item) => item.start > engine.currentTime)
      : segments.map((item) => item.end <= engine.currentTime).lastIndexOf(true)
    const index = activeIndex >= 0 ? activeIndex + direction : fallback
    const target = segments[Math.max(0, Math.min(segments.length - 1, index < 0 ? 0 : index))]
    if (target) playSegment(target.id)
  }, [activeSegment, engine.currentTime, playSegment, segments])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, select, textarea, button')) return
      if (event.code === 'Space') {
        event.preventDefault()
        togglePlayback()
      } else if (event.key === 'ArrowLeft') seekWithinPassage(engine.currentTime - 2)
      else if (event.key === 'ArrowRight') seekWithinPassage(engine.currentTime + 2)
      else if (screen === 'intensive' && event.key === '[') playRelativeSegment(-1)
      else if (screen === 'intensive' && event.key === ']') playRelativeSegment(1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [engine.currentTime, playRelativeSegment, screen, seekWithinPassage, togglePlayback])

  const player = passage && asset ? (
    <StudyPlayer
      title={passage.title}
      fileName={asset.name}
      start={passage.start}
      end={passage.end}
      currentTime={engine.currentTime}
      ready={engine.ready && asset.availability === 'available'}
      playing={engine.playing}
      waiting={engine.isLoopWaiting}
      error={engine.error ?? (asset.availability === 'missing' ? asset.lastError ?? '本机音频缺失，请重新安装题库包。' : null)}
      rate={library.preferences.playbackRate}
      loopActive={engine.loop.enabled}
      completedCycles={engine.completedCycles}
      loopCount={library.preferences.defaultLoopCount}
      activeLoopCount={engine.loop.count}
      intensive={screen === 'intensive'}
      onToggle={togglePlayback}
      onReplay={playPassageFromStart}
      onSeek={seekWithinPassage}
      onSkip={(seconds) => seekWithinPassage(engine.currentTime + seconds)}
      onPrevious={segments.length ? () => playRelativeSegment(-1) : undefined}
      onNext={segments.length ? () => playRelativeSegment(1) : undefined}
      onRate={(rate) => setLibrary((previous) => ({
        ...previous,
        preferences: { ...previous.preferences, playbackRate: rate as LibraryState['preferences']['playbackRate'] },
      }))}
      onLoopCount={(count) => setLibrary((previous) => ({
        ...previous,
        preferences: { ...previous.preferences, defaultLoopCount: count },
      }))}
    />
  ) : null

  const readyLocalCount = localPackages.filter((item) => item.status === 'ready').length
  const processingLocal = localPackages.find((item) => item.status === 'processing')
  const queuedLocalCount = localPackages.filter((item) => item.status === 'queued').length
  const failedLocalCount = localPackages.filter((item) => item.status === 'failed').length

  if (!hydrated) {
    return <main className="loading-screen"><div className="brand-symbol">聴</div><strong>正在读取本地题库…</strong></main>
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" onClick={goHome} aria-label="返回试卷库">
          <span className="brand-symbol">聴</span>
          <span><strong>JLPT Listening Studio</strong><small>N1 自由练习与逐句精听</small></span>
        </button>
        <div className="header-actions">
          <span className={`save-state ${saveState}`}>{saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '已保存到本机' : saveState === 'error' ? '保存失败' : '载入中'}</span>
          {screen !== 'home' && <button onClick={goHome}>试卷库</button>}
          <button onClick={setTheme}>{library.preferences.theme === 'light' ? '深色' : '浅色'}主题</button>
        </div>
      </header>

      {notice && <div className={`notice ${notice.tone}`} role="status"><span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="关闭提示">×</button></div>}

      {screen === 'home' && (
        <main className="library-page">
          <section className="library-hero">
            <div>
              <span className="kicker">本机试卷库</span>
              <h1>选择一套试卷，马上开始练习</h1>
              <p>按题自由播放、选择答案；需要时进入逐句精听。题库与作答记录仅保存在当前浏览器。</p>
            </div>
            <div className="install-card">
              <div className={`local-sync-status ${localSyncState}`}>
                <span>{localSyncState === 'connected' ? '●' : localSyncState === 'checking' ? '◌' : '○'}</span>
                <div>
                  <strong>{localSyncState === 'connected' ? 'Listen 自动同步已连接' : localSyncState === 'checking' ? '正在检查 Listen 资源' : '本机资源服务未启动'}</strong>
                  <small>{localSyncState === 'connected'
                    ? processingLocal
                      ? `已完成 ${readyLocalCount} / ${localPackages.length}；正在处理 ${processingLocal.position ?? readyLocalCount + 1} / ${processingLocal.total ?? localPackages.length}，另有 ${queuedLocalCount} 份等待。${failedLocalCount ? ` ${failedLocalCount} 份失败。` : ''}`
                      : `已完成 ${readyLocalCount} / ${localPackages.length} 份本机题库。${failedLocalCount ? ` ${failedLocalCount} 份处理失败。` : ''}`
                    : localSyncState === 'offline'
                      ? '运行 npm run dev 后会自动处理和安装；已安装试卷仍可离线使用。'
                      : '无需选择音频或手动运行 AI。'}</small>
                </div>
              </div>
              <input ref={packageInputRef} type="file" accept=".zip,application/zip" hidden onChange={(event) => void handlePackage(event.target.files?.[0])} />
              <button className="install-button" onClick={() => packageInputRef.current?.click()} disabled={packageProgress.busy}>
                {packageProgress.busy ? '正在安装…' : '手动安装其他 ZIP'}
              </button>
              {packageProgress.busy && <><progress value={packageProgress.value} max={1} /><small>{packageProgress.message}</small></>}
              <small>ZIP 内的音频会保存到 IndexedDB，不依赖临时文件地址。</small>
            </div>
          </section>

          <section className="exam-library" aria-labelledby="installed-heading">
            <div className="section-heading">
              <div><span className="kicker">Installed</span><h2 id="installed-heading">已安装试卷</h2></div>
              <span>{Object.keys(library.exams).length} 套</span>
            </div>
            <div className="exam-grid">
              {Object.values(library.exams)
                .sort((left, right) => (right.year ?? 0) - (left.year ?? 0) || (right.month ?? 0) - (left.month ?? 0))
                .map((item) => {
                  const questions = orderedExamQuestions(library, item.id)
                  const answers = library.learning[item.id]?.answers ?? {}
                  const answered = Object.values(answers).filter((entry) => entry.selectedChoiceId).length
                  return (
                    <article className="exam-card" key={item.id}>
                      <div className="exam-cover"><span>N1</span><strong>{item.year ?? 'DEMO'}</strong><small>{item.month ? `${item.month}月` : '演示数据'}</small></div>
                      <div className="exam-card-body">
                        <div className="exam-tags"><span>{item.source === 'demo' ? '演示数据 · 非真题' : item.reviewStatus === 'auto_draft' ? '自动识别 · 待校对' : '本机题库'}</span><span>{item.sectionIds.length} 个大题</span></div>
                        <h3>{item.title}</h3>
                        <p>{questions.length} 道题 · 已作答 {answered} 道</p>
                        <div className="completion-bar"><span style={{ width: `${questions.length ? answered / questions.length * 100 : 0}%` }} /></div>
                        <button className="primary" onClick={() => handleOpenExam(item.id)}>{answered ? '继续练习' : '打开试卷'}</button>
                      </div>
                    </article>
                  )
                })}
            </div>
          </section>

          <aside className="local-storage-note">
            <strong>本地与离线</strong>
            <p>PWA 页面缓存可离线打开，但题库音频受浏览器存储配额和系统清理策略影响。不要清除本站数据；重要题库包请另行保留。</p>
            {storage && <span>当前站点约使用 {formatBytes(storage.usage)} / 可用配额 {formatBytes(storage.quota)}</span>}
          </aside>
        </main>
      )}

      {screen !== 'home' && exam && question && section && passage && (
        <div className={`learning-layout ${screen === 'intensive' ? 'intensive-layout' : ''}`}>
          <aside className="desktop-question-nav">
            <QuestionNavigation state={library} exam={exam} activeQuestionId={question.id} filter={library.navigation.questionFilter} onFilter={updateFilter} onSelect={handleSelectQuestion} />
          </aside>
          <main className="learning-main">
            <details className="mobile-question-nav">
              <summary><span>{section.title}</span><strong>第 {question.number} 题</strong><span>展开导航</span></summary>
              <QuestionNavigation state={library} exam={exam} activeQuestionId={question.id} filter={library.navigation.questionFilter} onFilter={updateFilter} onSelect={handleSelectQuestion} />
            </details>

            {exam.source === 'demo' && <div className="demo-banner"><strong>演示数据</strong><span>提示音与文字只用于验证操作，不是 JLPT 真题、真题音频或转录。</span></div>}

            {screen === 'practice' ? (
              <>
                <section className="question-card">
                  <div className="breadcrumbs"><span>{exam.title}</span><span>›</span><span>{section.title}</span></div>
                  <div className="question-title-row">
                    <div><span className="question-label">QUESTION</span><h1>第 {question.number} 题</h1></div>
                    <div className="question-stepper">
                      <button disabled={questionIndex <= 0} onClick={() => handleSelectQuestion(examQuestions[questionIndex - 1].id)}>上一题</button>
                      <span>{questionIndex + 1} / {examQuestions.length}</span>
                      <button disabled={questionIndex < 0 || questionIndex >= examQuestions.length - 1} onClick={() => handleSelectQuestion(examQuestions[questionIndex + 1].id)}>下一题</button>
                    </div>
                  </div>
                  <div className="passage-summary">
                    <div><span>听力材料{passage.reviewStatus && passage.reviewStatus !== 'confirmed' ? ` · ${passage.reviewStatus === 'inferred' ? '推测边界' : '待确认'}` : ''}</span><strong>{passage.title}</strong></div>
                    <span>{formatTime(passage.end - passage.start)}</span>
                  </div>
                  <div className="prompt-block">
                    <span className="choice-mode">{choiceModeLabel[question.choicePresentation]}</span>
                    <p>{question.prompt || (question.choicePresentation === 'audio' ? '题干与选项由音频播报。' : '本题题库未录入文字题干。')}</p>
                  </div>

                  {question.choices?.length ? (
                    <div className={`choice-list mode-${question.choicePresentation}`} role="radiogroup" aria-label={`第 ${question.number} 题选项`}>
                      {question.choices.map((choice) => {
                        const selected = answer?.selectedChoiceId === choice.id
                        const revealed = Boolean(answer?.answerRevealedAt)
                        const correct = revealed && question.correctAnswer === choice.id
                        const incorrect = revealed && selected && question.correctAnswer !== choice.id
                        return (
                          <button
                            className={`choice ${selected ? 'selected' : ''} ${correct ? 'correct' : ''} ${incorrect ? 'incorrect' : ''}`}
                            role="radio"
                            aria-checked={selected}
                            onClick={() => setLibrary((previous) => answerQuestion(previous, exam.id, question.id, choice.id))}
                            key={choice.id}
                          >
                            <span className="choice-number">{choice.label}</span>
                            {choice.text && <span>{choice.text}</span>}
                            {choice.image && <img src={choice.image.src} alt={choice.image.alt} />}
                            {!choice.text && !choice.image && <span className="audio-choice-copy">{question.choicePresentation === 'audio' ? '内容由音频播报' : `选项 ${choice.label}`}</span>}
                          </button>
                        )
                      })}
                    </div>
                  ) : <div className="no-choice-note">本题没有录入可点击选项。仍可播放材料或进入精听。</div>}

                  <div className="answer-actions">
                    <span>{answer?.selectedChoiceId ? `已选择：${question.choices?.find((item) => item.id === answer.selectedChoiceId)?.label ?? answer.selectedChoiceId}` : '尚未作答'}</span>
                    {question.correctAnswer ? (
                      <button onClick={() => setLibrary((previous) => revealAnswer(previous, exam.id, question.id))}>查看已核实答案</button>
                    ) : <small>本题未收录已核实答案，因此不显示正确选项或评分。</small>}
                  </div>
                  {answer?.answerRevealedAt && question.correctAnswer && (
                    <div className="answer-reveal">
                      <strong>标准答案：{question.choices?.find((item) => item.id === question.correctAnswer)?.label ?? question.correctAnswer}</strong>
                      {question.explanation && <p>{question.explanation}</p>}
                    </div>
                  )}

                  <div className="practice-actions">
                    <button className="intensive-button" onClick={() => setLibrary((previous) => enterIntensive(previous))}>进入逐句精听</button>
                    <button className="danger-link" onClick={() => {
                      if (window.confirm(`清除“${exam.title}”的全部作答记录？题库与音频不会删除。`)) setLibrary((previous) => clearExamAnswers(previous, exam.id))
                    }}>清除本卷作答</button>
                  </div>
                </section>
                {player}
              </>
            ) : (
              <>
                <section className="intensive-card">
                  <div className="intensive-heading">
                    <button className="back-to-question" onClick={() => setLibrary((previous) => leaveIntensive(previous))}>← 返回第 {question.number} 题</button>
                    <div><span className="question-label">逐句精听</span><h1>{passage.title}</h1><p>{section.title} · 第 {question.number} 题使用此材料</p></div>
                  </div>
                  <div className="listening-toolbar">
                    <label className="switch-label">
                      <input type="checkbox" checked={library.preferences.transcriptVisible} onChange={() => setLibrary((previous) => ({ ...previous, preferences: { ...previous.preferences, transcriptVisible: !previous.preferences.transcriptVisible } }))} />
                      显示日语原文
                    </label>
                    <label className="switch-label">
                      <input type="checkbox" checked={library.preferences.loopMode} onChange={() => setLibrary((previous) => ({ ...previous, preferences: { ...previous.preferences, loopMode: !previous.preferences.loopMode } }))} />
                      点击句子时循环
                    </label>
                    <span>{segments.length} 句 · 时间戳相对于当前音频</span>
                  </div>
                  <div className={`sentence-list ${library.preferences.transcriptVisible ? '' : 'transcript-off'}`}>
                    {segments.map((segment, index) => (
                      <button className={`sentence-row ${activeSegment?.id === segment.id ? 'active' : ''}`} onClick={() => playSegment(segment.id)} key={segment.id}>
                        <span className="sentence-play">{activeSegment?.id === segment.id && engine.playing ? 'Ⅱ' : '▶'}</span>
                        <span className="sentence-index">{String(index + 1).padStart(2, '0')}</span>
                        <span className="sentence-content">
                          <span className="sentence-text">{library.preferences.transcriptVisible ? segment.text : '日语原文已隐藏'}</span>
                          <small>{formatTime(segment.start)} – {formatTime(segment.end)} · {formatTime(segment.end - segment.start)}</small>
                        </span>
                      </button>
                    ))}
                    {!segments.length && <div className="empty-sentences">这份题库尚未提供经过校对的逐句文本。</div>}
                  </div>
                </section>
                {player}
              </>
            )}
          </main>
        </div>
      )}
    </div>
  )
}
