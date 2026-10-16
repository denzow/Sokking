import type { DesktopNotification, FilterAction } from '../shared/notifications'
import { SETTING_NOTIFICATION_DEFAULT_ACTION } from '../shared/notifications'
import { decide, NotificationFilterRepository } from './notification-filters'
import type { NotificationLogRepository } from './notification-log'
import type { SettingsRepository } from './settings'
import type { TaskRepository } from './tasks'

/** When no rule matches: ignore, so the box doesn't fill with every mail and calendar ping. */
export const DEFAULT_ACTION: FilterAction = 'ignore'

/**
 * Turns captured desktop notifications into tasks: log every one, run the
 * filter rules, and add an accepted one to the task box.
 */
export class NotificationSource {
  constructor(
    private filters: NotificationFilterRepository,
    private log: NotificationLogRepository,
    private settings: SettingsRepository,
    private tasks: TaskRepository
  ) {}

  defaultAction(): FilterAction {
    const value = this.settings.get(SETTING_NOTIFICATION_DEFAULT_ACTION)
    return value === 'accept' ? 'accept' : DEFAULT_ACTION
  }

  handle(n: DesktopNotification): void {
    // A notification without any text can't be judged or worked on.
    if (!n.title.trim() && !n.body.trim()) return
    const { action, filter } = decide(this.filters.list(), n, this.defaultAction())
    let taskId: number | null = null
    if (action === 'accept') {
      const task = this.tasks.add({
        source: 'notification',
        title: n.title.trim() || n.body.trim().split('\n')[0].slice(0, 120),
        body: n.body,
        sourceApp: n.app || null,
        workdir: filter?.workdir ?? null
      })
      taskId = task.id
    }
    this.log.add(n, {
      result: action === 'accept' ? 'accepted' : 'ignored',
      matchedFilterId: filter?.id ?? null,
      taskId
    })
  }
}
