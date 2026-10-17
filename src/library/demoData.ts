import type { ExamPackagePayload, LibraryState } from './types'

export const DEMO_EXAM_ID = 'demo-n1-learning-flow'
export const DEMO_AUDIO_ID = 'demo-tone-audio'

const installedAt = '2026-01-01T00:00:00.000Z'

export const createDemoPackagePayload = (): ExamPackagePayload => ({
  schemaVersion: 3,
  exam: {
    id: DEMO_EXAM_ID,
    title: 'N1 学习流程演示（非真题）',
    level: 'N1',
    year: null,
    month: null,
    sectionIds: ['demo-section-1', 'demo-section-2'],
    audioAssetIds: [DEMO_AUDIO_ID],
    schemaVersion: 3,
    source: 'demo',
    installedAt,
  },
  sections: [
    {
      id: 'demo-section-1',
      examId: DEMO_EXAM_ID,
      title: '問題1・課題理解（演示）',
      type: 'task_comprehension',
      order: 0,
      passageIds: ['demo-passage-1'],
      questionIds: ['demo-question-1'],
    },
    {
      id: 'demo-section-2',
      examId: DEMO_EXAM_ID,
      title: '問題3・概要理解（演示）',
      type: 'overview_comprehension',
      order: 1,
      passageIds: ['demo-passage-shared'],
      questionIds: ['demo-question-18', 'demo-question-19'],
    },
  ],
  passages: [
    {
      id: 'demo-passage-1',
      sectionId: 'demo-section-1',
      title: '操作确认材料 A',
      audioAssetId: DEMO_AUDIO_ID,
      start: 1,
      end: 10,
      segmentIds: ['demo-segment-1', 'demo-segment-2', 'demo-segment-3'],
      order: 0,
    },
    {
      id: 'demo-passage-shared',
      sectionId: 'demo-section-2',
      title: '共用材料 B（第18～19题）',
      audioAssetId: DEMO_AUDIO_ID,
      start: 12,
      end: 32,
      segmentIds: ['demo-segment-4', 'demo-segment-5', 'demo-segment-6', 'demo-segment-7'],
      order: 0,
    },
  ],
  questions: [
    {
      id: 'demo-question-1',
      sectionId: 'demo-section-1',
      passageId: 'demo-passage-1',
      number: '1',
      order: 0,
      prompt: '这是界面操作演示题。请选择“进入精听”前想保留的答案。',
      choicePresentation: 'text',
      choices: [
        { id: 'demo-q1-a', label: '1', text: '先查看题目导航' },
        { id: 'demo-q1-b', label: '2', text: '先播放完整材料' },
        { id: 'demo-q1-c', label: '3', text: '先切换深色主题' },
        { id: 'demo-q1-d', label: '4', text: '先清除作答记录' },
      ],
      correctAnswer: 'demo-q1-b',
      explanation: '这是演示数据的核实答案，仅用于验证“查看答案”交互，不是真题答案。',
    },
    {
      id: 'demo-question-18',
      sectionId: 'demo-section-2',
      passageId: 'demo-passage-shared',
      number: '18',
      order: 0,
      choicePresentation: 'number_only',
      choices: [1, 2, 3, 4].map((number) => ({ id: `demo-q18-${number}`, label: String(number) })),
    },
    {
      id: 'demo-question-19',
      sectionId: 'demo-section-2',
      passageId: 'demo-passage-shared',
      number: '19',
      order: 1,
      prompt: '本题演示“选项由音频播报”的数据形态。',
      choicePresentation: 'audio',
      choices: [1, 2, 3, 4].map((number) => ({ id: `demo-q19-${number}`, label: String(number) })),
    },
  ],
  segments: [
    { id: 'demo-segment-1', passageId: 'demo-passage-1', start: 1, end: 4, text: 'これは操作確認用のデモです。', order: 0 },
    { id: 'demo-segment-2', passageId: 'demo-passage-1', start: 4, end: 7, text: '音声は日本語教材ではなく、再生確認用の提示音です。', order: 1 },
    { id: 'demo-segment-3', passageId: 'demo-passage-1', start: 7, end: 10, text: '正式な試験パッケージを追加して学習してください。', order: 2 },
    { id: 'demo-segment-4', passageId: 'demo-passage-shared', start: 12, end: 17, text: 'この素材は二つの質問で共有されています。', order: 0 },
    { id: 'demo-segment-5', passageId: 'demo-passage-shared', start: 17, end: 22, text: '質問を切り替えても、同じ音声を読み直しません。', order: 1 },
    { id: 'demo-segment-6', passageId: 'demo-passage-shared', start: 22, end: 27, text: '文を選ぶと、その区間だけ繰り返して聞けます。', order: 2 },
    { id: 'demo-segment-7', passageId: 'demo-passage-shared', start: 27, end: 32, text: 'これは実際の日本語能力試験の問題ではありません。', order: 3 },
  ],
  audioAssets: [
    {
      id: DEMO_AUDIO_ID,
      name: '操作确认提示音.wav',
      mimeType: 'audio/wav',
      size: 0,
      duration: 36,
      storageMode: 'indexeddb',
      availability: 'available',
    },
  ],
})

export const createInitialLibrary = (): LibraryState => {
  const demo = createDemoPackagePayload()
  return {
    schemaVersion: 3,
    exams: { [demo.exam.id]: demo.exam },
    sections: Object.fromEntries(demo.sections.map((item) => [item.id, item])),
    passages: Object.fromEntries(demo.passages.map((item) => [item.id, item])),
    questions: Object.fromEntries(demo.questions.map((item) => [item.id, item])),
    segments: Object.fromEntries(demo.segments.map((item) => [item.id, item])),
    audioAssets: Object.fromEntries(demo.audioAssets.map((item) => [item.id, item])),
    learning: {
      [demo.exam.id]: {
        examId: demo.exam.id,
        answers: {},
        activeQuestionId: demo.questions[0]?.id,
        updatedAt: installedAt,
      },
    },
    preferences: {
      theme: 'light',
      defaultLoopCount: 3,
      loopPauseMs: 300,
      transcriptVisible: true,
      loopMode: true,
      playbackRate: 1,
    },
    navigation: {
      screen: 'home',
      questionFilter: 'all',
    },
  }
}

/** A small local tone track gives the demo real HTMLAudioElement playback without shipping copyrighted audio. */
export const createDemoAudioBlob = (): Blob => {
  const sampleRate = 8_000
  const seconds = 36
  const sampleCount = sampleRate * seconds
  const bytesPerSample = 2
  const buffer = new ArrayBuffer(44 + sampleCount * bytesPerSample)
  const view = new DataView(buffer)
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
  }
  writeText(0, 'RIFF')
  view.setUint32(4, 36 + sampleCount * bytesPerSample, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, sampleCount * bytesPerSample, true)

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate
    const withinPulse = (time % 5) < 1.25
    const fade = Math.min(1, (time % 5) * 8, Math.max(0, (1.25 - (time % 5)) * 8))
    const sample = withinPulse ? Math.sin(2 * Math.PI * (330 + Math.floor(time / 5) * 25) * time) * 0.12 * fade : 0
    view.setInt16(44 + index * bytesPerSample, Math.round(sample * 32767), true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}
