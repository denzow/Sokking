import { create } from 'zustand'
import type { FsOpenResult } from '../../../shared/ipc'

// Files open in the in-app editor, shown inside the workspace panel: the
// panel renders a file-tab strip from `files` and the Monaco editor for the
// per-session-tab `active` file. Files belong to the session tab they were
// opened from (keyed tabId + path): switching session tabs switches the
// visible editor tabs, and closing a session tab drops its files. The store
// only tracks which files are open, which is active, and their dirty flags;
// the text itself lives in Monaco models owned by EditorPanel (they must
// survive the panel unmounting, so they sit in a module-level registry there).

export interface EditorFile {
  /** Session tab the file was opened from. */
  tabId: string
  /** Absolute path — with tabId, the identity of the editor tab. */
  path: string
  /** Basename, shown on the tab. */
  name: string
  /** Unsaved changes exist. */
  dirty: boolean
}

/** Registry key for a (session tab, file) pair — paths can't contain \n. */
export function docKey(tabId: string, path: string): string {
  return `${tabId}\n${path}`
}

/**
 * Content handed over by whoever opened the file (the files panel reads it
 * to sniff text-vs-binary anyway). EditorPanel consumes it when creating the
 * Monaco model, so the file isn't read twice.
 */
export interface SeedDoc {
  content: string
  mtime: number
}

const seeds = new Map<string, SeedDoc>()

/** One-shot: returns and removes the seeded content for a file. */
export function takeSeed(tabId: string, path: string): SeedDoc | null {
  const key = docKey(tabId, path)
  const seed = seeds.get(key) ?? null
  seeds.delete(key)
  return seed
}

interface EditorState {
  files: EditorFile[]
  /** Per session tab, which open file the workspace editor shows. */
  active: Record<string, string | null>
  /** Register a file as open in a session tab; content/mtime seed the model.
      Also makes it the tab's active file (re-opening just activates). */
  open: (tabId: string, path: string, content: string, mtime: number) => void
  setActive: (tabId: string, path: string) => void
  close: (tabId: string, path: string) => void
  /** Drop every file of a closing session tab. */
  closeForTab: (tabId: string) => void
  setDirty: (tabId: string, path: string, dirty: boolean) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  files: [],
  active: {},

  open: (tabId, path, content, mtime) => {
    set((s) => {
      const active = { ...s.active, [tabId]: path }
      // Already open in this session tab: the live model (possibly dirty)
      // wins — the fresh read is dropped, not merged; the file just activates.
      if (s.files.some((f) => f.tabId === tabId && f.path === path)) return { active }
      seeds.set(docKey(tabId, path), { content, mtime })
      const name = path.slice(path.lastIndexOf('/') + 1)
      return { files: [...s.files, { tabId, path, name, dirty: false }], active }
    })
  },

  setActive: (tabId, path) => {
    set((s) => ({ active: { ...s.active, [tabId]: path } }))
  },

  close: (tabId, path) => {
    seeds.delete(docKey(tabId, path))
    set((s) => {
      const tabFiles = s.files.filter((f) => f.tabId === tabId)
      const index = tabFiles.findIndex((f) => f.path === path)
      const files = s.files.filter((f) => !(f.tabId === tabId && f.path === path))
      // Closing the shown file lands on its right neighbor (or the last
      // remaining file); closing a background tab leaves the view alone.
      let active = s.active
      if (s.active[tabId] === path) {
        const remaining = files.filter((f) => f.tabId === tabId)
        const next = remaining[Math.min(index, remaining.length - 1)]
        active = { ...s.active, [tabId]: next ? next.path : null }
      }
      return { files, active }
    })
  },

  closeForTab: (tabId) => {
    for (const key of seeds.keys()) {
      if (key.startsWith(`${tabId}\n`)) seeds.delete(key)
    }
    set((s) => {
      const active = { ...s.active }
      delete active[tabId]
      return { files: s.files.filter((f) => f.tabId !== tabId), active }
    })
  },

  setDirty: (tabId, path, dirty) => {
    set((s) => ({
      files: s.files.map((f) =>
        f.tabId === tabId && f.path === path && f.dirty !== dirty ? { ...f, dirty } : f
      )
    }))
  }
}))

/**
 * Open a path in the in-app editor: already-open files just activate, new
 * ones are read from disk (the read doubles as the text sniff), and binaries
 * or too-big files fall back to an external app (`opened: 'external'`) —
 * `openExternal` when given (the files panel passes its opener-aware open),
 * the OS default otherwise.
 */
export async function openFileInEditor(
  tabId: string,
  path: string,
  openExternal: (path: string) => Promise<FsOpenResult> = (p) => window.sokking.fsOpen(p)
): Promise<{ ok: true; opened: 'editor' | 'external' } | { ok: false; error: string }> {
  const s = useEditorStore.getState()
  if (s.files.some((f) => f.tabId === tabId && f.path === path)) {
    s.setActive(tabId, path)
    return { ok: true, opened: 'editor' }
  }
  const read = await window.sokking.fsReadText(path)
  if (read.ok) {
    useEditorStore.getState().open(tabId, path, read.content, read.mtime)
    return { ok: true, opened: 'editor' }
  }
  if (!read.binary) return { ok: false, error: read.error }
  const result = await openExternal(path)
  return result.ok ? { ok: true, opened: 'external' } : { ok: false, error: result.error }
}
