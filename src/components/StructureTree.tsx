import type { Exam, Passage, Question, Section, Segment } from '../types'

interface StructureTreeProps {
  exam: Exam
  sections: Section[]
  passages: Record<string, Passage>
  questions: Record<string, Question>
  segments: Record<string, Segment>
  activePassageId: string
  currentTime: number
  onSelectPassage: (id: string) => void
  onRenameExam: (title: string) => void
  onRenameSection: (id: string, title: string) => void
  onRenamePassage: (id: string, title: string) => void
  onQuestionPrompt: (id: string, prompt: string) => void
  onAddSection: () => void
  onAddPassage: (sectionId: string) => void
  onAddQuestion: (passageId: string) => void
  onToggleQuestionSegment: (questionId: string, segmentId: string) => void
  onSectionBoundary: (id: string, field: 'startTime' | 'endTime', value: number) => void
  onPassageBoundary: (id: string, field: 'startTime' | 'endTime', value: number) => void
  onSplitPassage: (id: string) => void
  onMergePassage: (id: string) => void
  onMoveQuestion: (questionId: string, passageId: string) => void
  onConfirmEntity: (kind: 'section' | 'passage' | 'question', id: string) => void
}

export function StructureTree({
  exam,
  sections,
  passages,
  questions,
  segments,
  activePassageId,
  currentTime,
  ...actions
}: StructureTreeProps) {
  const statusLabel = (status?: string) => status === 'confirmed'
    ? '确认成功'
    : status === 'inferred'
      ? '推测关联'
      : status === 'unresolved'
        ? '无法判断'
        : '人工创建'
  const passageChoices = sections.flatMap((section) => section.passageIds.map((id) => passages[id]).filter(Boolean))
  return (
    <div className="structure-tree">
      <div className="tree-heading">
        <span className="eyebrow">试卷结构</span>
        <button className="icon-button" onClick={actions.onAddSection} title="新建大题">＋大题</button>
      </div>
      <input
        className="title-input exam-title-input"
        value={exam.title}
        aria-label="试卷标题"
        onChange={(event) => actions.onRenameExam(event.target.value)}
      />

      <div className="section-list">
        {sections.map((section) => (
          <details open key={section.id} className="section-node">
            <summary>
              <span>{String(section.order + 1).padStart(2, '0')}</span>
              <input
                className="title-input"
                aria-label="大题标题"
                value={section.title}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => actions.onRenameSection(section.id, event.target.value)}
              />
            </summary>
            <div className="boundary-editor section-boundary">
              <label>大题起点<input type="number" step="0.1" min="0" value={section.startTime ?? 0} onChange={(event) => actions.onSectionBoundary(section.id, 'startTime', Number(event.target.value))} /></label>
              <label>终点<input type="number" step="0.1" min="0" value={section.endTime ?? 0} onChange={(event) => actions.onSectionBoundary(section.id, 'endTime', Number(event.target.value))} /></label>
              <span className={`association ${section.associationStatus ?? 'manual'}`}>{statusLabel(section.associationStatus)}</span>
              {section.associationStatus && section.associationStatus !== 'confirmed' && <button onClick={() => actions.onConfirmEntity('section', section.id)}>确认</button>}
            </div>
            <div className="passage-list">
              {section.passageIds
                .map((id) => passages[id])
                .filter(Boolean)
                .sort((a, b) => a.order - b.order)
                .map((passage) => {
                  const passageSegments = passage.segmentIds.map((id) => segments[id]).filter(Boolean)
                  return (
                    <div className={`passage-node ${passage.id === activePassageId ? 'active' : ''}`} key={passage.id}>
                      <button className="passage-select" onClick={() => actions.onSelectPassage(passage.id)}>
                        <span className="material-dot" />
                        <span>{passage.title}</span>
                        <small>{passage.segmentIds.length} 句</small>
                      </button>
                      {passage.id === activePassageId && (
                        <div className="passage-editor">
                          <input
                            className="title-input"
                            aria-label="材料标题"
                            value={passage.title}
                            onChange={(event) => actions.onRenamePassage(passage.id, event.target.value)}
                          />
                          <div className="boundary-editor">
                            <label>材料起点<input type="number" step="0.1" min="0" value={passage.startTime ?? 0} onChange={(event) => actions.onPassageBoundary(passage.id, 'startTime', Number(event.target.value))} /></label>
                            <label>终点<input type="number" step="0.1" min="0" value={passage.endTime ?? 0} onChange={(event) => actions.onPassageBoundary(passage.id, 'endTime', Number(event.target.value))} /></label>
                          </div>
                          <div className="passage-review-row">
                            <span className={`association ${passage.associationStatus ?? 'manual'}`}>{statusLabel(passage.associationStatus)}</span>
                            {passage.associationStatus && passage.associationStatus !== 'confirmed' && <button onClick={() => actions.onConfirmEntity('passage', passage.id)}>确认关联</button>}
                            <button onClick={() => actions.onSplitPassage(passage.id)} title={`在当前 ${currentTime.toFixed(1)} 秒处拆分`}>按播放头拆分</button>
                            <button onClick={() => actions.onMergePassage(passage.id)}>与上一材料合并</button>
                          </div>
                          <div className="question-list">
                            {passage.questionIds.map((questionId) => questions[questionId]).filter(Boolean).map((question) => (
                              <details key={question.id} className="question-node">
                                <summary>{question.label} · {question.segmentIds.length} 个句子引用</summary>
                                <textarea
                                  aria-label={`${question.label} 题干`}
                                  value={question.prompt}
                                  onChange={(event) => actions.onQuestionPrompt(question.id, event.target.value)}
                                />
                                <label className="question-passage-select">
                                  关联材料
                                  <select value={question.passageId} onChange={(event) => actions.onMoveQuestion(question.id, event.target.value)}>
                                    {passageChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.title}</option>)}
                                  </select>
                                </label>
                                <div className="question-review">
                                  <span className={`association ${question.associationStatus ?? 'manual'}`}>{statusLabel(question.associationStatus)}</span>
                                  {question.associationStatus && question.associationStatus !== 'confirmed' && <button onClick={() => actions.onConfirmEntity('question', question.id)}>确认</button>}
                                </div>
                                {passageSegments.length > 0 && (
                                  <div className="segment-references">
                                    {passageSegments.map((segment, index) => (
                                      <label key={segment.id}>
                                        <input
                                          type="checkbox"
                                          checked={question.segmentIds.includes(segment.id)}
                                          onChange={() => actions.onToggleQuestionSegment(question.id, segment.id)}
                                        />
                                        句 {index + 1}
                                      </label>
                                    ))}
                                  </div>
                                )}
                              </details>
                            ))}
                          </div>
                          <button className="text-button" onClick={() => actions.onAddQuestion(passage.id)}>＋关联小题</button>
                        </div>
                      )}
                    </div>
                  )
                })}
              <button className="text-button add-passage" onClick={() => actions.onAddPassage(section.id)}>＋听力材料</button>
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}
