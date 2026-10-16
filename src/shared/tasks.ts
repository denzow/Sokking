// Task-box domain types shared by core / main / preload / renderer.

/** Where a task came from. */
export type TaskSource = 'notification' | 'github' | 'manual' | 'schedule'

/**
 * Lifecycle of a task:
 * inbox → running (a processing tab is open) → review (Claude Code stopped,
 * a human checks the result) → done, or archived from anywhere.
 */
export type TaskStatus = 'inbox' | 'running' | 'review' | 'done' | 'archived'

export const TASK_SOURCES: readonly TaskSource[] = ['notification', 'github', 'manual', 'schedule']
export const TASK_STATUSES: readonly TaskStatus[] = ['inbox', 'running', 'review', 'done', 'archived']

export interface Task {
  id: number
  source: TaskSource
  title: string
  body: string
  /** Name of the application that raised the notification; null otherwise. */
  sourceApp: string | null
  /** Link back to the origin (issue URL, message permalink); null when unknown. */
  sourceRef: string | null
  status: TaskStatus
  /** Directory the task is (to be) processed in; null until chosen. */
  workdir: string | null
  /** The GitHub rule that imported it; null otherwise. */
  ruleId: number | null
  /** Waiting for the dispatcher to open its processing tab (a rule with auto). */
  autoPending: boolean
  /** ISO 8601 timestamps. */
  createdAt: string
  updatedAt: string
}

export interface NewTask {
  source?: TaskSource
  title: string
  body?: string
  sourceApp?: string | null
  sourceRef?: string | null
  workdir?: string | null
  ruleId?: number | null
  autoPending?: boolean
}

export interface TaskPatch {
  title?: string
  body?: string
  status?: TaskStatus
  workdir?: string | null
  autoPending?: boolean
}

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[]
  /** Newest first by default; the limit caps the result. */
  limit?: number
}
