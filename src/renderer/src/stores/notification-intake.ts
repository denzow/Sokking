import { create } from 'zustand'
import type { NotificationStatus } from '../../../shared/ipc'
import type {
  NotificationFilter,
  NotificationFilterInput,
  NotificationLogEntry
} from '../../../shared/notifications'

/**
 * Renderer mirror of the desktop-notification intake: the filter rules,
 * the received-notification log and the monitor's state. Main owns all of
 * it; the store re-fetches on its change events.
 */
interface IntakeState {
  filters: NotificationFilter[]
  log: NotificationLogEntry[]
  status: NotificationStatus | null
  loaded: boolean
  error: string | null
  /** Log entries received since the view was last looked at. */
  unseen: number
  refreshFilters: () => Promise<void>
  refreshLog: () => Promise<void>
  refreshStatus: () => Promise<void>
  addFilter: (input: NotificationFilterInput) => Promise<NotificationFilter | null>
  updateFilter: (id: number, input: NotificationFilterInput) => Promise<NotificationFilter | null>
  removeFilter: (id: number) => Promise<boolean>
  reorderFilters: (ids: number[]) => Promise<void>
  clearLog: () => Promise<void>
  setSetting: (key: string, value: string) => Promise<void>
  markSeen: () => void
  clearError: () => void
}

export const useIntakeStore = create<IntakeState>((set, get) => ({
  filters: [],
  log: [],
  status: null,
  loaded: false,
  error: null,
  unseen: 0,

  refreshFilters: async () => {
    set({ filters: await window.sokking.notifFilterList() })
  },

  refreshLog: async () => {
    const log = await window.sokking.notifLogList()
    set((s) => ({
      log,
      loaded: true,
      // Growth since the last fetch counts as unseen (ids only go up).
      unseen: s.loaded && log.length && s.log.length
        ? s.unseen + log.filter((e) => e.id > s.log[0].id).length
        : s.loaded && !s.log.length
          ? s.unseen + log.length
          : s.unseen
    }))
  },

  refreshStatus: async () => {
    set({ status: await window.sokking.notifStatus() })
  },

  addFilter: async (input) => {
    const r = await window.sokking.notifFilterAdd(input)
    if (!r.ok) {
      set({ error: r.error })
      return null
    }
    set({ error: null })
    await get().refreshFilters()
    return r.filter
  },

  updateFilter: async (id, input) => {
    const r = await window.sokking.notifFilterUpdate(id, input)
    if (!r.ok) {
      set({ error: r.error })
      return null
    }
    set({ error: null })
    await get().refreshFilters()
    return r.filter
  },

  removeFilter: async (id) => {
    const r = await window.sokking.notifFilterRemove(id)
    if (!r.ok) {
      set({ error: r.error })
      return false
    }
    await get().refreshFilters()
    return true
  },

  reorderFilters: async (ids) => {
    await window.sokking.notifFilterReorder(ids)
    await get().refreshFilters()
  },

  clearLog: async () => {
    await window.sokking.notifLogClear()
    await get().refreshLog()
  },

  setSetting: async (key, value) => {
    await window.sokking.settingSet(key, value)
    await get().refreshStatus()
  },

  markSeen: () => set({ unseen: 0 }),
  clearError: () => set({ error: null })
}))
