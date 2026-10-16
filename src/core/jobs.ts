import type { DatabaseSync } from 'node:sqlite'
import { Cron } from 'croner'
import { DELIVERIES, PERMISSION_MODES } from '../shared/runs'
import {
  DEFAULT_JOB_TIMEOUT_SECONDS,
  Execution,
  ExecutionStatus,
  Job,
  JobInput,
  JOB_KINDS
} from '../shared/jobs'

interface JobRow {
  id: number
  name: string
  cron: string
  kind: string
  command: string
  prompt: string
  workdir: string | null
  timeout_seconds: number
  permission_mode: string
  delivery: string
  push_branch: string | null
  enabled: number
  last_run_at: string | null
  created_at: string
  updated_at: string
}

interface ExecutionRow {
  id: number
  job_id: number
  status: string
  exit_code: number | null
  stdout: string
  stderr: string
  task_id: number | null
  started_at: string
  finished_at: string | null
}

export class JobError extends Error {}

/** Throws a JobError when the expression isn't something croner accepts. */
export function validateCron(expression: string): void {
  try {
    const cron = new Cron(expression.trim(), { paused: true })
    cron.stop()
  } catch (e) {
    throw new JobError(`cron 式が不正です: ${e instanceof Error ? e.message : e}`)
  }
}

/** The next time the expression fires after `from`, or null if never. */
export function nextRun(expression: string, from = new Date()): Date | null {
  try {
    const cron = new Cron(expression.trim(), { paused: true })
    const next = cron.nextRun(from)
    cron.stop()
    return next
  } catch {
    return null
  }
}

export class JobRepository {
  private listeners = new Set<() => void>()

  constructor(private db: DatabaseSync) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  list(): Job[] {
    const rows = this.db.prepare('SELECT * FROM job ORDER BY id').all() as unknown as JobRow[]
    return rows.map(toJob)
  }

  get(id: number): Job | null {
    const row = this.db.prepare('SELECT * FROM job WHERE id = ?').get(id) as unknown as JobRow | undefined
    return row ? toJob(row) : null
  }

  add(input: JobInput): Job {
    const v = validate(input)
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `INSERT INTO job (name, cron, kind, command, prompt, workdir, timeout_seconds, permission_mode,
           delivery, push_branch, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        v.name,
        v.cron,
        v.kind,
        v.command,
        v.prompt,
        v.workdir,
        v.timeoutSeconds,
        v.permissionMode,
        v.delivery,
        v.pushBranch,
        v.enabled ? 1 : 0,
        now,
        now
      )
    this.notify()
    return this.get(Number(result.lastInsertRowid)) as Job
  }

  update(id: number, input: JobInput): Job {
    if (!this.get(id)) throw new JobError(`ジョブ #${id} がありません`)
    const v = validate(input)
    this.db
      .prepare(
        `UPDATE job SET name = ?, cron = ?, kind = ?, command = ?, prompt = ?, workdir = ?,
           timeout_seconds = ?, permission_mode = ?, delivery = ?, push_branch = ?, enabled = ?,
           updated_at = ?
         WHERE id = ?`
      )
      .run(
        v.name,
        v.cron,
        v.kind,
        v.command,
        v.prompt,
        v.workdir,
        v.timeoutSeconds,
        v.permissionMode,
        v.delivery,
        v.pushBranch,
        v.enabled ? 1 : 0,
        new Date().toISOString(),
        id
      )
    this.notify()
    return this.get(id) as Job
  }

  remove(id: number): void {
    const result = this.db.prepare('DELETE FROM job WHERE id = ?').run(id)
    if (result.changes === 0) throw new JobError(`ジョブ #${id} がありません`)
    this.notify()
  }

  markRun(id: number, at = new Date().toISOString()): void {
    this.db.prepare('UPDATE job SET last_run_at = ? WHERE id = ?').run(at, id)
    this.notify()
  }
}

export class ExecutionRepository {
  private listeners = new Set<() => void>()

  constructor(private db: DatabaseSync) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  start(jobId: number, status: ExecutionStatus = 'running'): Execution {
    const result = this.db
      .prepare('INSERT INTO execution (job_id, status, started_at) VALUES (?, ?, ?)')
      .run(jobId, status, new Date().toISOString())
    this.notify()
    return this.get(Number(result.lastInsertRowid)) as Execution
  }

  finish(
    id: number,
    outcome: { status: ExecutionStatus; exitCode: number | null; stdout: string; stderr: string; taskId?: number | null }
  ): void {
    this.db
      .prepare(
        `UPDATE execution SET status = ?, exit_code = ?, stdout = ?, stderr = ?, task_id = ?, finished_at = ?
         WHERE id = ?`
      )
      .run(
        outcome.status,
        outcome.exitCode,
        outcome.stdout,
        outcome.stderr,
        outcome.taskId ?? null,
        new Date().toISOString(),
        id
      )
    this.notify()
  }

  get(id: number): Execution | null {
    const row = this.db.prepare('SELECT * FROM execution WHERE id = ?').get(id) as unknown as
      | ExecutionRow
      | undefined
    return row ? toExecution(row) : null
  }

  /** Newest first; stdout/stderr included (the viewer shows one at a time). */
  list(options: { jobId?: number; limit?: number } = {}): Execution[] {
    const where = options.jobId === undefined ? '' : ' WHERE job_id = ?'
    const params: number[] = options.jobId === undefined ? [] : [options.jobId]
    const rows = this.db
      .prepare(`SELECT * FROM execution${where} ORDER BY id DESC LIMIT ?`)
      .all(...params, Math.max(1, Math.floor(options.limit ?? 100))) as unknown as ExecutionRow[]
    return rows.map(toExecution)
  }

  /** Executions left "running" by a previous process are failed. */
  failAllRunning(): number {
    const changes = Number(
      this.db
        .prepare(
          `UPDATE execution SET status = 'failed', stderr = stderr || ?, finished_at = ? WHERE status = 'running'`
        )
        .run('\n[sokking] アプリの再起動で中断されました\n', new Date().toISOString()).changes
    )
    if (changes > 0) this.notify()
    return changes
  }

  prune(options: { keepDays: number; keepPerJob: number }): number {
    const cutoff = new Date(Date.now() - options.keepDays * 86400_000).toISOString()
    let changes = Number(
      this.db.prepare(`DELETE FROM execution WHERE started_at < ? AND status != 'running'`).run(cutoff).changes
    )
    const jobs = this.db.prepare('SELECT DISTINCT job_id FROM execution').all() as unknown as { job_id: number }[]
    const stmt = this.db.prepare(
      `DELETE FROM execution WHERE job_id = ? AND status != 'running' AND id NOT IN (
         SELECT id FROM execution WHERE job_id = ? ORDER BY id DESC LIMIT ?
       )`
    )
    for (const { job_id } of jobs) {
      changes += Number(stmt.run(job_id, job_id, Math.max(0, Math.floor(options.keepPerJob))).changes)
    }
    if (changes > 0) this.notify()
    return changes
  }
}

function validate(input: JobInput): Required<Omit<JobInput, 'workdir' | 'pushBranch'>> & {
  workdir: string | null
  pushBranch: string | null
} {
  const name = input.name.trim()
  if (!name) throw new JobError('ジョブ名は必須です')
  const cron = input.cron.trim()
  if (!cron) throw new JobError('cron 式は必須です')
  validateCron(cron)
  if (!JOB_KINDS.includes(input.kind)) throw new JobError(`不明な kind: ${input.kind}`)
  const command = (input.command ?? '').trim()
  const prompt = (input.prompt ?? '').trim()
  const workdir = input.workdir?.trim() || null
  if (input.kind === 'shell' && !command) throw new JobError('コマンドは必須です')
  if (input.kind === 'claude' && !prompt) throw new JobError('プロンプトは必須です')
  if (input.kind === 'claude' && !workdir) throw new JobError('Claude ジョブには作業ディレクトリが必要です')
  const timeoutSeconds = Math.floor(input.timeoutSeconds ?? DEFAULT_JOB_TIMEOUT_SECONDS)
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0) throw new JobError('タイムアウトは 0 以上にしてください')
  const permissionMode = input.permissionMode ?? 'acceptEdits'
  if (!PERMISSION_MODES.includes(permissionMode)) throw new JobError(`不明な permission mode: ${permissionMode}`)
  const delivery = input.delivery ?? 'pr'
  if (!DELIVERIES.includes(delivery)) throw new JobError(`不明な delivery: ${delivery}`)
  const pushBranch = input.pushBranch?.trim() || null
  if (input.kind === 'claude' && delivery === 'push' && !pushBranch) {
    throw new JobError('直接 push には push 先のブランチが必要です')
  }
  return {
    name,
    cron,
    kind: input.kind,
    command,
    prompt,
    workdir,
    timeoutSeconds,
    permissionMode,
    delivery,
    pushBranch,
    enabled: input.enabled ?? true
  }
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    name: row.name,
    cron: row.cron,
    kind: row.kind as Job['kind'],
    command: row.command,
    prompt: row.prompt,
    workdir: row.workdir,
    timeoutSeconds: row.timeout_seconds,
    permissionMode: row.permission_mode as Job['permissionMode'],
    delivery: row.delivery as Job['delivery'],
    pushBranch: row.push_branch,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toExecution(row: ExecutionRow): Execution {
  return {
    id: row.id,
    jobId: row.job_id,
    status: row.status as ExecutionStatus,
    exitCode: row.exit_code,
    stdout: row.stdout,
    stderr: row.stderr,
    taskId: row.task_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  }
}
