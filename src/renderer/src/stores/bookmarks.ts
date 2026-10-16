import { create } from 'zustand'

// Bookmarked directories: the user saves a tab's cwd and can later spawn a
// new session tab starting in that directory. Persisted to localStorage.

export interface Bookmark {
  path: string
}

const STORAGE_KEY = 'sokking.bookmarks'

/** Bookmarks are always stored as full paths: a leading ~ is expanded here
    (both when adding and when migrating previously stored entries). */
export function expandHome(path: string): string {
  const home = window.sokking.homeDir
  if (!home) return path
  if (path === '~') return home
  if (path.startsWith('~/')) return home + path.slice(1)
  return path
}

/** The ~-abbreviated form used for display and search matching. */
export function collapseHome(path: string): string {
  const home = window.sokking.homeDir
  if (!home) return path
  if (path === home) return '~'
  if (path.startsWith(home + '/')) return '~' + path.slice(home.length)
  return path
}

function load(): Bookmark[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const paths = parsed
      .filter(
        (b): b is Bookmark =>
          typeof b === 'object' && b !== null && typeof (b as Bookmark).path === 'string'
      )
      .map((b) => expandHome(b.path))
    const bookmarks = [...new Set(paths)].map((path) => ({ path }))
    // Rewrite storage right away when migration changed anything (~ expansion
    // or the dedup it caused), so stored data is always full paths.
    if (JSON.stringify(bookmarks) !== raw) persist(bookmarks)
    return bookmarks
  } catch {
    return []
  }
}

function persist(bookmarks: Bookmark[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks))
  } catch {
    // storage unavailable — keep in-memory values
  }
}

export function bookmarkLabel(bookmark: Bookmark): string {
  return bookmark.path.split('/').filter(Boolean).pop() ?? '/'
}

interface BookmarksState {
  bookmarks: Bookmark[]
  isBookmarked: (path: string) => boolean
  addBookmark: (path: string) => void
  removeBookmark: (path: string) => void
  toggleBookmark: (path: string) => void
}

export const useBookmarksStore = create<BookmarksState>((set, get) => ({
  bookmarks: load(),

  isBookmarked: (path) => get().bookmarks.some((b) => b.path === expandHome(path)),

  addBookmark: (path) => {
    const full = expandHome(path)
    if (!full || get().isBookmarked(full)) return
    set((s) => {
      const bookmarks = [...s.bookmarks, { path: full }].sort((a, b) =>
        a.path.localeCompare(b.path)
      )
      persist(bookmarks)
      return { bookmarks }
    })
  },

  removeBookmark: (path) => {
    const full = expandHome(path)
    set((s) => {
      const bookmarks = s.bookmarks.filter((b) => b.path !== full)
      persist(bookmarks)
      return { bookmarks }
    })
  },

  toggleBookmark: (path) => {
    if (get().isBookmarked(path)) get().removeBookmark(path)
    else get().addBookmark(path)
  }
}))
