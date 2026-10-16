// Scheduled jobs: cron-driven shell commands, or Claude Code prompts that
// become tasks and are processed like a rule's auto tasks.

import type { Delivery, PermissionMode } from './runs'

export type JobKind = 'shell' | 'claude'
export const JOB_KINDS: readonly JobKind[] = ['shell', 'claude']

export interface Job {
  id: number
  name: string
  /** Five-field cron expression, local time. */
  cron: string
  kind: JobKind
  /** shell: the command line (run through the shell). */
  command: string
  /** claude: the prompt handed to Claude Code. */
  prompt: string
  /** shell: cwd; claude: where the processing tab opens (required). */
  workdir: string | null
  /** shell only; 0 = no limit. */
  timeoutSeconds: number
  permissionMode: PermissionMode
  delivery: Delivery
  pushBranch: string | null
  enabled: boolean
  lastRunAt: string | null
  createdAt: string
  updatedAt: string
}

export interface JobInput {
  name: string
  cron: string
  kind: JobKind
  command?: string
  prompt?: string
  workdir?: string | null
  timeoutSeconds?: number
  permissionMode?: PermissionMode
  delivery?: Delivery
  pushBranch?: string | null
  enabled?: boolean
}

/**
 * running / success / failed / timeout for shell jobs. A claude job's
 * execution is `queued` once its task is in the box; the task and its run
 * carry the real outcome.
 */
export type ExecutionStatus = 'running' | 'success' | 'failed' | 'timeout' | 'queued'

export interface Execution {
  id: number
  jobId: number
  status: ExecutionStatus
  exitCode: number | null
  stdout: string
  stderr: string
  /** claude jobs: the task that was created. */
  taskId: number | null
  startedAt: string
  finishedAt: string | null
}

/** A job as the jobs view shows it: with the scheduler's live state. */
export interface JobSummary extends Job {
  nextRunAt: string | null
  running: boolean
}

export const DEFAULT_JOB_TIMEOUT_SECONDS = 3600
/** Output kept per stream per execution; the rest is dropped with a marker. */
export const EXECUTION_OUTPUT_MAX = 200_000
