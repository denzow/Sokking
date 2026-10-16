import type { DatabaseSync } from 'node:sqlite'
import {
  DesktopNotification,
  FILTER_ACTIONS,
  FilterAction,
  NotificationFilter,
  NotificationFilterInput
} from '../shared/notifications'

interface FilterRow {
  id: number
  name: string
  order: number
  enabled: number
  app_pattern: string
  title_pattern: string
  body_pattern: string
  action: string
  workdir: string | null
  prompt_template: string | null
  created_at: string
  updated_at: string
}

export class FilterError extends Error {}

/** Checks that every pattern compiles; the message names the bad one. */
export function validatePatterns(input: {
  appPattern?: string
  titlePattern?: string
  bodyPattern?: string
}): void {
  for (const [label, pattern] of [
    ['アプリ名', input.appPattern],
    ['要約', input.titlePattern],
    ['本文', input.bodyPattern]
  ] as const) {
    if (!pattern) continue
    try {
      new RegExp(pattern, 'i')
    } catch (e) {
      throw new FilterError(`${label}の正規表現が不正です: ${e instanceof Error ? e.message : e}`)
    }
  }
}

function matches(pattern: string, value: string): boolean {
  if (!pattern) return true
  try {
    return new RegExp(pattern, 'i').test(value)
  } catch {
    return false
  }
}

/** One rule against one notification: all three patterns must match. */
export function filterMatches(filter: NotificationFilter, n: DesktopNotification): boolean {
  return (
    matches(filter.appPattern, n.app) &&
    matches(filter.titlePattern, n.title) &&
    matches(filter.bodyPattern, n.body)
  )
}

export interface FilterDecision {
  action: FilterAction
  /** The rule that decided; null when the default applied. */
  filter: NotificationFilter | null
}

/** Tries the enabled rules in order; the first match decides, else the default. */
export function decide(
  filters: NotificationFilter[],
  n: DesktopNotification,
  defaultAction: FilterAction
): FilterDecision {
  for (const filter of filters) {
    if (!filter.enabled) continue
    if (filterMatches(filter, n)) return { action: filter.action, filter }
  }
  return { action: defaultAction, filter: null }
}

export class NotificationFilterRepository {
  private listeners = new Set<() => void>()

  constructor(private db: DatabaseSync) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  list(): NotificationFilter[] {
    const rows = this.db
      .prepare('SELECT * FROM notification_filter ORDER BY "order", id')
      .all() as unknown as FilterRow[]
    return rows.map(toFilter)
  }

  get(id: number): NotificationFilter | null {
    const row = this.db
      .prepare('SELECT * FROM notification_filter WHERE id = ?')
      .get(id) as unknown as FilterRow | undefined
    return row ? toFilter(row) : null
  }

  /** Appends the rule at the end of the order. */
  add(input: NotificationFilterInput): NotificationFilter {
    validate(input)
    const now = new Date().toISOString()
    const last = this.db
      .prepare('SELECT COALESCE(MAX("order"), 0) AS o FROM notification_filter')
      .get() as unknown as { o: number }
    const result = this.db
      .prepare(
        `INSERT INTO notification_filter
           (name, "order", enabled, app_pattern, title_pattern, body_pattern, action, workdir, prompt_template, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.name.trim(),
        last.o + 1,
        input.enabled === false ? 0 : 1,
        input.appPattern ?? '',
        input.titlePattern ?? '',
        input.bodyPattern ?? '',
        input.action,
        emptyToNull(input.workdir),
        emptyToNull(input.promptTemplate),
        now,
        now
      )
    this.notify()
    return this.get(Number(result.lastInsertRowid)) as NotificationFilter
  }

  update(id: number, input: NotificationFilterInput): NotificationFilter {
    if (!this.get(id)) throw new FilterError(`ルール #${id} がありません`)
    validate(input)
    this.db
      .prepare(
        `UPDATE notification_filter SET name = ?, enabled = ?, app_pattern = ?, title_pattern = ?,
           body_pattern = ?, action = ?, workdir = ?, prompt_template = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.name.trim(),
        input.enabled === false ? 0 : 1,
        input.appPattern ?? '',
        input.titlePattern ?? '',
        input.bodyPattern ?? '',
        input.action,
        emptyToNull(input.workdir),
        emptyToNull(input.promptTemplate),
        new Date().toISOString(),
        id
      )
    this.notify()
    return this.get(id) as NotificationFilter
  }

  setEnabled(id: number, enabled: boolean): void {
    this.db
      .prepare('UPDATE notification_filter SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, new Date().toISOString(), id)
    this.notify()
  }

  remove(id: number): void {
    const result = this.db.prepare('DELETE FROM notification_filter WHERE id = ?').run(id)
    if (result.changes === 0) throw new FilterError(`ルール #${id} がありません`)
    this.notify()
  }

  /** Reorders to the given id sequence; ids left out keep their relative order after. */
  reorder(ids: number[]): void {
    const current = this.list().map((f) => f.id)
    const rest = current.filter((id) => !ids.includes(id))
    const sequence = [...ids.filter((id) => current.includes(id)), ...rest]
    const stmt = this.db.prepare('UPDATE notification_filter SET "order" = ? WHERE id = ?')
    this.db.exec('BEGIN')
    try {
      sequence.forEach((id, index) => stmt.run(index + 1, id))
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    this.notify()
  }
}

function validate(input: NotificationFilterInput): void {
  if (!input.name.trim()) throw new FilterError('ルール名は必須です')
  if (!FILTER_ACTIONS.includes(input.action)) throw new FilterError(`不明な action: ${input.action}`)
  validatePatterns(input)
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function toFilter(row: FilterRow): NotificationFilter {
  return {
    id: row.id,
    name: row.name,
    order: row.order,
    enabled: row.enabled === 1,
    appPattern: row.app_pattern,
    titlePattern: row.title_pattern,
    bodyPattern: row.body_pattern,
    action: row.action as FilterAction,
    workdir: row.workdir,
    promptTemplate: row.prompt_template,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
