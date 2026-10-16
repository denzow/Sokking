import { useEffect, useRef, useState } from 'react'
import type { Task } from '../../../shared/tasks'
import { Delivery, PermissionMode, PERMISSION_MODES, Run } from '../../../shared/runs'
import { useTabsStore } from '../stores/tabs'
import { useTasksStore } from '../stores/tasks'

interface StartRunModalProps {
  task: Task
  onClose: () => void
  /** The run launched; the caller shows its tab. */
  onStarted: (run: Run, tabId: string) => void
}

const MODE_LABEL: Record<PermissionMode, string> = {
  default: 'default (毎回確認)',
  acceptEdits: 'acceptEdits (編集は自動承認)',
  plan: 'plan (計画のみ)',
  bypassPermissions: 'bypassPermissions (すべて自動承認)'
}

function expandHome(dir: string): string {
  const home = window.sokking.homeDir
  if (!home) return dir
  if (dir === '~') return home
  return dir.startsWith('~/') ? home + dir.slice(1) : dir
}

function abbreviateHome(dir: string): string {
  const home = window.sokking.homeDir
  if (home && (dir === home || dir.startsWith(home + '/'))) return '~' + dir.slice(home.length)
  return dir
}

/**
 * The launch dialog: where to run, how much Claude Code may do on its own,
 * how the result leaves the tree, and the prompt — prefilled from the
 * repository's defaults and the task, all editable before launch.
 */
export function StartRunModal({ task, onClose, onStarted }: StartRunModalProps): React.JSX.Element {
  const [workdir, setWorkdir] = useState(task.workdir ? abbreviateHome(task.workdir) : '')
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('acceptEdits')
  const [delivery, setDelivery] = useState<Delivery>('pr')
  const [pushBranch, setPushBranch] = useState('')
  const [prompt, setPrompt] = useState('')
  const [promptEdited, setPromptEdited] = useState(false)
  const [saveDefaults, setSaveDefaults] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [defaultsLoadedFor, setDefaultsLoadedFor] = useState<string | null>(null)
  const workdirTimer = useRef<number | null>(null)

  // Repository defaults follow the directory field (debounced while typing).
  useEffect(() => {
    const dir = workdir.trim() ? expandHome(workdir.trim()) : ''
    if (!dir) return
    if (workdirTimer.current) window.clearTimeout(workdirTimer.current)
    workdirTimer.current = window.setTimeout(() => {
      void window.sokking.repoResolve(dir).then((d) => {
        setPermissionMode(d.defaultPermissionMode)
        setDelivery(d.defaultDelivery)
        setPushBranch(d.defaultPushBranch ?? '')
        setDefaultsLoadedFor(dir)
      })
    }, 250)
    return () => {
      if (workdirTimer.current) window.clearTimeout(workdirTimer.current)
    }
  }, [workdir])

  // The prompt regenerates with the delivery choice until the user edits it.
  useEffect(() => {
    if (promptEdited) return
    void window.sokking
      .promptBuild(task.id, delivery, pushBranch.trim() || null)
      .then((p) => setPrompt(p))
  }, [task.id, delivery, pushBranch, promptEdited])

  const canStart =
    workdir.trim() !== '' &&
    prompt.trim() !== '' &&
    (delivery !== 'push' || pushBranch.trim() !== '') &&
    !busy

  const start = async (): Promise<void> => {
    if (!canStart) return
    setBusy(true)
    setError(null)
    const dir = expandHome(workdir.trim())
    if (saveDefaults) {
      const saved = await window.sokking.repoSet({
        workdir: dir,
        defaultDelivery: delivery,
        defaultPushBranch: pushBranch.trim() || null,
        defaultPermissionMode: permissionMode
      })
      if (!saved.ok) {
        setError(saved.error)
        setBusy(false)
        return
      }
    }
    // The task's tab, or a new one in the chosen directory.
    const tabs = useTabsStore.getState()
    const existing = tabs.tabs.find((t) => t.taskId === task.id)
    const tabId = existing
      ? existing.id
      : tabs.addTab(dir, { title: task.title, taskId: task.id })
    if (existing) tabs.activateTab(existing.id)
    const result = await window.sokking.runStart(task.id, tabId, {
      workdir: dir,
      permissionMode,
      delivery,
      pushBranch: delivery === 'push' ? pushBranch.trim() : null,
      prompt
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await useTasksStore.getState().refresh()
    onStarted(result.run, tabId)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal start-run-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">処理を開始: {task.title}</span>
          <button className="icon-button" onClick={onClose} title="閉じる">
            ×
          </button>
        </div>
        <div className="modal-body start-run-body">
          <label className="start-run-field">
            作業ディレクトリ
            <input
              autoFocus={!task.workdir}
              placeholder="例: ~/work/app"
              value={workdir}
              onChange={(e) => setWorkdir(e.target.value)}
            />
          </label>
          <div className="start-run-row">
            <label className="start-run-field">
              権限モード
              <select
                value={permissionMode}
                onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}
              >
                {PERMISSION_MODES.map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="start-run-field">
              成果の形
              <select value={delivery} onChange={(e) => setDelivery(e.target.value as Delivery)}>
                <option value="pr">PR を作る</option>
                <option value="push">ブランチへ直接 push</option>
              </select>
            </label>
            {delivery === 'push' && (
              <label className="start-run-field">
                push 先ブランチ
                <input
                  placeholder="例: develop"
                  value={pushBranch}
                  onChange={(e) => setPushBranch(e.target.value)}
                />
              </label>
            )}
          </div>
          <label className="start-run-field start-run-prompt">
            <span>
              初期プロンプト
              {promptEdited && (
                <button
                  className="start-run-link"
                  onClick={(e) => {
                    e.preventDefault()
                    setPromptEdited(false)
                  }}
                >
                  テンプレートに戻す
                </button>
              )}
            </span>
            <textarea
              rows={10}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value)
                setPromptEdited(true)
              }}
            />
          </label>
          <label className="start-run-check">
            <input
              type="checkbox"
              checked={saveDefaults}
              onChange={(e) => setSaveDefaults(e.target.checked)}
            />
            権限モードと成果の形をこのリポジトリの既定値として保存する
            {defaultsLoadedFor && (
              <span className="start-run-hint"> ({abbreviateHome(defaultsLoadedFor)})</span>
            )}
          </label>
          {error && <div className="start-run-error">{error}</div>}
        </div>
        <div className="modal-footer start-run-footer">
          <button onClick={onClose}>キャンセル</button>
          <button className="primary" disabled={!canStart} onClick={() => void start()}>
            Claude Code を起動
          </button>
        </div>
      </div>
    </div>
  )
}
