import { spawn } from 'node:child_process'
import { Cron } from 'croner'
import { EXECUTION_OUTPUT_MAX, Job } from '../shared/jobs'
import type { Execution } from '../shared/jobs'
import type { ExecutionRepository, JobRepository } from './jobs'
import type { TaskRepository } from './tasks'

/** Runs a shell job; swapped out in tests. */
export type ShellRunner = (
  job: Job,
  onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void
) => Promise<{ status: 'success' | 'failed' | 'timeout'; exitCode: number | null; stdout: string; stderr: string }>

/**
 * Keeps one croner timer per enabled job and runs them: a shell job as a
 * subprocess whose output lands in the execution record, a claude job as a
 * task in the box flagged for the auto dispatcher (which opens the tab).
 */
export class Scheduler {
  private timers = new Map<number, Cron>()
  private running = new Set<number>()

  constructor(
    private jobs: JobRepository,
    private executions: ExecutionRepository,
    private tasks: TaskRepository,
    private runShell: ShellRunner = defaultShellRunner,
    private log: (message: string) => void = () => {}
  ) {}

  /** (Re)creates the timers from the current job list. Call after any job change. */
  sync(): void {
    const wanted = new Map(this.jobs.list().filter((j) => j.enabled).map((j) => [j.id, j]))
    for (const [id, cron] of this.timers) {
      const job = wanted.get(id)
      if (!job || cron.getPattern() !== job.cron) {
        cron.stop()
        this.timers.delete(id)
      }
    }
    for (const [id, job] of wanted) {
      if (this.timers.has(id)) continue
      try {
        this.timers.set(
          id,
          new Cron(job.cron, { protect: true }, () => void this.runJob(id))
        )
      } catch (e) {
        this.log(`ジョブ「${job.name}」のタイマーを作れません: ${e instanceof Error ? e.message : e}`)
      }
    }
  }

  stop(): void {
    for (const cron of this.timers.values()) cron.stop()
    this.timers.clear()
  }

  nextRun(jobId: number): Date | null {
    return this.timers.get(jobId)?.nextRun() ?? null
  }

  isRunning(jobId: number): boolean {
    return this.running.has(jobId)
  }

  /** Runs the job now (manual trigger or timer). A job never overlaps itself. */
  async runJob(jobId: number): Promise<Execution | null> {
    const job = this.jobs.get(jobId)
    if (!job) return null
    if (this.running.has(jobId)) {
      this.log(`ジョブ「${job.name}」は実行中のため今回は見送ります`)
      return null
    }
    this.running.add(jobId)
    try {
      this.jobs.markRun(jobId)
      return job.kind === 'shell' ? await this.runShellJob(job) : this.runClaudeJob(job)
    } finally {
      this.running.delete(jobId)
    }
  }

  private async runShellJob(job: Job): Promise<Execution> {
    const execution = this.executions.start(job.id)
    try {
      const result = await this.runShell(job)
      this.executions.finish(execution.id, result)
    } catch (e) {
      this.executions.finish(execution.id, {
        status: 'failed',
        exitCode: null,
        stdout: '',
        stderr: e instanceof Error ? e.message : String(e)
      })
    }
    return this.executions.get(execution.id) as Execution
  }

  private runClaudeJob(job: Job): Execution {
    const execution = this.executions.start(job.id, 'queued')
    const task = this.tasks.add({
      source: 'schedule',
      title: job.name,
      body: job.prompt,
      workdir: job.workdir,
      jobId: job.id,
      autoPending: true
    })
    this.executions.finish(execution.id, {
      status: 'queued',
      exitCode: null,
      stdout: `task #${task.id} をタスクボックスに積みました\n`,
      stderr: '',
      taskId: task.id
    })
    return this.executions.get(execution.id) as Execution
  }
}

/** Runs the command through the user's shell with the job's cwd and timeout. */
export const defaultShellRunner: ShellRunner = (job) =>
  new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/bash'
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const env: Record<string, string | undefined> = { ...process.env, SOKKING_JOB_ID: String(job.id), SOKKING_JOB_NAME: job.name }
    delete env.NODE_ENV
    delete env.NODE_ENV_ELECTRON_VITE
    let proc
    try {
      proc = spawn(shell, ['-lc', job.command], { cwd: job.workdir || process.env.HOME, env, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      resolve({ status: 'failed', exitCode: null, stdout: '', stderr: e instanceof Error ? e.message : String(e) })
      return
    }
    const append = (current: string, chunk: string): string => {
      if (current.length >= EXECUTION_OUTPUT_MAX) return current
      const next = current + chunk
      return next.length > EXECUTION_OUTPUT_MAX ? next.slice(0, EXECUTION_OUTPUT_MAX) + '\n[sokking] 出力が長いため以降を省略\n' : next
    }
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', (c: string) => (stdout = append(stdout, c)))
    proc.stderr.on('data', (c: string) => (stderr = append(stderr, c)))
    const timer =
      job.timeoutSeconds > 0
        ? setTimeout(() => {
            timedOut = true
            proc.kill('SIGTERM')
            setTimeout(() => proc.kill('SIGKILL'), 5000).unref()
          }, job.timeoutSeconds * 1000)
        : null
    proc.on('error', (err) => {
      if (timer) clearTimeout(timer)
      resolve({ status: 'failed', exitCode: null, stdout, stderr: stderr + err.message })
    })
    proc.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (timedOut) resolve({ status: 'timeout', exitCode: code, stdout, stderr: stderr + `\n[sokking] ${job.timeoutSeconds} 秒でタイムアウト\n` })
      else resolve({ status: code === 0 ? 'success' : 'failed', exitCode: code, stdout, stderr })
    })
  })
