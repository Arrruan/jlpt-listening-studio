import type { ChangeEvent } from 'react'
import type { AudioBindingScope } from '../types'
import { formatBytes } from '../utils/format'

interface AudioImportProps {
  onImport: (file: File, persist: boolean, scope: AudioBindingScope) => Promise<void>
  busy: boolean
  storage?: { usage: number; quota: number }
}

export function AudioImport({ onImport, busy, storage }: AudioImportProps) {
  const handleChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const persist = event.currentTarget.form?.elements.namedItem('persist-audio')
    const scopeValue = event.currentTarget.form
      ? new FormData(event.currentTarget.form).get('audio-scope')
      : 'exam'
    const scope: AudioBindingScope = scopeValue === 'passage' ? 'passage' : 'exam'
    await onImport(file, persist instanceof HTMLInputElement ? persist.checked : true, scope)
    event.target.value = ''
  }

  return (
    <form className="audio-import" onSubmit={(event) => event.preventDefault()}>
      <label className={`import-button ${busy ? 'disabled' : ''}`}>
        <span>{busy ? '正在保存…' : '导入本地音频'}</span>
        <input
          type="file"
          accept=".mp3,.m4a,.mp4,audio/mpeg,audio/mp4,video/mp4"
          onChange={handleChange}
          disabled={busy}
        />
      </label>
      <label className="persist-choice" title="勾选后将完整音频 Blob 写入 IndexedDB，刷新后仍可播放。">
        <input name="persist-audio" type="checkbox" defaultChecked />
        保存音频到本机
      </label>
      <label className="import-scope">
        用于
        <select name="audio-scope" defaultValue="exam" title="完整试卷音频应选择整份试卷；单独切分的音频可只用于当前材料。">
          <option value="exam">整份试卷</option>
          <option value="passage">当前材料</option>
        </select>
      </label>
      {storage && storage.quota > 0 && (
        <span className="storage-note">
          本站存储 {formatBytes(storage.usage)} / {formatBytes(storage.quota)}
        </span>
      )}
    </form>
  )
}
