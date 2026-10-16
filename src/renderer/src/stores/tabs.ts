import { create } from 'zustand'
import { TabActivityState } from '../../../shared/ipc'
import { useDiffCommentsStore } from './diff-comments'

export interface Tab {
  id: string
  /** User-assigned name; falls back to the cwd basename when null. */
  title: string | null
  cwd: string
  /**
   * Claude Code session status shown as the tab's icon. Persistent: it tracks
   * hook events only (null = no session) and is never cleared by focusing or
   * typing into the tab.
   */
  activity: TabActivityState | null
  activityMessage: string
  /** Foreground command running in the tab (from main's poll); null = idle. */
  runningProcess: string | null
  /**
   * The session entered a waiting-on-the-user state (permission / idle) while
   * the tab wasn't being looked at (inactive tab or unfocused window). The
   * sidebar highlights the whole row until the tab is viewed again.
   */
  attention: boolean
}

interface TabsState {
  tabs: Tab[]
  activeTabId: string | null
  /** cwd omitted → the new tab inherits the active tab's directory. */
  addTab: (cwd?: string) => void
  restoreTabs: (saved: { cwd: string; title: string | null }[], activeIndex: number) => void
  removeTab: (tabId: string) => void
  activateTab: (tabId: string) => void
  activateRelative: (offset: number) => void
  /** Move the active tab up/down in the sidebar; no-op at the edges. */
  moveTab: (offset: number) => void
  renameTab: (tabId: string, title: string | null) => void
  setCwd: (tabId: string, cwd: string) => void
  setRunningProcess: (tabId: string, process: string | null) => void
  setActivity: (tabId: string, activity: TabActivityState | null, message: string) => void
  /** Mark a waiting tab as seen (drops the sidebar highlight, keeps the lamp). */
  clearAttention: (tabId: string) => void
}

let tabCounter = 0

export function tabLabel(tab: Tab): string {
  if (tab.title) return tab.title
  if (tab.cwd) return tab.cwd.split('/').filter(Boolean).pop() ?? '/'
  return 'terminal'
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  addTab: (cwd) => {
    const id = `tab-${Date.now().toString(36)}-${++tabCounter}`
    set((s) => {
      const activeIndex = s.tabs.findIndex((t) => t.id === s.activeTabId)
      // New tabs inherit the cwd of the tab they're spawned from, unless an
      // explicit directory (e.g. a bookmark) is given.
      const startCwd = cwd ?? (activeIndex === -1 ? '' : s.tabs[activeIndex].cwd)
      const tab: Tab = {
        id,
        title: null,
        cwd: startCwd,
        activity: null,
        activityMessage: '',
        runningProcess: null,
        attention: false
      }
      const tabs = [...s.tabs]
      // Insert right after the active tab (or at the end if there is none).
      tabs.splice(activeIndex === -1 ? tabs.length : activeIndex + 1, 0, tab)
      return { tabs, activeTabId: id }
    })
  },

  restoreTabs: (saved, activeIndex) => {
    const tabs: Tab[] = saved.map((st) => ({
      id: `tab-${Date.now().toString(36)}-${++tabCounter}`,
      title: st.title,
      cwd: st.cwd,
      activity: null,
      activityMessage: '',
      runningProcess: null,
      attention: false
    }))
    const active = tabs[activeIndex] ?? tabs[0] ?? null
    set({ tabs, activeTabId: active?.id ?? null })
  },

  removeTab: (tabId) => {
    set((s) => {
      const index = s.tabs.findIndex((t) => t.id === tabId)
      const tabs = s.tabs.filter((t) => t.id !== tabId)
      let activeTabId = s.activeTabId
      if (activeTabId === tabId) {
        const neighbor = tabs[Math.min(index, tabs.length - 1)]
        activeTabId = neighbor?.id ?? null
      }
      return { tabs, activeTabId }
    })
    // Drop any pending diff comments for the gone tab so byTab doesn't leak.
    useDiffCommentsStore.getState().clear(tabId)
    if (get().tabs.length === 0) get().addTab()
  },

  activateTab: (tabId) => {
    set((s) =>
      s.tabs.some((t) => t.id === tabId)
        ? {
            activeTabId: tabId,
            // Viewing the tab acknowledges its waiting state.
            tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, attention: false } : t))
          }
        : s
    )
  },

  activateRelative: (offset) => {
    const { tabs, activeTabId, activateTab } = get()
    if (tabs.length === 0) return
    const index = tabs.findIndex((t) => t.id === activeTabId)
    const next = tabs[(index + offset + tabs.length) % tabs.length]
    activateTab(next.id)
  },

  moveTab: (offset) => {
    set((s) => {
      const index = s.tabs.findIndex((t) => t.id === s.activeTabId)
      const target = index + offset
      if (index === -1 || target < 0 || target >= s.tabs.length) return s
      const tabs = [...s.tabs]
      const [tab] = tabs.splice(index, 1)
      tabs.splice(target, 0, tab)
      return { tabs }
    })
  },

  renameTab: (tabId, title) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, title } : t))
    }))
  },

  setCwd: (tabId, cwd) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, cwd } : t))
    }))
  },

  setRunningProcess: (tabId, process) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, runningProcess: process } : t))
    }))
  },

  setActivity: (tabId, activity, message) => {
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId)
      // PreToolUse fires per tool call — skip the no-op updates.
      if (!tab || (tab.activity === activity && tab.activityMessage === message)) return s
      // A waiting state that begins while the tab isn't being looked at
      // (inactive tab, or the whole window unfocused) demands attention until
      // the user views the tab; running / ended sessions never do.
      const waiting = activity === 'permission' || activity === 'idle'
      const unseen = tabId !== s.activeTabId || !document.hasFocus()
      return {
        tabs: s.tabs.map((t) =>
          t.id === tabId
            ? { ...t, activity, activityMessage: message, attention: waiting && unseen }
            : t
        )
      }
    })
  },

  clearAttention: (tabId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId && t.attention ? { ...t, attention: false } : t))
    }))
  }
}))
