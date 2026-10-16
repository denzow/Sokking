// Desktop-notification intake: what arrived, and the rules deciding what
// becomes a task.

/** A desktop notification as captured from the session bus. */
export interface DesktopNotification {
  /** Application name as the notification server saw it (e.g. "Slack"). */
  app: string
  /** The summary line. */
  title: string
  body: string
  /** ISO 8601. */
  receivedAt: string
}

export type FilterAction = 'accept' | 'ignore'
export const FILTER_ACTIONS: readonly FilterAction[] = ['accept', 'ignore']

/**
 * One rule. Patterns are regular expressions (case-insensitive); an empty
 * pattern matches anything. Rules are tried in `order`; the first enabled
 * one whose three patterns all match decides.
 */
export interface NotificationFilter {
  id: number
  name: string
  order: number
  enabled: boolean
  appPattern: string
  titlePattern: string
  bodyPattern: string
  action: FilterAction
  /** For accept: the task's default workdir. */
  workdir: string | null
  /** For accept: overrides the launch prompt template (null = the default). */
  promptTemplate: string | null
  createdAt: string
  updatedAt: string
}

export interface NotificationFilterInput {
  name: string
  enabled?: boolean
  appPattern?: string
  titlePattern?: string
  bodyPattern?: string
  action: FilterAction
  workdir?: string | null
  promptTemplate?: string | null
}

export type NotificationLogResult = 'accepted' | 'ignored'

export interface NotificationLogEntry extends DesktopNotification {
  id: number
  matchedFilterId: number | null
  result: NotificationLogResult
  /** The task created from it, when accepted. */
  taskId: number | null
}

/** Settings keys the notification intake reads. */
export const SETTING_NOTIFICATION_DEFAULT_ACTION = 'notification.defaultAction'
export const SETTING_NOTIFICATION_MONITOR_ENABLED = 'notification.monitorEnabled'
