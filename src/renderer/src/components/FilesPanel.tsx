import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { FsEntry, FsNameMatch } from '../../../shared/ipc'
import { fileIconUrl } from '../file-icons'
import { openFile, resolveOpener, useFileOpenersStore } from '../stores/file-openers'
import { openFileInEditor, useEditorStore } from '../stores/editor'
import { Tab } from '../stores/tabs'
import { highlight } from './WorkspaceSearch'

interface FilesPanelProps {
  tab: Tab
  /** Called after a file lands in the editor store (already activated) —
      the workspace hands keyboard focus to the editor. */
  onOpenEditor: (path: string) => void
}

/**
 * Expansion / focus state lifted to the panel so the keyboard handler can
 * drive the whole tree; rows read it via context. Paths are absolute.
 */
interface TreeControl {
  expanded: Set<string>
  toggleDir: (path: string) => void
  focused: string | null
  setFocused: (path: string) => void
  /** Open a file: in-app editor first, external app for what it can't take. */
  openFileSmart: (path: string) => void
}

const TreeContext = createContext<TreeControl>({
  expanded: new Set(),
  toggleDir: () => {},
  focused: null,
  setFocused: () => {},
  openFileSmart: () => {}
})

/**
 * Tree state survives the panel unmounting (opening an editor tab, switching
 * session tabs or panels) — keyed by tab id, restored while the tab is still
 * in the same directory. In-memory only; dropped when the session tab closes.
 */
interface SavedTreeState {
  cwd: string
  expanded: Set<string>
  focused: string | null
  filter: string
}
const savedTreeStates = new Map<string, SavedTreeState>()

export function forgetTreeState(tabId: string): void {
  savedTreeStates.delete(tabId)
}

// The wsFocusTree shortcut focuses the mounted tree from outside — the
// mounted panel (at most one) registers its focusTree here.
let treeFocuser: (() => void) | null = null
export function focusFilesTree(): boolean {
  if (!treeFocuser) return false
  treeFocuser()
  return true
}

// ↓ on the ファイル side tab lands on the filter box (the next stop in the
// vertical walk: side tabs → filter → tree).
let filterFocuser: (() => void) | null = null
export function focusFilesFilter(): boolean {
  if (!filterFocuser) return false
  filterFocuser()
  return true
}

/**
 * File tree rooted at the tab's current directory. Follows the shell's cwd
 * automatically (tab.cwd is kept current by cwd-tracker). Clicking a
 * directory expands its children inline; files open in the in-app editor on
 * a single click / Enter. Keyboard: ↑/↓ move, →/← expand/collapse (← on a leaf
 * jumps to the parent), Enter opens, any printable key starts the name
 * filter — a recursive search (subdirectories included) shown as a flat
 * result list (Esc clears it). The tree also mirrors the editor: the file
 * showing there is revealed and carries the keyboard cursor.
 */
export function FilesPanel({ tab, onOpenEditor }: FilesPanelProps): React.JSX.Element {
  const [error, setError] = useState('')
  // Bumping this refetches every mounted level while keeping expansion state.
  const [refreshKey, setRefreshKey] = useState(0)
  // A previous mount's state for this tab is only valid in the same directory.
  const [restored] = useState(() => {
    const saved = savedTreeStates.get(tab.id)
    return saved && saved.cwd === tab.cwd ? saved : null
  })
  const [expanded, setExpanded] = useState<Set<string>>(() => restored?.expanded ?? new Set())
  const [focused, setFocused] = useState<string | null>(restored?.focused ?? null)
  const [filter, setFilter] = useState(restored?.filter ?? '')
  // Recursive filter results (files + dirs anywhere under the cwd, matched
  // by name); null while none have arrived for the current query.
  const [matches, setMatches] = useState<{ entries: FsNameMatch[]; truncated: boolean } | null>(
    null
  )
  const areaRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  // Stale-response guard for the filter search.
  const searchSeq = useRef(0)
  const activePath = useEditorStore((s) => s.active[tab.id] ?? null)
  const filterActive = filter.trim() !== ''

  const refresh = (): void => {
    setError('')
    setRefreshKey((k) => k + 1)
  }

  // Expansion (and focus) reset when the tree follows the shell into a
  // different directory — same behavior as the old per-row state, which the
  // path-keyed remount used to guarantee. The mount run must be skipped:
  // it would clobber the state just restored above.
  const prevCwd = useRef(tab.cwd)
  useEffect(() => {
    if (prevCwd.current === tab.cwd) return
    prevCwd.current = tab.cwd
    setExpanded(new Set())
    setFocused(null)
    setFilter('')
  }, [tab.cwd])

  // Mirror every change into the module map so unmounting loses nothing.
  useEffect(() => {
    savedTreeStates.set(tab.id, { cwd: tab.cwd, expanded, focused, filter })
  }, [tab.id, tab.cwd, expanded, focused, filter])

  // Keys should work the moment the panel is opened, without a click first.
  useEffect(() => {
    areaRef.current?.focus()
  }, [])

  // Bring a row into view once it renders — the expanded levels stream in
  // asynchronously, so poll a bounded number of frames for it.
  const seekRow = (target: string, block: ScrollLogicalPosition = 'nearest'): (() => void) => {
    let attempts = 120
    let raf = requestAnimationFrame(function seek() {
      const area = areaRef.current
      if (!area) return
      const row = [...area.querySelectorAll<HTMLElement>('.files-item[data-path]')].find(
        (r) => r.dataset.path === target
      )
      if (row) {
        row.scrollIntoView({ block })
        return
      }
      if (--attempts > 0) raf = requestAnimationFrame(seek)
    })
    return () => cancelAnimationFrame(raf)
  }

  // After a restore the area remounts scrolled to top while the expanded
  // levels stream in — bring the focused row back into view once it renders.
  // Abandoned as soon as the user scrolls somewhere themselves, and skipped
  // entirely when the editor sync below will reveal a row anyway.
  useEffect(() => {
    const target = restored?.focused
    if (!target) return
    if (useEditorStore.getState().active[tab.id]?.startsWith(`${tab.cwd}/`)) return
    let attempts = 120
    let raf = requestAnimationFrame(function seek() {
      const area = areaRef.current
      if (!area || area.scrollTop !== 0) return
      const row = [...area.querySelectorAll<HTMLElement>('.files-item[data-path]')].find(
        (r) => r.dataset.path === target
      )
      if (row) {
        row.scrollIntoView({ block: 'center' })
        return
      }
      if (--attempts > 0) raf = requestAnimationFrame(seek)
    })
    return () => cancelAnimationFrame(raf)
  }, [restored])

  // The tree mirrors the editor: the file showing there is revealed —
  // ancestors expanded, keyboard cursor moved onto it, scrolled into view.
  useEffect(() => {
    if (!activePath || !activePath.startsWith(`${tab.cwd}/`)) return
    setExpanded((prev) => {
      const next = new Set(prev)
      let p = activePath.slice(0, activePath.lastIndexOf('/'))
      while (p.length > tab.cwd.length) {
        next.add(p)
        p = p.slice(0, p.lastIndexOf('/'))
      }
      return next
    })
    setFocused(activePath)
    return seekRow(activePath)
  }, [activePath, tab.cwd])

  // The filter searches recursively (by entry name, subdirectories included)
  // via main; debounced, with only the latest response applied.
  useEffect(() => {
    const q = filter.trim()
    if (!q) {
      setMatches(null)
      return
    }
    const seq = ++searchSeq.current
    const timer = setTimeout(() => {
      void window.sokking.fsSearchNames(tab.cwd, q).then((result) => {
        if (seq !== searchSeq.current) return
        if (result.ok) setMatches({ entries: result.entries, truncated: result.truncated })
        else if (result.error !== 'cancelled') setError(result.error)
      })
    }, 200)
    return () => clearTimeout(timer)
  }, [filter, tab.cwd, refreshKey])

  // Open a file in the editor; binaries (and files too big for the editor)
  // fall through to the external app — the configured opener when one
  // matches, the OS default otherwise.
  const openInEditor = (path: string): void => {
    void openFileInEditor(tab.id, path, openFile).then((r) => {
      setError(r.ok ? '' : r.error)
      if (r.ok && r.opened === 'editor') onOpenEditor(path)
    })
  }

  // Click / Enter: the in-app editor wins; only what the editor can't take
  // (binaries, too-big files) goes to an external app.
  const openFileSmart = openInEditor

  const toggleDir = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  // Jump from a filter hit to its place in the tree: clear the filter, expand
  // the directory (and everything above it), and put the cursor on it.
  const revealDir = (path: string): void => {
    setFilter('')
    setExpanded((prev) => {
      const next = new Set(prev)
      let p = path
      while (p.length > tab.cwd.length) {
        next.add(p)
        p = p.slice(0, p.lastIndexOf('/'))
      }
      return next
    })
    setFocused(path)
    areaRef.current?.focus()
    seekRow(path)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    // App-level shortcuts (Ctrl+←/→ など) keep their meaning inside the panel.
    if (e.ctrlKey || e.altKey || e.metaKey) return
    // Esc clears the filter from anywhere in the panel, even when the
    // filter matches nothing (rows.length === 0 bails out below).
    if (e.key === 'Escape') {
      if (filter) {
        setFilter('')
        e.preventDefault()
      }
      return
    }
    const area = areaRef.current
    if (!area) return
    // Document order — exactly the visual order of the rendered rows.
    const rows = [...area.querySelectorAll<HTMLElement>('.files-item[data-path]')]
    if (rows.length === 0) return
    const index = rows.findIndex((r) => r.dataset.path === focused)
    const row = index === -1 ? null : rows[index]
    const path = row?.dataset.path ?? null
    const isDir = row?.dataset.isdir === '1'
    const isOpen = path !== null && expanded.has(path)

    const focusRow = (target: HTMLElement | undefined): void => {
      if (!target?.dataset.path) return
      setFocused(target.dataset.path)
      target.scrollIntoView({ block: 'nearest' })
    }

    switch (e.key) {
      case 'ArrowDown':
        focusRow(rows[index === -1 ? 0 : Math.min(index + 1, rows.length - 1)])
        break
      case 'ArrowUp':
        // ↑ on the first row climbs out of the tree to the filter box.
        if (index === 0) {
          filterRef.current?.focus()
          filterRef.current?.select()
          break
        }
        focusRow(rows[index === -1 ? 0 : index - 1])
        break
      case 'ArrowRight':
        // The filter's flat result list has no expansion to drive.
        if (filterActive || !path || !isDir) return
        if (!isOpen) toggleDir(path)
        else focusRow(rows[Math.min(index + 1, rows.length - 1)]) // into the first child
        break
      case 'ArrowLeft': {
        if (filterActive || !path) return
        if (isDir && isOpen) {
          toggleDir(path)
          break
        }
        const parent = rows.find((r) => r.dataset.path === path.slice(0, path.lastIndexOf('/')))
        focusRow(parent)
        break
      }
      case 'Enter':
        if (!path) return
        // A directory hit in the filter list jumps to its place in the tree.
        if (isDir) (filterActive ? revealDir : toggleDir)(path)
        // Enter opens in the editor (like double-click) — Shift+Enter is
        // the external-app variant (configured opener or OS default).
        else if (e.shiftKey)
          void openFile(path).then((result) => {
            setError(result.ok ? '' : result.error)
          })
        else openInEditor(path)
        break
      default:
        // Type-to-filter: a printable key moves focus to the filter input
        // before the text lands, so the character starts the filter.
        if (e.key.length === 1) filterRef.current?.focus()
        return
    }
    e.preventDefault()
  }

  // Hand focus back to the tree; make sure some visible row carries the
  // keyboard cursor (filtering may have removed the previous one).
  const focusTree = (): void => {
    const area = areaRef.current
    if (!area) return
    area.focus()
    const rows = [...area.querySelectorAll<HTMLElement>('.files-item[data-path]')]
    if (!rows.some((r) => r.dataset.path === focused) && rows[0]?.dataset.path) {
      setFocused(rows[0].dataset.path)
    }
  }

  // Registered every render so the shortcut always sees the latest closure.
  useEffect(() => {
    treeFocuser = focusTree
    filterFocuser = () => {
      filterRef.current?.focus()
      filterRef.current?.select()
    }
  })
  useEffect(
    () => () => {
      treeFocuser = null
      filterFocuser = null
    },
    []
  )

  return (
    <div className="git-panel">
      <div className="git-panel-header">
        <span className="git-panel-title">files</span>
        <span className="git-panel-cwd" title={tab.cwd}>
          {tab.cwd.replace(/^\/home\/[^/]+/, '~')}
        </span>
        <input
          ref={filterRef}
          className="files-filter"
          value={filter}
          placeholder="絞り込み"
          title="名前の部分一致で検索 (サブディレクトリ含む・「/」を含むとパスで一致) / ↓でツリーへ / Escでクリア"
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setFilter('')
              focusTree()
            } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
              focusTree()
            } else if (e.key === 'ArrowUp') {
              // Up the vertical walk: filter box → side-pane tabs.
              document.querySelector<HTMLElement>('.workspace-side-tabs .view-tab.active')?.focus()
            } else {
              return
            }
            e.preventDefault()
          }}
        />
        {filter && (
          <button className="icon-button" onClick={() => { setFilter(''); focusTree() }} title="絞り込みをクリア">
            ×
          </button>
        )}
        <button
          className="icon-button"
          onClick={() => {
            void window.sokking.fsOpen(tab.cwd).then((result) => {
              setError(result.ok ? '' : result.error)
            })
          }}
          title="このディレクトリをファイルマネージャーで開く"
        >
          🗁
        </button>
        <button className="icon-button" onClick={refresh} title="更新">
          ⟳
        </button>
      </div>

      {error && <div className="git-error">{error}</div>}

      <div
        className="files-area"
        ref={areaRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        title="↑↓で移動 / →←で開閉 / Enterでエディタで開く / Shift+Enterでアプリで開く / 文字入力で絞り込み"
      >
        <div className="files-list">
          {tab.cwd && filterActive ? (
            // Filtering replaces the tree with the flat recursive results;
            // rows keep the .files-item shape so the keyboard handler works.
            <FilterResults
              cwd={tab.cwd}
              needle={filter.trim().toLowerCase()}
              matches={matches}
              focused={focused}
              setFocused={setFocused}
              openFileSmart={openFileSmart}
              revealDir={revealDir}
            />
          ) : tab.cwd ? (
            <TreeContext.Provider
              value={{
                expanded,
                toggleDir,
                focused,
                setFocused,
                openFileSmart
              }}
            >
              <DirChildren dir={tab.cwd} depth={0} refreshKey={refreshKey} onError={setError} />
            </TreeContext.Provider>
          ) : null}
        </div>
      </div>
    </div>
  )
}

interface FilterResultsProps {
  cwd: string
  /** Normalized (trimmed, lowercase) query, for match highlighting. */
  needle: string
  matches: { entries: FsNameMatch[]; truncated: boolean } | null
  focused: string | null
  setFocused: (path: string) => void
  openFileSmart: (path: string) => void
  revealDir: (path: string) => void
}

/** Flat list of the recursive filter hits (files and directories, relative
    paths shown). File rows open like tree rows; directory rows jump back to
    their place in the tree. */
function FilterResults({
  cwd,
  needle,
  matches,
  focused,
  setFocused,
  openFileSmart,
  revealDir
}: FilterResultsProps): React.JSX.Element {
  if (matches === null) {
    return <div className="files-note">検索中…</div>
  }
  if (matches.entries.length === 0) {
    return <div className="files-note">(一致なし)</div>
  }
  return (
    <>
      {matches.entries.map((m) => {
        const path = `${cwd}/${m.path}`
        const name = m.path.slice(m.path.lastIndexOf('/') + 1)
        return (
          <div
            key={path}
            className={`files-item${m.isDir ? ' dir' : ''}${focused === path ? ' focused' : ''}`}
            style={{ paddingLeft: '10px' }}
            data-path={path}
            data-isdir={m.isDir ? '1' : '0'}
            draggable
            onDragStart={(ev) => {
              ev.preventDefault()
              window.sokking.fsStartDrag(path)
            }}
            onClick={() => {
              setFocused(path)
              if (m.isDir) revealDir(path)
              else openFileSmart(path)
            }}
            onContextMenu={(ev) => {
              ev.preventDefault()
              setFocused(path)
              const { clientX, clientY } = ev
              void (async () => {
                const opener = m.isDir
                  ? null
                  : await resolveOpener(path, useFileOpenersStore.getState().openers)
                await window.sokking.fsContextMenu(path, clientX, clientY, opener?.desktopFile)
              })()
            }}
            title={m.isDir ? 'クリックでツリー内の場所へ移動' : 'クリックでエディタで開く'}
          >
            <span className="files-caret">{m.isDir ? '▸' : ''}</span>
            <img className="files-icon" src={fileIconUrl(name, m.isDir, false)} alt="" draggable={false} />
            <span className="files-name">{highlight(m.path, needle)}</span>
          </div>
        )
      })}
      {matches.truncated && (
        <div className="files-note">結果が多すぎるため一部のみ表示しています</div>
      )}
    </>
  )
}

interface DirChildrenProps {
  dir: string
  depth: number
  refreshKey: number
  onError: (message: string) => void
}

function DirChildren({ dir, depth, refreshKey, onError }: DirChildrenProps): React.JSX.Element {
  const [entries, setEntries] = useState<FsEntry[] | null>(null)
  const [listError, setListError] = useState('')

  // No cache: collapsing and re-expanding a directory remounts this component,
  // which re-reads the directory — free freshness.
  useEffect(() => {
    let cancelled = false
    setListError('')
    void window.sokking.fsList(dir).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setEntries(result.entries)
      } else {
        setEntries([])
        setListError(result.error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [dir, refreshKey])

  const indent = { paddingLeft: `${10 + depth * 16}px` }

  if (listError) {
    return (
      <div className="files-note" style={indent}>
        {listError}
      </div>
    )
  }
  if (entries === null) {
    return (
      <div className="files-note" style={indent}>
        読み込み中…
      </div>
    )
  }
  if (entries.length === 0) {
    return (
      <div className="files-note" style={indent}>
        {depth === 0 ? '空のディレクトリです' : '(空)'}
      </div>
    )
  }

  const sorted = [...entries].sort((a, b) =>
    a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name, 'ja')
  )

  return (
    <>
      {sorted.map((e) => (
        // Keyed by full path so rows reset when the tree follows the shell
        // into a different directory.
        <EntryRow
          key={`${dir}/${e.name}`}
          dir={dir}
          entry={e}
          depth={depth}
          refreshKey={refreshKey}
          onError={onError}
        />
      ))}
    </>
  )
}

interface EntryRowProps {
  dir: string
  entry: FsEntry
  depth: number
  refreshKey: number
  onError: (message: string) => void
}

function EntryRow({ dir, entry, depth, refreshKey, onError }: EntryRowProps): React.JSX.Element {
  const { expanded, toggleDir, focused, setFocused, openFileSmart } = useContext(TreeContext)
  const path = `${dir}/${entry.name}`
  const open = entry.isDir && expanded.has(path)

  return (
    <>
      <div
        className={`files-item${entry.isDir ? ' dir' : ''}${focused === path ? ' focused' : ''}`}
        style={{ paddingLeft: `${10 + depth * 16}px` }}
        data-path={path}
        data-isdir={entry.isDir ? '1' : '0'}
        draggable
        onDragStart={(ev) => {
          // Replace the DOM drag with an OS-native file drag from main, so
          // the entry can be dropped on external apps (browser upload areas,
          // file managers, …).
          ev.preventDefault()
          window.sokking.fsStartDrag(path)
        }}
        onClick={() => {
          setFocused(path)
          if (entry.isDir) toggleDir(path)
          else openFileSmart(path)
        }}
        onContextMenu={(ev) => {
          ev.preventDefault()
          setFocused(path)
          const { clientX, clientY } = ev
          // The menu's 開く honors the configured opener (the external-app
          // route, unlike double-click); MIME patterns make the lookup async.
          void (async () => {
            const opener = entry.isDir
              ? null
              : await resolveOpener(path, useFileOpenersStore.getState().openers)
            await window.sokking.fsContextMenu(path, clientX, clientY, opener?.desktopFile)
          })()
        }}
        title={
          entry.isDir
            ? 'クリックで開閉 / 右クリックでメニュー / ドラッグで外部アプリへ'
            : 'クリックでエディタで開く / 右クリックでメニュー / ドラッグで外部アプリへ'
        }
      >
        <span className="files-caret">{entry.isDir ? (open ? '▾' : '▸') : ''}</span>
        <img
          className="files-icon"
          src={fileIconUrl(entry.name, entry.isDir, open)}
          alt=""
          draggable={false}
        />
        <span className="files-name">{entry.name}</span>
        <span className="files-size">{entry.isDir ? '' : formatSize(entry.size)}</span>
        <span className="files-mtime">{formatMtime(entry.mtime)}</span>
      </div>
      {open && <DirChildren dir={path} depth={depth + 1} refreshKey={refreshKey} onError={onError} />}
    </>
  )
}

function formatSize(size: number | null): string {
  if (size === null) return ''
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size
  let unit = ''
  for (const u of units) {
    value /= 1024
    unit = u
    if (value < 1024) break
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${unit}`
}

function formatMtime(mtime: number | null): string {
  if (mtime === null) return ''
  const d = new Date(mtime)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
