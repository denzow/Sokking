import { useEffect, useMemo, useState } from 'react'
import type { Task, TaskSource, TaskStatus } from '../../../shared/tasks'
import { useTasksStore } from '../stores/tasks'
import { useTabsStore } from '../stores/tabs'

interface TaskBoxProps {
  /** Open (or switch to) the processing tab for a task that has a workdir. */
  onOpenInTab: (task: Task) => void
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  inbox: '受信箱',
  running: '処理中',
  review: '確認待ち',
  done: '完了',
  archived: 'アーカイブ'
}

const SOURCE_LABEL: Record<TaskSource, string> = {
  manual: '手動',
  notification: '通知',
  github: 'GitHub',
  schedule: 'ジョブ'
}

const FILTERS: TaskStatus[] = ['inbox', 'running', 'review', 'done', 'archived']

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

function formatTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TaskBox({ onOpenInTab }: TaskBoxProps): React.JSX.Element {
  const tasks = useTasksStore((s) => s.tasks)
  const loaded = useTasksStore((s) => s.loaded)
  const error = useTasksStore((s) => s.error)
  const clearError = useTasksStore((s) => s.clearError)
  const tabs = useTabsStore((s) => s.tabs)
  const [filter, setFilter] = useState<TaskStatus>('inbox')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)

  const counts = useMemo(() => {
    const c: Record<TaskStatus, number> = { inbox: 0, running: 0, review: 0, done: 0, archived: 0 }
    for (const t of tasks) c[t.status]++
    return c
  }, [tasks])

  const visible = useMemo(() => tasks.filter((t) => t.status === filter), [tasks, filter])
  const selected = tasks.find((t) => t.id === selectedId) ?? null
  const openTaskIds = useMemo(
    () => new Set(tabs.flatMap((t) => (t.taskId === null ? [] : [t.taskId]))),
    [tabs]
  )

  // The selection follows the task across status changes; it only drops
  // when the task is gone.
  useEffect(() => {
    if (selectedId !== null && !tasks.some((t) => t.id === selectedId)) setSelectedId(null)
  }, [tasks, selectedId])

  return (
    <div className="taskbox">
      <div className="taskbox-header">
        <span className="taskbox-title">タスクボックス</span>
        <div className="taskbox-filters">
          {FILTERS.map((s) => (
            <button
              key={s}
              className={`taskbox-filter${filter === s ? ' active' : ''}`}
              onClick={() => setFilter(s)}
            >
              {STATUS_LABEL[s]}
              <span className="taskbox-filter-count">{counts[s]}</span>
            </button>
          ))}
        </div>
        <button className="taskbox-add-button" onClick={() => setAdding((v) => !v)}>
          {adding ? '閉じる' : '＋ 追加'}
        </button>
      </div>
      {error && (
        <div className="taskbox-error" onClick={clearError} title="クリックで閉じる">
          {error}
        </div>
      )}
      {adding && (
        <AddTaskForm
          onAdded={(task) => {
            setAdding(false)
            setFilter('inbox')
            setSelectedId(task.id)
          }}
        />
      )}
      <div className="taskbox-body">
        <div className="taskbox-list">
          {!loaded ? (
            <div className="taskbox-empty">読み込み中…</div>
          ) : visible.length === 0 ? (
            <div className="taskbox-empty">
              {filter === 'inbox' ? '受信箱は空です' : `${STATUS_LABEL[filter]}のタスクはありません`}
            </div>
          ) : (
            visible.map((task) => (
              <div
                key={task.id}
                className={`task-row${task.id === selectedId ? ' selected' : ''}`}
                onClick={() => setSelectedId(task.id)}
              >
                <span className={`task-source task-source-${task.source}`}>
                  {task.sourceApp ?? SOURCE_LABEL[task.source]}
                </span>
                <span className="task-row-main">
                  <span className="task-row-title">
                    {openTaskIds.has(task.id) && (
                      <span className="task-row-open" title="処理タブが開いています">
                        ▣
                      </span>
                    )}
                    {task.title}
                  </span>
                  <span className="task-row-meta">
                    {formatTime(task.createdAt)}
                    {task.workdir && <span className="task-row-dir">{abbreviateHome(task.workdir)}</span>}
                  </span>
                </span>
              </div>
            ))
          )}
        </div>
        {selected && (
          <TaskDetail
            key={selected.id}
            task={selected}
            tabOpen={openTaskIds.has(selected.id)}
            onOpenInTab={onOpenInTab}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  )
}

function AddTaskForm({ onAdded }: { onAdded: (task: Task) => void }): React.JSX.Element {
  const add = useTasksStore((s) => s.add)
  const activeTab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const [title, setTitle] = useState('')
  const [workdir, setWorkdir] = useState(activeTab?.cwd ? abbreviateHome(activeTab.cwd) : '')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (!title.trim() || busy) return
    setBusy(true)
    const task = await add({
      title,
      body,
      workdir: workdir.trim() ? expandHome(workdir.trim()) : null
    })
    setBusy(false)
    if (task) onAdded(task)
  }

  return (
    <div className="task-form">
      <input
        className="task-form-title"
        autoFocus
        placeholder="タイトル"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
        }}
      />
      <input
        className="task-form-workdir"
        placeholder="作業ディレクトリ (例: ~/work/app)"
        value={workdir}
        onChange={(e) => setWorkdir(e.target.value)}
      />
      <textarea
        className="task-form-body"
        placeholder="内容 (任意)"
        rows={4}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="task-form-actions">
        <button className="primary" disabled={!title.trim() || busy} onClick={() => void submit()}>
          追加
        </button>
      </div>
    </div>
  )
}

function TaskDetail({
  task,
  tabOpen,
  onOpenInTab,
  onClose
}: {
  task: Task
  tabOpen: boolean
  onOpenInTab: (task: Task) => void
  onClose: () => void
}): React.JSX.Element {
  const update = useTasksStore((s) => s.update)
  const setStatus = useTasksStore((s) => s.setStatus)
  const remove = useTasksStore((s) => s.remove)
  const [title, setTitle] = useState(task.title)
  const [body, setBody] = useState(task.body)
  const [workdir, setWorkdir] = useState(task.workdir ? abbreviateHome(task.workdir) : '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Outside writes (CLI, another view) show up in the fields unless the
  // user is mid-edit on that field.
  useEffect(() => setTitle(task.title), [task.title])
  useEffect(() => setBody(task.body), [task.body])
  useEffect(() => setWorkdir(task.workdir ? abbreviateHome(task.workdir) : ''), [task.workdir])

  const dirty =
    title !== task.title ||
    body !== task.body ||
    (workdir.trim() ? expandHome(workdir.trim()) : null) !== task.workdir

  const save = async (): Promise<Task | null> =>
    update(task.id, {
      title,
      body,
      workdir: workdir.trim() ? expandHome(workdir.trim()) : null
    })

  const openInTab = async (): Promise<void> => {
    // Edits (notably a just-typed workdir) travel with the open.
    const latest = dirty ? await save() : task
    if (!latest) return
    if (!latest.workdir) return
    onOpenInTab(latest)
  }

  return (
    <div className="task-detail">
      <div className="task-detail-header">
        <span className={`task-source task-source-${task.source}`}>
          {task.sourceApp ?? SOURCE_LABEL[task.source]}
        </span>
        <span className="task-detail-status">{STATUS_LABEL[task.status]}</span>
        <span className="task-detail-id">#{task.id}</span>
        <span className="task-detail-time">{formatTime(task.createdAt)}</span>
        <button className="icon-button" title="閉じる" onClick={onClose}>
          ×
        </button>
      </div>
      <input className="task-detail-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label className="task-detail-label">
        作業ディレクトリ
        <input
          placeholder="例: ~/work/app"
          value={workdir}
          onChange={(e) => setWorkdir(e.target.value)}
        />
      </label>
      {task.sourceRef && (
        <div className="task-detail-ref">
          <a
            href={task.sourceRef}
            onClick={(e) => {
              e.preventDefault()
              window.sokking.openExternal(task.sourceRef as string)
            }}
          >
            {task.sourceRef}
          </a>
        </div>
      )}
      <textarea
        className="task-detail-body"
        placeholder="内容"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="task-detail-actions">
        <button
          className="primary"
          disabled={!workdir.trim()}
          title={workdir.trim() ? undefined : '作業ディレクトリを指定してください'}
          onClick={() => void openInTab()}
        >
          {tabOpen ? '処理タブへ' : '処理タブを開く'}
        </button>
        {dirty && <button onClick={() => void save()}>保存</button>}
        <span className="task-detail-spacer" />
        {task.status !== 'inbox' && (
          <button onClick={() => void setStatus(task.id, 'inbox')}>受信箱へ戻す</button>
        )}
        {task.status !== 'done' && (
          <button onClick={() => void setStatus(task.id, 'done')}>完了</button>
        )}
        {task.status !== 'archived' && (
          <button onClick={() => void setStatus(task.id, 'archived')}>アーカイブ</button>
        )}
        {confirmDelete ? (
          <button className="danger" onClick={() => void remove(task.id)} onBlur={() => setConfirmDelete(false)}>
            本当に削除
          </button>
        ) : (
          <button onClick={() => setConfirmDelete(true)}>削除</button>
        )}
      </div>
    </div>
  )
}
