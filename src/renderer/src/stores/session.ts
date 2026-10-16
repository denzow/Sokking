// Persists the open tabs' directories across app restarts so the workspace
// can be restored on next launch. Stored in localStorage, which is flushed to
// disk under the app's userData dir.

export interface SavedTab {
  cwd: string
  title: string | null
  /** Task the tab was processing, so the link survives a restart. */
  taskId?: number | null
}

export interface SavedSession {
  tabs: SavedTab[]
  activeIndex: number
}

const STORAGE_KEY = 'sokking.session'

export function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SavedSession
    if (!Array.isArray(parsed.tabs)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveSession(session: SavedSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    // storage unavailable — nothing to restore next time, which is acceptable
  }
}
