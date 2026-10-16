// GitHub rules: periodic issue searches that feed the task box.

import type { Delivery, PermissionMode, RunOptions } from './runs'

export interface Rule {
  id: number
  name: string
  /** Local checkout; `gh` resolves the repository from its remote. */
  workdir: string
  /** Passed to `gh issue list --search` (GitHub search syntax, e.g. `label:agent-ready`). */
  query: string
  intervalSeconds: number
  /** Start processing as soon as the issue is picked up (else wait in the inbox). */
  auto: boolean
  permissionMode: PermissionMode
  delivery: Delivery
  pushBranch: string | null
  /** Overrides the launch prompt; null = the built-in template. */
  promptTemplate: string | null
  enabled: boolean
  lastCheckedAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface RuleInput {
  name: string
  workdir: string
  query: string
  intervalSeconds?: number
  auto?: boolean
  permissionMode?: PermissionMode
  delivery?: Delivery
  pushBranch?: string | null
  promptTemplate?: string | null
  enabled?: boolean
}

/** An issue as `gh issue list --json` reports it. */
export interface GitHubIssue {
  number: number
  title: string
  body: string
  url: string
  labels: string[]
}

export const MIN_RULE_INTERVAL_SECONDS = 30
export const DEFAULT_RULE_INTERVAL_SECONDS = 300

/** main → renderer: open a tab for the task and launch the run with these options. */
export interface AutoRunRequest {
  taskId: number
  title: string
  options: RunOptions
}

/** Settings key: how many runs may be open at once before auto-processing waits. */
export const SETTING_MAX_PARALLEL_RUNS = 'run.maxParallel'
export const DEFAULT_MAX_PARALLEL_RUNS = 2
