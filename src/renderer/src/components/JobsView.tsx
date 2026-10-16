import { useEffect, useState } from 'react'
import { Delivery, PermissionMode, PERMISSION_MODES } from '../../../shared/runs'
import {
  DEFAULT_JOB_TIMEOUT_SECONDS,
  Execution,
  ExecutionStatus,
  JobInput,
  JobKind,
  JobSummary
} from '../../../shared/jobs'
import { useJobsStore } from '../stores/jobs'

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
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const STATUS_LABEL: Record<ExecutionStatus, string> = {
  running: '実行中',
  success: '成功',
  failed: '失敗',
  timeout: 'タイムアウト',
  queued: 'タスク化'
}

interface JobDraft {
  id: number | null
  name: string
  cron: string
  kind: JobKind
  command: string
  prompt: string
  workdir: string
  timeoutSeconds: string
  permissionMode: PermissionMode
  delivery: Delivery
  pushBranch: string
  enabled: boolean
}

function emptyDraft(): JobDraft {
  return {
    id: null,
    name: '',
    cron: '0 9 * * 1-5',
    kind: 'shell',
    command: '',
    prompt: '',
    workdir: '',
    timeoutSeconds: String(DEFAULT_JOB_TIMEOUT_SECONDS),
    permissionMode: 'acceptEdits',
    delivery: 'pr',
    pushBranch: '',
    enabled: true
  }
}

function draftFromJob(j: JobSummary): JobDraft {
  return {
    id: j.id,
    name: j.name,
    cron: j.cron,
    kind: j.kind,
    command: j.command,
    prompt: j.prompt,
    workdir: j.workdir ? abbreviateHome(j.workdir) : '',
    timeoutSeconds: String(j.timeoutSeconds),
    permissionMode: j.permissionMode,
    delivery: j.delivery,
    pushBranch: j.pushBranch ?? '',
    enabled: j.enabled
  }
}

/** Scheduled jobs: the list with next/last run, and the execution history. */
export function JobsView(): React.JSX.Element {
  const jobs = useJobsStore((s) => s.jobs)
  const executions = useJobsStore((s) => s.executions)
  const loaded = useJobsStore((s) => s.loaded)
  const error = useJobsStore((s) => s.error)
  const clearError = useJobsStore((s) => s.clearError)
  const [draft, setDraft] = useState<JobDraft | null>(null)
  const [selectedExecution, setSelectedExecution] = useState<number | null>(null)
  const [filterJob, setFilterJob] = useState<number | null>(null)

  useEffect(() => {
    void useJobsStore.getState().refresh()
    void useJobsStore.getState().refreshExecutions()
  }, [])

  const jobName = (id: number): string => jobs.find((j) => j.id === id)?.name ?? `#${id} (削除済み)`
  const visible = filterJob === null ? executions : executions.filter((e) => e.jobId === filterJob)
  const selected = executions.find((e) => e.id === selectedExecution) ?? null

  return (
    <div className="notif-view">
      <div className="notif-header">
        <span className="notif-title">ジョブ</span>
        <span className="notif-spacer" />
        <button className="notif-button" onClick={() => setDraft(emptyDraft())}>
          ＋ ジョブ
        </button>
      </div>
      {error && (
        <div className="taskbox-error" onClick={clearError} title="クリックで閉じる">
          {error}
        </div>
      )}
      <div className="notif-body">
        <div className="notif-column notif-log">
          <div className="notif-column-header">
            <span>ジョブ</span>
            <span className="notif-column-count">{jobs.length}</span>
          </div>
          {!loaded ? (
            <div className="taskbox-empty">読み込み中…</div>
          ) : jobs.length === 0 ? (
            <div className="taskbox-empty">
              ジョブがありません。cron 式で、シェルコマンドの実行か Claude Code へのプロンプトを予約できます。
            </div>
          ) : (
            jobs.map((j) => (
              <JobRow
                key={j.id}
                job={j}
                selected={filterJob === j.id}
                onEdit={() => setDraft(draftFromJob(j))}
                onSelect={() => setFilterJob(filterJob === j.id ? null : j.id)}
              />
            ))
          )}
        </div>
        <div className="notif-column notif-filters">
          <div className="notif-column-header">
            <span>実行履歴{filterJob !== null && `: ${jobName(filterJob)}`}</span>
            <span className="notif-column-count">{visible.length}</span>
          </div>
          {visible.length === 0 ? (
            <div className="taskbox-empty">実行履歴はありません</div>
          ) : (
            visible.map((e) => (
              <div
                key={e.id}
                className={`exec-row${e.id === selectedExecution ? ' selected' : ''}`}
                onClick={() => setSelectedExecution(e.id === selectedExecution ? null : e.id)}
              >
                <span className={`notif-result exec-${e.status}`}>{STATUS_LABEL[e.status]}</span>
                <span className="exec-row-name">{jobName(e.jobId)}</span>
                <span className="notif-row-time">{formatTime(e.startedAt)}</span>
                {e.exitCode !== null && e.exitCode !== 0 && (
                  <span className="notif-row-time">exit {e.exitCode}</span>
                )}
              </div>
            ))
          )}
          {selected && <ExecutionDetail execution={selected} />}
        </div>
      </div>
      {draft && <JobEditor draft={draft} onClose={() => setDraft(null)} />}
    </div>
  )
}

function JobRow({
  job,
  selected,
  onEdit,
  onSelect
}: {
  job: JobSummary
  selected: boolean
  onEdit: () => void
  onSelect: () => void
}): React.JSX.Element {
  const update = useJobsStore((s) => s.update)
  const remove = useJobsStore((s) => s.remove)
  const run = useJobsStore((s) => s.run)
  const [confirm, setConfirm] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const toInput = (enabled: boolean): JobInput => ({
    name: job.name,
    cron: job.cron,
    kind: job.kind,
    command: job.command,
    prompt: job.prompt,
    workdir: job.workdir,
    timeoutSeconds: job.timeoutSeconds,
    permissionMode: job.permissionMode,
    delivery: job.delivery,
    pushBranch: job.pushBranch,
    enabled
  })

  return (
    <div className={`rule-row${job.enabled ? '' : ' disabled'}${selected ? ' selected' : ''}`}>
      <div className="rule-row-head">
        <input
          type="checkbox"
          checked={job.enabled}
          title={job.enabled ? '無効にする' : '有効にする'}
          onChange={(e) => void update(job.id, toInput(e.target.checked))}
        />
        <span className="task-source">{job.kind}</span>
        <span className="rule-row-name" onClick={onEdit} title="クリックで編集">
          {job.name}
        </span>
        <span className="notif-spacer" />
        <button className="start-run-link" onClick={onSelect} title="この履歴だけ表示">
          履歴
        </button>
        <button
          className="start-run-link"
          disabled={busy || job.running}
          onClick={() => {
            setBusy(true)
            void run(job.id).then((m) => {
              setMessage(m)
              setBusy(false)
            })
          }}
        >
          {job.running || busy ? '実行中…' : '今すぐ実行'}
        </button>
        {confirm ? (
          <button className="icon-button danger" onBlur={() => setConfirm(false)} onClick={() => void remove(job.id)}>
            削除!
          </button>
        ) : (
          <button className="icon-button" title="削除" onClick={() => setConfirm(true)}>
            ×
          </button>
        )}
      </div>
      <div className="rule-row-detail">
        <code>{job.cron}</code>
        <span className="exec-command">{job.kind === 'shell' ? job.command : job.prompt.split('\n')[0]}</span>
        {job.workdir && <span className="rule-row-dir">{abbreviateHome(job.workdir)}</span>}
      </div>
      <div className="rule-row-status">
        {job.nextRunAt ? `次回 ${formatTime(job.nextRunAt)}` : '予定なし'}
        {job.lastRunAt && ` / 前回 ${formatTime(job.lastRunAt)}`}
        {message && <span className="rule-row-message"> {message}</span>}
      </div>
    </div>
  )
}

function ExecutionDetail({ execution }: { execution: Execution }): React.JSX.Element {
  return (
    <div className="exec-detail">
      <div className="notif-column-header">
        <span>
          実行 #{execution.id} {STATUS_LABEL[execution.status]}
          {execution.exitCode !== null && ` (exit ${execution.exitCode})`}
        </span>
        <span className="notif-spacer" />
        <span className="notif-row-time">
          {formatTime(execution.startedAt)}
          {execution.finishedAt && ` → ${formatTime(execution.finishedAt)}`}
        </span>
      </div>
      {execution.taskId !== null && <div className="notif-row-task">task #{execution.taskId}</div>}
      <div className="exec-stream-label">stdout</div>
      <pre className="exec-stream">{execution.stdout || '(なし)'}</pre>
      <div className="exec-stream-label">stderr</div>
      <pre className="exec-stream">{execution.stderr || '(なし)'}</pre>
    </div>
  )
}

function JobEditor({ draft, onClose }: { draft: JobDraft; onClose: () => void }): React.JSX.Element {
  const add = useJobsStore((s) => s.add)
  const update = useJobsStore((s) => s.update)
  const [d, setD] = useState(draft)
  const [busy, setBusy] = useState(false)
  const patch = (p: Partial<JobDraft>): void => setD((prev) => ({ ...prev, ...p }))

  const canSave =
    d.name.trim() !== '' &&
    d.cron.trim() !== '' &&
    (d.kind === 'shell' ? d.command.trim() !== '' : d.prompt.trim() !== '' && d.workdir.trim() !== '') &&
    (d.kind !== 'claude' || d.delivery !== 'push' || d.pushBranch.trim() !== '') &&
    !busy

  const save = async (): Promise<void> => {
    if (!canSave) return
    setBusy(true)
    const input: JobInput = {
      name: d.name,
      cron: d.cron,
      kind: d.kind,
      command: d.command,
      prompt: d.prompt,
      workdir: d.workdir.trim() ? expandHome(d.workdir.trim()) : null,
      timeoutSeconds: Number(d.timeoutSeconds) || 0,
      permissionMode: d.permissionMode,
      delivery: d.delivery,
      pushBranch: d.delivery === 'push' ? d.pushBranch : null,
      enabled: d.enabled
    }
    const ok = d.id === null ? await add(input) : await update(d.id, input)
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal start-run-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{d.id === null ? 'ジョブを追加' : 'ジョブを編集'}</span>
          <button className="icon-button" onClick={onClose} title="閉じる">
            ×
          </button>
        </div>
        <div className="modal-body start-run-body">
          <div className="start-run-row">
            <label className="start-run-field">
              ジョブ名
              <input autoFocus value={d.name} onChange={(e) => patch({ name: e.target.value })} />
            </label>
            <label className="start-run-field">
              cron 式 (分 時 日 月 曜日)
              <input value={d.cron} onChange={(e) => patch({ cron: e.target.value })} placeholder="0 9 * * 1-5" />
            </label>
            <label className="start-run-field">
              種類
              <select value={d.kind} onChange={(e) => patch({ kind: e.target.value as JobKind })}>
                <option value="shell">shell コマンド</option>
                <option value="claude">Claude Code</option>
              </select>
            </label>
          </div>
          <label className="start-run-field">
            作業ディレクトリ{d.kind === 'claude' ? ' (必須)' : ' (任意)'}
            <input placeholder="例: ~/work/app" value={d.workdir} onChange={(e) => patch({ workdir: e.target.value })} />
          </label>
          {d.kind === 'shell' ? (
            <>
              <label className="start-run-field">
                コマンド (ログインシェル経由で実行)
                <textarea rows={4} value={d.command} onChange={(e) => patch({ command: e.target.value })} />
              </label>
              <label className="start-run-field">
                タイムアウト (秒、0 で無制限)
                <input type="number" min={0} value={d.timeoutSeconds} onChange={(e) => patch({ timeoutSeconds: e.target.value })} />
              </label>
            </>
          ) : (
            <>
              <label className="start-run-field">
                プロンプト (実行時にタスクとして積まれ、処理タブで Claude Code に渡される)
                <textarea rows={6} value={d.prompt} onChange={(e) => patch({ prompt: e.target.value })} />
              </label>
              <div className="start-run-row">
                <label className="start-run-field">
                  権限モード
                  <select value={d.permissionMode} onChange={(e) => patch({ permissionMode: e.target.value as PermissionMode })}>
                    {PERMISSION_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="start-run-field">
                  成果の形
                  <select value={d.delivery} onChange={(e) => patch({ delivery: e.target.value as Delivery })}>
                    <option value="pr">PR を作る</option>
                    <option value="push">ブランチへ直接 push</option>
                  </select>
                </label>
                {d.delivery === 'push' && (
                  <label className="start-run-field">
                    push 先ブランチ
                    <input value={d.pushBranch} onChange={(e) => patch({ pushBranch: e.target.value })} />
                  </label>
                )}
              </div>
            </>
          )}
        </div>
        <div className="modal-footer start-run-footer">
          <button onClick={onClose}>キャンセル</button>
          <button className="primary" disabled={!canSave} onClick={() => void save()}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
