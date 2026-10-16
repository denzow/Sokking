import { useEffect, useState } from 'react'
import type { Task, TaskStatus } from '../../../shared/tasks'
import type { Run } from '../../../shared/runs'
import type { Tab } from '../stores/tabs'
import { useTasksStore } from '../stores/tasks'
import { latestRun, useRunsStore } from '../stores/runs'

interface TaskPanelProps {
  tab: Tab
  /** Relaunch Claude Code for the task (opens the launch dialog). */
  onRelaunch: (task: Task) => void
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  inbox: '受信箱',
  running: '処理中',
  review: '確認待ち',
  done: '完了',
  archived: 'アーカイブ'
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function runLabel(run: Run): string {
  if (!run.finishedAt) return '実行中'
  switch (run.result) {
    case 'done':
      return '終了'
    case 'failed':
      return '失敗'
    case 'interrupted':
      return '中断'
    default:
      return '終了'
  }
}

/** The task behind a processing tab: what was asked, how it runs, what came out. */
export function TaskPanel({ tab, onRelaunch }: TaskPanelProps): React.JSX.Element {
  const task = useTasksStore((s) => s.tasks.find((t) => t.id === tab.taskId) ?? null)
  const setStatus = useTasksStore((s) => s.setStatus)
  const runs = useRunsStore((s) => (tab.taskId === null ? [] : (s.byTask[tab.taskId] ?? [])))
  const load = useRunsStore((s) => s.load)
  const [showPrompt, setShowPrompt] = useState(false)

  useEffect(() => {
    if (tab.taskId !== null) void load(tab.taskId)
  }, [tab.taskId, load])

  if (!task) {
    return <div className="task-panel task-panel-empty">タスクが見つかりません(削除された可能性があります)</div>
  }
  const run = latestRun(useRunsStore.getState().byTask, task.id) ?? runs[0] ?? null

  return (
    <div className="task-panel">
      <div className="task-panel-header">
        <span className="task-panel-status">{STATUS_LABEL[task.status]}</span>
        <span className="task-panel-title">{task.title}</span>
        <span className="task-panel-id">#{task.id}</span>
      </div>
      <div className="task-panel-columns">
        <div className="task-panel-main">
          {task.sourceRef && (
            <a
              className="task-panel-ref"
              href={task.sourceRef}
              onClick={(e) => {
                e.preventDefault()
                window.sokking.openExternal(task.sourceRef as string)
              }}
            >
              {task.sourceRef}
            </a>
          )}
          <pre className="task-panel-body">{task.body || '(内容なし)'}</pre>
        </div>
        <div className="task-panel-side">
          <div className="task-panel-section-title">実行</div>
          {run ? (
            <dl className="task-panel-run">
              <dt>状態</dt>
              <dd>{runLabel(run)}</dd>
              <dt>開始</dt>
              <dd>{formatTime(run.startedAt)}</dd>
              <dt>権限</dt>
              <dd>{run.permissionMode}</dd>
              <dt>成果</dt>
              <dd>{run.delivery === 'pr' ? 'PR' : `push → ${run.pushBranch}`}</dd>
              {run.prUrl && (
                <>
                  <dt>PR</dt>
                  <dd>
                    <a
                      href={run.prUrl}
                      onClick={(e) => {
                        e.preventDefault()
                        window.sokking.openExternal(run.prUrl as string)
                      }}
                    >
                      {run.prUrl.replace('https://github.com/', '')}
                    </a>
                  </dd>
                </>
              )}
              {run.sessionId && (
                <>
                  <dt>session</dt>
                  <dd className="task-panel-session" title={run.sessionId}>
                    {run.sessionId}
                  </dd>
                </>
              )}
            </dl>
          ) : (
            <div className="task-panel-hint">まだ Claude Code を起動していません</div>
          )}
          {run && (
            <button className="start-run-link" onClick={() => setShowPrompt((v) => !v)}>
              {showPrompt ? 'プロンプトを隠す' : 'プロンプトを表示'}
            </button>
          )}
          {run && showPrompt && <pre className="task-panel-prompt">{run.prompt}</pre>}
          {runs.length > 1 && (
            <div className="task-panel-hint">これまでの実行: {runs.length} 回</div>
          )}
          <div className="task-panel-actions">
            <button className="primary" onClick={() => onRelaunch(task)}>
              {run && !run.finishedAt ? 'Claude Code を起動し直す' : 'Claude Code を起動'}
            </button>
            {task.status !== 'done' && (
              <button onClick={() => void setStatus(task.id, 'done')}>完了にする</button>
            )}
            {task.status !== 'inbox' && (
              <button onClick={() => void setStatus(task.id, 'inbox')}>受信箱へ戻す</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
