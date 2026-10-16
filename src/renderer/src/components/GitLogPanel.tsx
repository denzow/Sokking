import { useCallback, useEffect, useState } from 'react'
import { GitLogEntry } from '../../../shared/ipc'
import { Tab } from '../stores/tabs'

interface GitLogPanelProps {
  tab: Tab
}

export function GitLogPanel({ tab }: GitLogPanelProps): React.JSX.Element {
  const [isRepo, setIsRepo] = useState(false)
  const [log, setLog] = useState<GitLogEntry[]>([])
  const [confirmUndo, setConfirmUndo] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    if (!tab.cwd) return
    setLoading(true)
    setError('')
    try {
      const ov = await window.sokking.gitOverview(tab.cwd)
      setIsRepo(ov.isRepo)
      setLog(ov.isRepo ? await window.sokking.gitLog(tab.cwd) : [])
    } finally {
      setLoading(false)
    }
  }, [tab.cwd])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (op: () => Promise<{ ok: boolean; error?: string }>): Promise<void> => {
    const result = await op()
    // refresh() clears the error first, so set it afterwards to keep it visible.
    await refresh()
    if (!result.ok) setError(result.error ?? '操作に失敗しました')
  }

  const undoLastCommit = async (): Promise<void> => {
    setConfirmUndo(false)
    await run(() => window.sokking.gitUndoCommit(tab.cwd))
  }

  const revert = async (hash: string): Promise<void> => {
    await run(() => window.sokking.gitRevert(tab.cwd, hash))
  }

  return (
    <div className="git-panel">
      <div className="git-panel-header">
        <span className="git-panel-title">log</span>
        <span className="git-panel-cwd" title={tab.cwd}>
          {tab.cwd.replace(/^\/home\/[^/]+/, '~')}
        </span>
        <button className="icon-button" onClick={() => void refresh()} title="更新">
          ⟳
        </button>
      </div>

      {!isRepo ? (
        <div className="git-panel-empty">
          {loading ? '読み込み中…' : 'このディレクトリは Git リポジトリではありません'}
        </div>
      ) : (
        <>
          {error && <div className="git-error">{error}</div>}

          <div className="git-log-toolbar">
            {confirmUndo ? (
              <>
                <span className="git-log-confirm">最新のコミットを取り消しますか？</span>
                <button className="danger" onClick={() => void undoLastCommit()}>
                  取り消す
                </button>
                <button onClick={() => setConfirmUndo(false)}>やめる</button>
              </>
            ) : (
              <button
                disabled={log.length === 0}
                onClick={() => setConfirmUndo(true)}
                title="git reset --mixed HEAD~1（変更は作業ツリーに残ります）"
              >
                最新のコミットを取り消す
              </button>
            )}
          </div>
          <div className="git-log-area">
            {log.length === 0 ? (
              <div className="git-panel-empty">コミットがありません</div>
            ) : (
              <div className="git-log-list">
                {log.map((c) => (
                  <div key={c.hash} className={`git-log-item${c.isHead ? ' head' : ''}`}>
                    <div className="git-log-main">
                      <span className="git-log-hash">{c.shortHash}</span>
                      <span className="git-log-subject">{c.subject}</span>
                      {c.isHead && <span className="git-log-badge">HEAD</span>}
                    </div>
                    <div className="git-log-meta">
                      <span>{c.author}</span>
                      <span>{c.date.slice(0, 10)}</span>
                      <button
                        className="git-log-revert"
                        onClick={() => void revert(c.hash)}
                        title="このコミットを打ち消す新しいコミットを作成"
                      >
                        打ち消し
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
