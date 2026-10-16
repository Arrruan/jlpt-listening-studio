import { useRef } from 'react'

interface StudyPackagePanelProps {
  busy: boolean
  progress: number
  message: string
  onExport: () => Promise<void>
  onImport: (file: File) => Promise<void>
}

export function StudyPackagePanel({ busy, progress, message, onExport, onImport }: StudyPackagePanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <section className="study-package-panel">
      <div>
        <span className="eyebrow">跨设备学习包</span>
        <strong>ZIP 包含音频、试卷结构、转录和练习进度</strong>
        <small>手机浏览器导入后完全离线使用，不需要 Python。</small>
      </div>
      <div className="package-actions">
        <button onClick={() => void onExport()} disabled={busy}>导出 ZIP</button>
        <button className="primary" onClick={() => inputRef.current?.click()} disabled={busy}>导入 ZIP</button>
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void onImport(file)
            event.target.value = ''
          }}
        />
      </div>
      {busy && (
        <div className="package-progress">
          <div><i style={{ width: `${Math.max(2, progress * 100)}%` }} /></div>
          <span>{message}</span>
        </div>
      )}
    </section>
  )
}
