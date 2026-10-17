import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { createDemoAudioBlob, createDemoPackagePayload } from '../library/demoData'
import { readExamPackage, validateExamPackage } from './examPackage'

const asFile = async (zip: JSZip) => {
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return new File([buffer], 'exam.zip', { type: 'application/zip' })
}

describe('标准化题库包', () => {
  it('验证稳定 ID、共享材料和相对于音频的时间戳', () => {
    const payload = validateExamPackage(createDemoPackagePayload())
    const shared = payload.passages.find((item) => item.id === 'demo-passage-shared')
    const related = payload.questions.filter((item) => item.passageId === shared?.id)

    expect(related.map((item) => item.number)).toEqual(['18', '19'])
    expect(payload.segments.filter((item) => item.passageId === shared?.id).every((item) => item.start >= shared!.start && item.end <= shared!.end)).toBe(true)
  })

  it('拒绝超出 Passage 边界的句子', () => {
    const payload = createDemoPackagePayload()
    payload.segments[0] = { ...payload.segments[0], end: 99 }
    expect(() => validateExamPackage(payload)).toThrow('时间边界超出材料')
  })

  it('从 ZIP 同时读取结构和可持久化音频 Blob', async () => {
    const payload = createDemoPackagePayload()
    const audio = createDemoAudioBlob()
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify({
      format: 'jlpt-listening-exam-package',
      version: 1,
      exportedAt: '2026-10-16T00:00:00Z',
      dataFile: 'exam.json',
      audioFiles: { 'demo-tone-audio': 'audio/demo-tone-audio.wav' },
    }))
    zip.file('exam.json', JSON.stringify(payload))
    zip.file('audio/demo-tone-audio.wav', audio, { compression: 'STORE' })

    const restored = await readExamPackage(await asFile(zip))

    expect(restored.payload.exam.schemaVersion).toBe(3)
    expect(restored.audio.get('demo-tone-audio')?.size).toBe(audio.size)
    expect(restored.audio.get('demo-tone-audio')?.type).toBe('audio/wav')
  })
})
