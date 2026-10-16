import { create } from 'zustand'

// Pending (written-but-not-yet-sent) diff comments, keyed by tab id. Lives in a
// store rather than in DiffViewer's local state so the comments survive the
// DiffViewer being unmounted — which happens whenever the user switches the
// view panel (diff → terminal/git/…) or the active tab. In-memory only: these
// are transient review notes, not worth persisting across an app restart.

/**
 * The quoted lines and range label are snapshotted at add time, so the comment
 * stays intact (and sendable) even if the diff is refreshed and the hunk it
 * anchored to moves or disappears.
 */
export interface PendingComment {
  id: number
  filePath: string
  hunkIndex: number
  anchor: number // line index the comment renders under (= selection end)
  header: string // "ファイル: path (n〜m行目)"
  quoted: string
  comment: string
}

let commentIdCounter = 0
export function nextCommentId(): number {
  return ++commentIdCounter
}

interface DiffCommentsState {
  byTab: Record<string, PendingComment[]>
  add: (tabId: string, comment: PendingComment) => void
  remove: (tabId: string, id: number) => void
  clear: (tabId: string) => void
}

export const useDiffCommentsStore = create<DiffCommentsState>((set) => ({
  byTab: {},

  add: (tabId, comment) =>
    set((s) => ({
      byTab: { ...s.byTab, [tabId]: [...(s.byTab[tabId] ?? []), comment] }
    })),

  remove: (tabId, id) =>
    set((s) => ({
      byTab: { ...s.byTab, [tabId]: (s.byTab[tabId] ?? []).filter((p) => p.id !== id) }
    })),

  clear: (tabId) =>
    set((s) => {
      if (!(tabId in s.byTab)) return s
      const byTab = { ...s.byTab }
      delete byTab[tabId]
      return { byTab }
    })
}))
