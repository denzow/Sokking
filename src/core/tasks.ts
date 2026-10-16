import type { DatabaseSync } from 'node:sqlite'
import {
  NewTask,
  Task,
  TaskFilter,
  TaskPatch,
  TaskStatus,
  TASK_SOURCES,
  TASK_STATUSES
} from '../shared/tasks'

interface TaskRow {
  id: number
  source: string
  title: string
  body: string
  source_app: string | null
  source_ref: string | null
  status: string
  workdir: string | null
  created_at: string
  updated_at: string
}

export class TaskError extends Error {}

/**
 * The task box. Every change notifies the listeners so the UI (and anything
 * else holding a view of the list) can refresh — the writer may be the
 * renderer, the CLI over the control socket, or a source in the background.
 */
export class TaskRepository {
  private listeners = new Set<() => void>()

  constructor(private db: DatabaseSync) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  list(filter: TaskFilter = {}): Task[] {
    const where: string[] = []
    const params: (string | number)[] = []
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status]
      where.push(`status IN (${statuses.map(() => '?').join(', ')})`)
      params.push(...statuses)
    }
    const sql =
      'SELECT * FROM task' +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY created_at DESC, id DESC' +
      (filter.limit ? ` LIMIT ${Math.max(1, Math.floor(filter.limit))}` : '')
    return (this.db.prepare(sql).all(...params) as unknown as TaskRow[]).map(toTask)
  }

  get(id: number): Task | null {
    const row = this.db.prepare('SELECT * FROM task WHERE id = ?').get(id) as unknown as TaskRow | undefined
    return row ? toTask(row) : null
  }

  /** A task that points at the same origin (issue URL, permalink), if any. */
  findBySourceRef(sourceRef: string): Task | null {
    const row = this.db
      .prepare('SELECT * FROM task WHERE source_ref = ? ORDER BY id DESC LIMIT 1')
      .get(sourceRef) as unknown as TaskRow | undefined
    return row ? toTask(row) : null
  }

  add(input: NewTask): Task {
    const title = input.title.trim()
    if (!title) throw new TaskError('タイトルは必須です')
    const source = input.source ?? 'manual'
    if (!TASK_SOURCES.includes(source)) throw new TaskError(`不明な source: ${source}`)
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `INSERT INTO task (source, title, body, source_app, source_ref, status, workdir, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'inbox', ?, ?, ?)`
      )
      .run(
        source,
        title,
        input.body ?? '',
        input.sourceApp ?? null,
        input.sourceRef ?? null,
        emptyToNull(input.workdir),
        now,
        now
      )
    const task = this.get(Number(result.lastInsertRowid))
    if (!task) throw new TaskError('登録したタスクを読み戻せません')
    this.notify()
    return task
  }

  update(id: number, patch: TaskPatch): Task {
    const current = this.get(id)
    if (!current) throw new TaskError(`タスク #${id} がありません`)
    if (patch.status && !TASK_STATUSES.includes(patch.status)) {
      throw new TaskError(`不明な status: ${patch.status}`)
    }
    const title = patch.title === undefined ? current.title : patch.title.trim()
    if (!title) throw new TaskError('タイトルは必須です')
    this.db
      .prepare(
        `UPDATE task SET title = ?, body = ?, status = ?, workdir = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        title,
        patch.body ?? current.body,
        patch.status ?? current.status,
        patch.workdir === undefined ? current.workdir : emptyToNull(patch.workdir),
        new Date().toISOString(),
        id
      )
    this.notify()
    return this.get(id) as Task
  }

  setStatus(id: number, status: TaskStatus): Task {
    return this.update(id, { status })
  }

  remove(id: number): void {
    const result = this.db.prepare('DELETE FROM task WHERE id = ?').run(id)
    if (result.changes === 0) throw new TaskError(`タスク #${id} がありません`)
    this.notify()
  }

  countByStatus(): Record<TaskStatus, number> {
    const counts = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<
      TaskStatus,
      number
    >
    const rows = this.db
      .prepare('SELECT status, COUNT(*) AS n FROM task GROUP BY status')
      .all() as unknown as { status: TaskStatus; n: number }[]
    for (const row of rows) if (row.status in counts) counts[row.status] = row.n
    return counts
  }
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    source: row.source as Task['source'],
    title: row.title,
    body: row.body,
    sourceApp: row.source_app,
    sourceRef: row.source_ref,
    status: row.status as TaskStatus,
    workdir: row.workdir,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
