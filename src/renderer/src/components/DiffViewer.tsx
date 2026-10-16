import { Fragment, useState } from 'react'
import { GitDiffFile, GitDiffHunk, GitDiffLine } from '../../../shared/ipc'
import { nextCommentId, PendingComment, useDiffCommentsStore } from '../stores/diff-comments'

interface Selection {
  filePath: string
  hunkIndex: number
  start: number // line index within the hunk (inclusive)
  end: number
}

// Stable reference for the "no comments yet" case: returning a fresh `[]` from
// the store selector would make useSyncExternalStore see a new snapshot every
// render and loop forever ("getSnapshot should be cached").
const NO_COMMENTS: PendingComment[] = []

interface DiffViewerProps {
  tabId: string
  files: GitDiffFile[]
  onSend: (text: string) => void
  /** When set, each file header gets a button opening the file (repo-root-
      relative path) in the workspace's editor. */
  onOpenFile?: (path: string) => void
}

export function statusLetter(status: GitDiffFile['status']): string {
  return status === 'added' ? 'A' : status === 'deleted' ? 'D' : status === 'renamed' ? 'R' : 'M'
}

/**
 * Renders the working-tree diff. Clicking a line selects it (shift+click
 * extends the range within the same hunk); a comment box then lets the user
 * write a comment on the quoted lines. Comments accumulate as pending (like
 * a GitHub review) and a sticky submit bar sends them all to the tab's
 * Claude Code session at once.
 */
export function DiffViewer({ tabId, files, onSend, onOpenFile }: DiffViewerProps): React.JSX.Element {
  const [selection, setSelection] = useState<Selection | null>(null)
  const [comment, setComment] = useState('')
  const pending = useDiffCommentsStore((s) => s.byTab[tabId] ?? NO_COMMENTS)
  const addPending = useDiffCommentsStore((s) => s.add)
  const removePending = useDiffCommentsStore((s) => s.remove)
  const clearPending = useDiffCommentsStore((s) => s.clear)

  const handleLineClick = (
    filePath: string,
    hunkIndex: number,
    lineIndex: number,
    shiftKey: boolean
  ): void => {
    setSelection((prev) => {
      if (
        shiftKey &&
        prev &&
        prev.filePath === filePath &&
        prev.hunkIndex === hunkIndex
      ) {
        return {
          ...prev,
          start: Math.min(prev.start, lineIndex),
          end: Math.max(prev.end, lineIndex)
        }
      }
      if (prev && prev.filePath === filePath && prev.hunkIndex === hunkIndex && prev.start === lineIndex && prev.end === lineIndex) {
        return null // click on the sole selected line deselects
      }
      return { filePath, hunkIndex, start: lineIndex, end: lineIndex }
    })
  }

  const addComment = (file: GitDiffFile, hunk: GitDiffHunk): void => {
    if (!selection || !comment.trim()) return
    const lines = hunk.lines.slice(selection.start, selection.end + 1)
    const lineNumbers = lines
      .map((l) => l.newLine ?? l.oldLine)
      .filter((n): n is number => n !== null)
    const range =
      lineNumbers.length === 0
        ? ''
        : lineNumbers.length === 1 || lineNumbers[0] === lineNumbers[lineNumbers.length - 1]
          ? ` (${lineNumbers[0]}行目)`
          : ` (${lineNumbers[0]}〜${lineNumbers[lineNumbers.length - 1]}行目)`
    const quoted = lines.map((l) => `> ${prefixOf(l)}${l.text}`).join('\n')
    addPending(tabId, {
      id: nextCommentId(),
      filePath: file.path,
      hunkIndex: selection.hunkIndex,
      anchor: selection.end,
      header: `ファイル: ${file.path}${range}`,
      quoted,
      comment: comment.trim()
    })
    setSelection(null)
    setComment('')
  }

  const removeComment = (id: number): void => {
    removePending(tabId, id)
  }

  const submit = (): void => {
    if (pending.length === 0) return
    const sections = pending.map((p, i) =>
      [
        pending.length > 1 ? `【指摘 ${i + 1}】` : null,
        p.header,
        p.quoted,
        '',
        `コメント: ${p.comment}`
      ]
        .filter((l): l is string => l !== null)
        .join('\n')
    )
    onSend(['以下の diff についての指摘です:', '', sections.join('\n\n')].join('\n'))
    clearPending(tabId)
  }

  return (
    <div className="diff-viewer">
      {files.map((file) => (
        // data-diff-file lets the panel's file list scroll-jump here.
        <div key={file.path} className="diff-file" data-diff-file={file.path}>
          <div className="diff-file-header">
            <span className={`diff-status diff-status-${file.status}`}>
              {statusLetter(file.status)}
            </span>
            <span className="diff-file-path">
              {file.status === 'renamed' && file.oldPath ? `${file.oldPath} → ` : ''}
              {file.path}
            </span>
            {onOpenFile && file.status !== 'deleted' && (
              <button
                className="diff-file-open"
                onClick={() => onOpenFile(file.path)}
                title="このファイルを workspace のエディタで開く"
              >
                エディタで開く
              </button>
            )}
          </div>
          {file.hunks.map((hunk, hunkIndex) => {
            const selected =
              selection && selection.filePath === file.path && selection.hunkIndex === hunkIndex
                ? selection
                : null
            return (
              <div key={hunkIndex} className="diff-hunk">
                <div className="diff-hunk-header">{hunk.header}</div>
                {hunk.lines.map((line, lineIndex) => (
                  <Fragment key={lineIndex}>
                    <div
                      className={[
                        'diff-line',
                        `diff-line-${line.type}`,
                        selected && lineIndex >= selected.start && lineIndex <= selected.end
                          ? 'diff-line-selected'
                          : ''
                      ].join(' ')}
                      onClick={(e) => handleLineClick(file.path, hunkIndex, lineIndex, e.shiftKey)}
                    >
                      <span className="diff-line-num">{line.oldLine ?? ''}</span>
                      <span className="diff-line-num">{line.newLine ?? ''}</span>
                      <span className="diff-line-text">
                        {prefixOf(line)}
                        {line.text}
                      </span>
                    </div>
                    {/* GitHub-review style: pending comments and the comment
                        box sit right under the last selected line, not at the
                        end of the hunk. */}
                    {pending
                      .filter(
                        (p) =>
                          p.filePath === file.path &&
                          p.hunkIndex === hunkIndex &&
                          p.anchor === lineIndex
                      )
                      .map((p) => (
                        <div key={p.id} className="diff-pending-comment">
                          <span className="diff-pending-comment-text">{p.comment}</span>
                          <button
                            className="icon-button"
                            title="このコメントを削除"
                            onClick={() => removeComment(p.id)}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    {selected && lineIndex === selected.end && (
                      <div className="diff-comment-box">
                        <textarea
                          autoFocus
                          placeholder="このコードへのコメント… (追加して、下のバーからまとめて送信)"
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                        />
                        <div className="diff-comment-actions">
                          <button
                            onClick={() => {
                              setSelection(null)
                              setComment('')
                            }}
                          >
                            キャンセル
                          </button>
                          <button
                            className="primary"
                            disabled={!comment.trim()}
                            onClick={() => addComment(file, hunk)}
                          >
                            コメントを追加
                          </button>
                        </div>
                      </div>
                    )}
                  </Fragment>
                ))}
              </div>
            )
          })}
        </div>
      ))}
      {/* Sticky so the submit action stays reachable while scrolling a long
          diff. Comments whose hunk disappeared on a refresh are still listed
          here (their content is snapshotted), just no longer shown inline. */}
      {pending.length > 0 && (
        <div className="diff-submit-bar">
          <span className="diff-submit-count">{pending.length} 件のコメント</span>
          <button onClick={() => clearPending(tabId)}>全てクリア</button>
          <button className="primary" onClick={submit}>
            まとめて Claude に送る
          </button>
        </div>
      )}
    </div>
  )
}

function prefixOf(line: GitDiffLine): string {
  return line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '
}
