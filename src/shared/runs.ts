// Processing runs: one Claude Code session launched for a task in a tab.

/** `claude --permission-mode` values offered in the UI. */
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
export const PERMISSION_MODES: readonly PermissionMode[] = [
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions'
]

/** How the result leaves the working tree: a pull request, or a push to a branch. */
export type Delivery = 'pr' | 'push'
export const DELIVERIES: readonly Delivery[] = ['pr', 'push']

/** interactive = opened by a person from the task box; auto = a rule or job. */
export type RunMode = 'interactive' | 'auto'

/**
 * done: the session ended normally. failed: Claude Code reported an error
 * or the shell died. interrupted: the app restarted while the run was open.
 */
export type RunResult = 'done' | 'failed' | 'interrupted'

export interface Run {
  id: number
  taskId: number
  tabId: string
  mode: RunMode
  permissionMode: PermissionMode
  delivery: Delivery
  pushBranch: string | null
  workdir: string
  prompt: string
  /** Claude Code session id, learned from the SessionStart hook. */
  sessionId: string | null
  branch: string | null
  prUrl: string | null
  startedAt: string
  finishedAt: string | null
  result: RunResult | null
}

/** What a person (or a rule) chooses when launching a run. */
export interface RunOptions {
  workdir: string
  permissionMode: PermissionMode
  delivery: Delivery
  pushBranch: string | null
  prompt: string
  mode?: RunMode
}

/** Per-repository defaults for the launch dialog. */
export interface RepoDefaults {
  workdir: string
  defaultDelivery: Delivery
  defaultPushBranch: string | null
  defaultPermissionMode: PermissionMode
}
