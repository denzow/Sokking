import { useCallback, useEffect, useState } from 'react'
import { GitOverview } from '../../../shared/ipc'
import { Tab } from '../stores/tabs'

interface GitControlPanelProps {
  tab: Tab
}

type RemoteOp = 'fetch' | 'pull' | 'push'

const REMOTE_OPS: { op: RemoteOp; label: string; busyLabel: string; title: string }[] = [
  {
    op: 'fetch',
    label: 'Fetch',
    busyLabel: 'Fetch 中…',
    // git status never hits the network, so ↑↓ only move on an explicit fetch.
    title: 'リモートの状態を取得（↑↓ の件数を更新）'
  },
  { op: 'pull', label: 'Pull', busyLabel: 'Pull 中…', title: '上流ブランチを取り込む' },
  { op: 'push', label: 'Push', busyLabel: 'Push 中…', title: '現在のブランチを push' }
]

/** Branch switch/create, commit, and pull/push for the active tab's repository. */
export function GitControlPanel({ tab }: GitControlPanelProps): React.JSX.Element {
  const [overview, setOverview] = useState<GitOverview | null>(null)
  const [newBranch, setNewBranch] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Set while a remote operation is in flight — those can be slow.
  const [busy, setBusy] = useState<RemoteOp | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    if (!tab.cwd) return
    setLoading(true)
    setError('')
    try {
      setOverview(await window.sokking.gitOverview(tab.cwd))
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

  const checkout = async (branch: string): Promise<void> => {
    if (!branch || branch === overview?.currentBranch) return
    await run(() => window.sokking.gitCheckout(tab.cwd, branch))
  }

  const createBranch = async (): Promise<void> => {
    const name = newBranch.trim()
    if (!name) return
    await run(() => window.sokking.gitCreateBranch(tab.cwd, name))
    setNewBranch('')
  }

  const commit = async (): Promise<void> => {
    const message = commitMessage.trim()
    if (!message || !overview?.changedCount) return
    await run(() => window.sokking.gitCommit(tab.cwd, message))
    setCommitMessage('')
  }

  const remote = async (op: RemoteOp): Promise<void> => {
    const call = {
      fetch: window.sokking.gitFetch,
      pull: window.sokking.gitPull,
      push: window.sokking.gitPush
    }[op]
    setBusy(op)
    try {
      await run(() => call(tab.cwd))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="git-panel">
      <div className="git-panel-header">
        <span className="git-panel-title">git</span>
        <span className="git-panel-cwd" title={tab.cwd}>
          {tab.cwd.replace(/^\/home\/[^/]+/, '~')}
        </span>
        <button className="icon-button" onClick={() => void refresh()} title="更新">
          ⟳
        </button>
      </div>

      {!overview?.isRepo ? (
        <div className="git-panel-empty">
          {loading ? '読み込み中…' : 'このディレクトリは Git リポジトリではありません'}
        </div>
      ) : (
        <>
          {error && <div className="git-error">{error}</div>}

          <div className="git-branch-row">
            <label>ブランチ</label>
            <select value={overview.currentBranch} onChange={(e) => void checkout(e.target.value)}>
              {overview.branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div className="git-branch-row">
            <input
              placeholder="新しいブランチ名"
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createBranch()
              }}
            />
            <button onClick={() => void createBranch()}>作成</button>
          </div>

          <div className="git-commit-box">
            <textarea
              placeholder="コミットメッセージ"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
            />
            <div className="git-commit-actions">
              <span className="git-commit-hint">
                {overview.changedCount === 0
                  ? '変更はありません'
                  : `${overview.changedCount} ファイルを全てステージしてコミット`}
              </span>
              <button
                className="primary"
                disabled={!commitMessage.trim() || overview.changedCount === 0}
                onClick={() => void commit()}
              >
                コミット
              </button>
            </div>
          </div>

          <div className="git-remote-box">
            <div className="git-remote-status">
              {overview.tracking ? (
                <>
                  <span className="git-remote-upstream">{overview.tracking}</span>
                  <span className="git-remote-counts">
                    {overview.behind > 0 && <span title="未取得のコミット">↓{overview.behind}</span>}
                    {overview.ahead > 0 && <span title="未 push のコミット">↑{overview.ahead}</span>}
                    {overview.ahead === 0 && overview.behind === 0 && '同期済み'}
                  </span>
                </>
              ) : (
                <span className="git-remote-upstream">
                  上流ブランチなし（push で origin に設定します）
                </span>
              )}
            </div>
            <div className="git-remote-actions">
              {REMOTE_OPS.map(({ op, label, busyLabel, title }) => (
                <button
                  key={op}
                  title={title}
                  disabled={busy !== null}
                  onClick={() => void remote(op)}
                >
                  {busy === op ? busyLabel : label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
