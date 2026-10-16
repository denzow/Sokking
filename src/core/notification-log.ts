import type { DatabaseSync } from 'node:sqlite'
import type {
  DesktopNotification,
  NotificationLogEntry,
  NotificationLogResult
} from '../shared/notifications'

interface LogRow {
  id: number
  app: string
  title: string
  body: string
  received_at: string
  matched_filter_id: number | null
  result: string
  task_id: number | null
}

/** Received notifications, kept for a while so rules can be tuned against them. */
export class NotificationLogRepository {
  private listeners = new Set<() => void>()

  constructor(private db: DatabaseSync) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  add(
    n: DesktopNotification,
    outcome: { result: NotificationLogResult; matchedFilterId: number | null; taskId: number | null }
  ): NotificationLogEntry {
    const result = this.db
      .prepare(
        `INSERT INTO notification_log (app, title, body, received_at, matched_filter_id, result, task_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(n.app, n.title, n.body, n.receivedAt, outcome.matchedFilterId, outcome.result, outcome.taskId)
    this.notify()
    return this.get(Number(result.lastInsertRowid)) as NotificationLogEntry
  }

  get(id: number): NotificationLogEntry | null {
    const row = this.db.prepare('SELECT * FROM notification_log WHERE id = ?').get(id) as unknown as
      | LogRow
      | undefined
    return row ? toEntry(row) : null
  }

  /** Newest first. */
  list(limit = 200): NotificationLogEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM notification_log ORDER BY id DESC LIMIT ?')
      .all(Math.max(1, Math.floor(limit))) as unknown as LogRow[]
    return rows.map(toEntry)
  }

  /** Drops entries older than the retention or beyond the count cap. */
  prune(options: { keepDays: number; keepCount: number }): number {
    const cutoff = new Date(Date.now() - options.keepDays * 86400_000).toISOString()
    let changes = Number(
      this.db.prepare('DELETE FROM notification_log WHERE received_at < ?').run(cutoff).changes
    )
    changes += Number(
      this.db
        .prepare(
          `DELETE FROM notification_log WHERE id NOT IN (
             SELECT id FROM notification_log ORDER BY id DESC LIMIT ?
           )`
        )
        .run(Math.max(0, Math.floor(options.keepCount))).changes
    )
    if (changes > 0) this.notify()
    return changes
  }

  clear(): void {
    this.db.exec('DELETE FROM notification_log')
    this.notify()
  }
}

function toEntry(row: LogRow): NotificationLogEntry {
  return {
    id: row.id,
    app: row.app,
    title: row.title,
    body: row.body,
    receivedAt: row.received_at,
    matchedFilterId: row.matched_filter_id,
    result: row.result as NotificationLogResult,
    taskId: row.task_id
  }
}
