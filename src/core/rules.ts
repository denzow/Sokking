import type { DatabaseSync } from 'node:sqlite'
import { DELIVERIES, PERMISSION_MODES } from '../shared/runs'
import {
  DEFAULT_RULE_INTERVAL_SECONDS,
  MIN_RULE_INTERVAL_SECONDS,
  Rule,
  RuleInput
} from '../shared/rules'

interface RuleRow {
  id: number
  name: string
  workdir: string
  query: string
  interval_seconds: number
  auto: number
  permission_mode: string
  delivery: string
  push_branch: string | null
  prompt_template: string | null
  enabled: number
  last_checked_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export class RuleError extends Error {}

export class RuleRepository {
  private listeners = new Set<() => void>()

  constructor(private db: DatabaseSync) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  list(): Rule[] {
    const rows = this.db.prepare('SELECT * FROM rule ORDER BY id').all() as unknown as RuleRow[]
    return rows.map(toRule)
  }

  get(id: number): Rule | null {
    const row = this.db.prepare('SELECT * FROM rule WHERE id = ?').get(id) as unknown as
      | RuleRow
      | undefined
    return row ? toRule(row) : null
  }

  add(input: RuleInput): Rule {
    const v = validate(input)
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `INSERT INTO rule (name, workdir, query, interval_seconds, auto, permission_mode, delivery,
           push_branch, prompt_template, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        v.name,
        v.workdir,
        v.query,
        v.intervalSeconds,
        v.auto ? 1 : 0,
        v.permissionMode,
        v.delivery,
        v.pushBranch,
        v.promptTemplate,
        v.enabled ? 1 : 0,
        now,
        now
      )
    this.notify()
    return this.get(Number(result.lastInsertRowid)) as Rule
  }

  update(id: number, input: RuleInput): Rule {
    if (!this.get(id)) throw new RuleError(`ルール #${id} がありません`)
    const v = validate(input)
    this.db
      .prepare(
        `UPDATE rule SET name = ?, workdir = ?, query = ?, interval_seconds = ?, auto = ?,
           permission_mode = ?, delivery = ?, push_branch = ?, prompt_template = ?, enabled = ?,
           updated_at = ?
         WHERE id = ?`
      )
      .run(
        v.name,
        v.workdir,
        v.query,
        v.intervalSeconds,
        v.auto ? 1 : 0,
        v.permissionMode,
        v.delivery,
        v.pushBranch,
        v.promptTemplate,
        v.enabled ? 1 : 0,
        new Date().toISOString(),
        id
      )
    this.notify()
    return this.get(id) as Rule
  }

  remove(id: number): void {
    const result = this.db.prepare('DELETE FROM rule WHERE id = ?').run(id)
    if (result.changes === 0) throw new RuleError(`ルール #${id} がありません`)
    this.notify()
  }

  /** Records the outcome of a check; a null error clears the previous one. */
  markChecked(id: number, error: string | null, at = new Date().toISOString()): void {
    this.db
      .prepare('UPDATE rule SET last_checked_at = ?, last_error = ? WHERE id = ?')
      .run(at, error, id)
    this.notify()
  }

  /** Enabled rules whose interval has elapsed since their last check. */
  due(now = Date.now()): Rule[] {
    return this.list().filter((r) => {
      if (!r.enabled) return false
      if (!r.lastCheckedAt) return true
      return now - Date.parse(r.lastCheckedAt) >= r.intervalSeconds * 1000
    })
  }
}

function validate(input: RuleInput): Required<Omit<RuleInput, 'pushBranch' | 'promptTemplate'>> & {
  pushBranch: string | null
  promptTemplate: string | null
} {
  const name = input.name.trim()
  if (!name) throw new RuleError('ルール名は必須です')
  const workdir = input.workdir.trim()
  if (!workdir) throw new RuleError('作業ディレクトリは必須です')
  const query = input.query.trim()
  if (!query) throw new RuleError('検索条件は必須です')
  const intervalSeconds = Math.floor(input.intervalSeconds ?? DEFAULT_RULE_INTERVAL_SECONDS)
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < MIN_RULE_INTERVAL_SECONDS) {
    throw new RuleError(`間隔は ${MIN_RULE_INTERVAL_SECONDS} 秒以上にしてください`)
  }
  const permissionMode = input.permissionMode ?? 'acceptEdits'
  if (!PERMISSION_MODES.includes(permissionMode)) {
    throw new RuleError(`不明な permission mode: ${permissionMode}`)
  }
  const delivery = input.delivery ?? 'pr'
  if (!DELIVERIES.includes(delivery)) throw new RuleError(`不明な delivery: ${delivery}`)
  const pushBranch = input.pushBranch?.trim() || null
  if (delivery === 'push' && !pushBranch) throw new RuleError('直接 push には push 先のブランチが必要です')
  return {
    name,
    workdir,
    query,
    intervalSeconds,
    auto: input.auto ?? false,
    permissionMode,
    delivery,
    pushBranch,
    promptTemplate: input.promptTemplate?.trim() || null,
    enabled: input.enabled ?? true
  }
}

function toRule(row: RuleRow): Rule {
  return {
    id: row.id,
    name: row.name,
    workdir: row.workdir,
    query: row.query,
    intervalSeconds: row.interval_seconds,
    auto: row.auto === 1,
    permissionMode: row.permission_mode as Rule['permissionMode'],
    delivery: row.delivery as Rule['delivery'],
    pushBranch: row.push_branch,
    promptTemplate: row.prompt_template,
    enabled: row.enabled === 1,
    lastCheckedAt: row.last_checked_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
