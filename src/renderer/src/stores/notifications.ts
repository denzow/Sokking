import { create } from 'zustand'
import type { AppNotificationEvent } from '../../../shared/ipc'

export interface NotificationItem extends AppNotificationEvent {
  /** Renderer-local sequence id (the event itself has no identity). */
  id: number
}

interface NotificationsState {
  /** Newest first. In-memory only: the history is for the current app run. */
  items: NotificationItem[]
  /** Notifications received since the panel was last viewed. */
  unread: number
  add: (event: AppNotificationEvent) => void
  remove: (id: number) => void
  clear: () => void
  markSeen: () => void
}

/** Oldest entries are dropped past this point so the list can't grow unbounded. */
const MAX_ITEMS = 30

let idCounter = 0

export const useNotificationsStore = create<NotificationsState>((set) => ({
  items: [],
  unread: 0,

  add: (event) =>
    set((s) => ({
      items: [{ ...event, id: ++idCounter }, ...s.items].slice(0, MAX_ITEMS),
      unread: s.unread + 1
    })),

  remove: (id) => set((s) => ({ items: s.items.filter((item) => item.id !== id) })),

  clear: () => set({ items: [], unread: 0 }),

  markSeen: () => set({ unread: 0 })
}))
