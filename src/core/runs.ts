import type { DatabaseSync } from 'node:sqlite'
import {
  DELIVERIES,
  PERMISSION_MODES,
  Run,
  RunOptions,
  RunResult
} from '../shared/runs'

interface RunRow {
  id: number
  task_id: number
  tab_id: string
  mode: string
  permission_mode: string
  delivery: string
  push_branch: string | null
  workdir: string
  prompt: string
  session_id: string | null
  branch: string | null
  pr_url: string | null
  started_at: string
  finished_at: string | null
  result: string | null
}

export class RunError extends Error {}

/** Processing runs, one per launched Claude Code session. */
export class RunRepository {
  private listeners = new Set<() => void>()

  constructor(private db: DatabaseSync) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  start(taskId: number, tabId: string, options: RunOptions): Run {
    if (!PERMISSION_MODES.includes(options.permissionMode)) {
      throw new RunError(`不明な permission mode: ${options.permissionMode}`)
    }
    if (!DELIVERIES.includes(options.delivery)) {
      throw new RunError(`不明な delivery: ${options.delivery}`)
    }
    const pushBranch = options.pushBranch?.trim() || null
    if (options.delivery === 'push' && !pushBranch) {
      throw new RunError('直接 push には push 先のブランチが必要です')
    }
    if (!options.workdir.trim()) throw new RunError('作業ディレクトリは必須です')
    const result = this.db
      .prepare(
        `INSERT INTO run (task_id, tab_id, mode, permission_mode, delivery, push_branch, workdir, prompt, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        taskId,
        tabId,
        options.mode ?? 'interactive',
        options.permissionMode,
        options.delivery,
        pushBranch,
        options.workdir,
        options.prompt,
        new Date().toISOString()
      )
    this.notify()
    return this.get(Number(result.lastInsertRowid)) as Run
  }

  get(id: number): Run | null {
    const row = this.db.prepare('SELECT * FROM run WHERE id = ?').get(id) as unknown as
      | RunRow
      | undefined
    return row ? toRun(row) : null
  }

  listForTask(taskId: number): Run[] {
    const rows = this.db
      .prepare('SELECT * FROM run WHERE task_id = ? ORDER BY id DESC')
      .all(taskId) as unknown as RunRow[]
    return rows.map(toRun)
  }

  /** The unfinished run living in a tab, if any. */
  openForTab(tabId: string): Run | null {
    const row = this.db
      .prepare('SELECT * FROM run WHERE tab_id = ? AND finished_at IS NULL ORDER BY id DESC LIMIT 1')
      .get(tabId) as unknown as RunRow | undefined
    return row ? toRun(row) : null
  }

  listOpen(): Run[] {
    const rows = this.db
      .prepare('SELECT * FROM run WHERE finished_at IS NULL ORDER BY id')
      .all() as unknown as RunRow[]
    return rows.map(toRun)
  }

  setSessionId(id: number, sessionId: string): void {
    this.db.prepare('UPDATE run SET session_id = ? WHERE id = ?').run(sessionId, id)
    this.notify()
  }

  setPrUrl(id: number, prUrl: string): void {
    this.db.prepare('UPDATE run SET pr_url = ? WHERE id = ?').run(prUrl, id)
    this.notify()
  }

  setBranch(id: number, branch: string): void {
    this.db.prepare('UPDATE run SET branch = ? WHERE id = ?').run(branch, id)
    this.notify()
  }

  finish(id: number, result: RunResult): void {
    this.db
      .prepare('UPDATE run SET finished_at = ?, result = ? WHERE id = ? AND finished_at IS NULL')
      .run(new Date().toISOString(), result, id)
    this.notify()
  }

  /** Closes every run left open by a previous process (crash, restart). */
  finishAllOpen(result: RunResult): number {
    const changes = this.db
      .prepare('UPDATE run SET finished_at = ?, result = ? WHERE finished_at IS NULL')
      .run(new Date().toISOString(), result).changes
    if (changes > 0) this.notify()
    return Number(changes)
  }
}

function toRun(row: RunRow): Run {
  return {
    id: row.id,
    taskId: row.task_id,
    tabId: row.tab_id,
    mode: row.mode as Run['mode'],
    permissionMode: row.permission_mode as Run['permissionMode'],
    delivery: row.delivery as Run['delivery'],
    pushBranch: row.push_branch,
    workdir: row.workdir,
    prompt: row.prompt,
    sessionId: row.session_id,
    branch: row.branch,
    prUrl: row.pr_url,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    result: row.result as RunResult | null
  }
}
