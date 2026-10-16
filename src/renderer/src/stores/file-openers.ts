import { create } from 'zustand'
import type { FsOpenResult } from '../../../shared/ipc'

// Per-pattern file openers: the files panel opens a matching file with the
// configured application instead of the OS default. A pattern is either an
// extension ("png", "tar.gz") or — when it contains "/" — a MIME pattern
// ("image/png", "text/*"). Extension matches win over MIME matches; files
// matching nothing keep the OS behavior (shell.openPath). Persisted to
// localStorage.

export interface FileOpener {
  /**
   * Normalized: lowercase. An extension without leading dot (may be
   * compound, "tar.gz"), or a MIME pattern when it contains "/".
   */
  pattern: string
  /** Application display name, kept for the settings UI. */
  appName: string
  /** Absolute path to the application's .desktop file ('' while unset). */
  desktopFile: string
}

const STORAGE_KEY = 'sokking.fileOpeners'

export function isMimePattern(pattern: string): boolean {
  return pattern.includes('/')
}

/** "*.PNG" / ".png" / "png" all become "png"; MIME patterns just lowercase. */
export function normalizePattern(raw: string): string {
  const p = raw.trim().toLowerCase()
  return isMimePattern(p) ? p : p.replace(/^[*.]+/, '')
}

/**
 * The configured extension opener for a file, or null. Compound extensions
 * win over their tails ("tar.gz" over "gz") via longest match.
 */
export function extOpenerFor(fileName: string, openers: FileOpener[]): FileOpener | null {
  const name = fileName.toLowerCase()
  let best: FileOpener | null = null
  for (const o of openers) {
    if (!o.pattern || !o.desktopFile || isMimePattern(o.pattern)) continue
    if (!name.endsWith(`.${o.pattern}`)) continue
    if (!best || o.pattern.length > best.pattern.length) best = o
  }
  return best
}

/**
 * The configured MIME opener for a file, or null. `mimes` is the file's type
 * chain, most specific first; per chain entry an exact pattern beats a
 * "type/*" wildcard.
 */
export function mimeOpenerFor(mimes: string[], openers: FileOpener[]): FileOpener | null {
  const usable = openers.filter((o) => o.desktopFile && isMimePattern(o.pattern))
  for (const mime of mimes) {
    const exact = usable.find((o) => o.pattern === mime)
    if (exact) return exact
    const wildcard = usable.find(
      (o) => o.pattern.endsWith('/*') && mime.startsWith(o.pattern.slice(0, -1))
    )
    if (wildcard) return wildcard
  }
  return null
}

/**
 * The opener for a file path: extension match first, then MIME match (which
 * asks main to run xdg-mime, hence async), or null for the OS default.
 */
export async function resolveOpener(path: string, openers: FileOpener[]): Promise<FileOpener | null> {
  const fileName = path.slice(path.lastIndexOf('/') + 1)
  const byExt = extOpenerFor(fileName, openers)
  if (byExt) return byExt
  if (!openers.some((o) => o.desktopFile && isMimePattern(o.pattern))) return null
  const mimes = await window.sokking.fsMime(path)
  return mimeOpenerFor(mimes, openers)
}

/**
 * Open a file honoring the configured openers: the matching app when a
 * pattern has one, the OS default otherwise.
 */
export async function openFile(path: string): Promise<FsOpenResult> {
  const opener = await resolveOpener(path, useFileOpenersStore.getState().openers)
  return opener
    ? window.sokking.fsOpenWith(opener.desktopFile, path)
    : window.sokking.fsOpen(path)
}

function load(): FileOpener[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item): FileOpener[] => {
      if (typeof item !== 'object' || item === null) return []
      const o = item as Partial<FileOpener> & { ext?: unknown }
      // Entries saved before MIME support used `ext` as the field name.
      const pattern =
        typeof o.pattern === 'string' ? o.pattern : typeof o.ext === 'string' ? o.ext : null
      if (pattern === null || typeof o.appName !== 'string' || typeof o.desktopFile !== 'string') {
        return []
      }
      return [{ pattern, appName: o.appName, desktopFile: o.desktopFile }]
    })
  } catch {
    return []
  }
}

function persist(openers: FileOpener[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(openers))
  } catch {
    // storage unavailable — keep in-memory values
  }
}

interface FileOpenersState {
  openers: FileOpener[]
  addOpener: () => void
  updateOpener: (index: number, patch: Partial<FileOpener>) => void
  removeOpener: (index: number) => void
}

export const useFileOpenersStore = create<FileOpenersState>((set) => ({
  openers: load(),

  addOpener: () => {
    set((s) => {
      const openers = [...s.openers, { pattern: '', appName: '', desktopFile: '' }]
      persist(openers)
      return { openers }
    })
  },

  updateOpener: (index, patch) => {
    set((s) => {
      const openers = s.openers.map((o, i) =>
        i === index
          ? {
              ...o,
              ...patch,
              ...(patch.pattern !== undefined ? { pattern: normalizePattern(patch.pattern) } : {})
            }
          : o
      )
      persist(openers)
      return { openers }
    })
  },

  removeOpener: (index) => {
    set((s) => {
      const openers = s.openers.filter((_, i) => i !== index)
      persist(openers)
      return { openers }
    })
  }
}))
