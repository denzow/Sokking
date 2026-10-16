import { useEffect, useRef, useState } from 'react'
import {
  closeEditorFile,
  EditorPanel,
  focusEditor,
  requestEditorFocus,
  requestEditorReveal,
  revealEditorLine
} from './EditorPanel'
import { FilesPanel, focusFilesFilter, focusFilesTree } from './FilesPanel'
import { WorkspaceSearch } from './WorkspaceSearch'
import { openFileInEditor, useEditorStore } from '../stores/editor'
import { fileIconUrl } from '../file-icons'
import { Tab } from '../stores/tabs'

// Side-pane state that should survive the panel unmounting: the pane width
// is app-wide, the tree/search choice is per session tab. In-memory only.
let savedSideWidth = 320
const savedModes = new Map<string, 'files' | 'search'>()

// The find shortcut means the workspace search while this panel is showing.
// The mounted panel (there is at most one) registers how to open it here;
// App calls this instead of the terminal search. False = no panel mounted.
let searchOpener: (() => void) | null = null
export function openWorkspaceSearch(): boolean {
  if (!searchOpener) return false
  searchOpener()
  return true
}

// wsFocusTree: switch the side pane to the file tree and focus it.
let treeOpener: (() => void) | null = null
export function focusWorkspaceTree(): boolean {
  if (!treeOpener) return false
  treeOpener()
  return true
}

/** Enter/↓ on the workspace view-tab (the panel menu) descends back into the
    workspace's top strip: the active editor file tab when one exists, the
    active side-pane tab otherwise. Inverse of the strip's ↑. */
export function focusWorkspaceContent(): void {
  const target =
    document.querySelector<HTMLElement>('.workspace-editor-tabs .editor-view-tab.active') ??
    document.querySelector<HTMLElement>('.workspace-side-tabs .view-tab.active')
  target?.focus()
}

const SIDE_MIN = 180
const SIDE_MAX = 800

interface WorkspacePanelProps {
  tab: Tab
}

/**
 * VS Code-style workspace for the tab's cwd: a side pane (file tree, or the
 * directory search) next to the editor area with its open-file tab strip.
 * The open files live in the editor store (per session tab); which one shows
 * is the store's per-tab `active` path.
 */
export function WorkspacePanel({ tab }: WorkspacePanelProps): React.JSX.Element {
  const files = useEditorStore((s) => s.files).filter((f) => f.tabId === tab.id)
  const activePath = useEditorStore((s) => s.active[tab.id] ?? null)
  const active = files.find((f) => f.path === activePath) ?? null
  const [mode, setMode] = useState<'files' | 'search'>(() => savedModes.get(tab.id) ?? 'files')
  const [sideWidth, setSideWidth] = useState(savedSideWidth)
  const [error, setError] = useState('')
  const [searchFocusToken, setSearchFocusToken] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const filesTabRef = useRef<HTMLButtonElement>(null)
  const searchTabRef = useRef<HTMLButtonElement>(null)

  // Arrow-key navigation across the strips: the side-pane tabs (ファイル /
  // 検索) and the editor file tabs form one left-to-right row — ←/→ walk it,
  // ↓ drops into the focused thing's content, ↑ climbs to the panel menu.
  const onSideTabKey = (e: React.KeyboardEvent, which: 'files' | 'search'): void => {
    if (e.key === 'ArrowLeft') {
      if (which === 'search') filesTabRef.current?.focus()
    } else if (e.key === 'ArrowRight') {
      if (which === 'files') searchTabRef.current?.focus()
      else document.querySelector<HTMLElement>('.workspace-editor-tabs .editor-view-tab')?.focus()
    } else if (e.key === 'ArrowDown') {
      if (which === 'files') {
        switchMode('files')
        // Next stop of the vertical walk is the filter box (↓ again → tree).
        setTimeout(() => focusFilesFilter(), 0)
      } else {
        switchMode('search')
        setSearchFocusToken((t) => t + 1)
      }
    } else if (e.key === 'ArrowUp') {
      document.querySelector<HTMLElement>('.view-tabs .view-tab.active')?.focus()
    } else {
      return
    }
    e.preventDefault()
  }

  const switchMode = (m: 'files' | 'search'): void => {
    savedModes.set(tab.id, m)
    setMode(m)
  }

  // Let the find shortcut open (and refocus) the search pane, and
  // wsFocusTree open (and focus) the file tree.
  useEffect(() => {
    searchOpener = () => {
      savedModes.set(tab.id, 'search')
      setMode('search')
      setSearchFocusToken((t) => t + 1)
    }
    treeOpener = () => {
      savedModes.set(tab.id, 'files')
      setMode('files')
      // Already-mounted tree: focus it now (deferred past the state flush).
      // A freshly mounting FilesPanel focuses itself in its mount effect.
      setTimeout(() => focusFilesTree(), 0)
    }
    return () => {
      searchOpener = null
      treeOpener = null
    }
  }, [tab.id])

  // Open from the side pane (search hits carry a line). Focus is handed to
  // the editor: directly when the file is already showing (no model swap
  // will run), via the pending-flags otherwise.
  const openFile = (path: string, line?: number): void => {
    void (async () => {
      const alreadyShowing = useEditorStore.getState().active[tab.id] === path
      if (!alreadyShowing && line !== undefined) requestEditorReveal(line)
      if (!alreadyShowing) requestEditorFocus()
      const r = await openFileInEditor(tab.id, path)
      if (!r.ok) {
        requestEditorReveal(null)
        setError(r.error)
        return
      }
      setError('')
      if (r.opened !== 'editor') {
        requestEditorReveal(null)
        return
      }
      if (alreadyShowing) {
        focusEditor()
        if (line !== undefined) revealEditorLine(line)
      }
    })()
  }

  const activateFile = (path: string): void => {
    if (activePath === path) focusEditor()
    else {
      requestEditorFocus()
      useEditorStore.getState().setActive(tab.id, path)
    }
  }

  // Drag the divider to resize the side pane (same pattern as the sidebar).
  const startResize = (down: React.MouseEvent): void => {
    down.preventDefault()
    const panelLeft = panelRef.current?.getBoundingClientRect().left ?? 0
    const onMove = (e: MouseEvent): void => {
      const width = Math.min(SIDE_MAX, Math.max(SIDE_MIN, e.clientX - panelLeft))
      savedSideWidth = width
      setSideWidth(width)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="workspace-panel" ref={panelRef}>
      <div className="workspace-side" style={{ width: sideWidth }}>
        <div className="workspace-side-tabs">
          <button
            ref={filesTabRef}
            className={`view-tab${mode === 'files' ? ' active' : ''}`}
            onClick={() => switchMode('files')}
            onKeyDown={(e) => onSideTabKey(e, 'files')}
            title="ファイルツリー (↓でツリーへ)"
          >
            ファイル
          </button>
          <button
            ref={searchTabRef}
            className={`view-tab${mode === 'search' ? ' active' : ''}`}
            onClick={() => switchMode('search')}
            onKeyDown={(e) => onSideTabKey(e, 'search')}
            title="ディレクトリ配下の検索 (ファイル名 + 内容・↓で検索欄へ)"
          >
            検索
          </button>
        </div>
        {mode === 'files' ? (
          // Keyed by tab so the saved tree state restores at mount.
          <FilesPanel
            key={tab.id}
            tab={tab}
            onOpenEditor={(path) => {
              // The store's open() already activated the file; hand focus to
              // the editor (directly when it was already the shown file — no
              // model swap runs to consume a pending request).
              if (activePath === path) focusEditor()
              else requestEditorFocus()
            }}
          />
        ) : (
          <WorkspaceSearch tab={tab} onOpenFile={openFile} focusToken={searchFocusToken} />
        )}
        <div className="workspace-side-resizer" onMouseDown={startResize} />
      </div>
      <div className="workspace-main">
        {files.length > 0 && (
          <div className="workspace-editor-tabs">
            {files.map((f) => (
              <div
                key={f.path}
                className={`view-tab editor-view-tab${f.path === activePath ? ' active' : ''}`}
                // Focus target for the editor's Escape (leave-the-editor);
                // divs aren't focusable without this.
                tabIndex={-1}
                title={f.path}
                onClick={() => activateFile(f.path)}
                onAuxClick={(e) => {
                  if (e.button === 1) closeEditorFile(tab.id, f.path) // middle click closes
                }}
                onKeyDown={(e) => {
                  // The tab holds focus after the editor's Escape; Enter/↓ go
                  // back into the editor, ←/→ move between the file tabs —
                  // ← past the first one continues onto the side-pane tabs —
                  // and ↑ climbs to the panel menu.
                  if (e.key === 'Enter' || e.key === 'ArrowDown') {
                    e.preventDefault()
                    activateFile(f.path)
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    document.querySelector<HTMLElement>('.view-tabs .view-tab.active')?.focus()
                  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault()
                    const index = files.findIndex((x) => x.path === f.path)
                    const next = files[index + (e.key === 'ArrowLeft' ? -1 : 1)]
                    if (!next) {
                      if (e.key === 'ArrowLeft') searchTabRef.current?.focus()
                      return
                    }
                    useEditorStore.getState().setActive(tab.id, next.path)
                    setTimeout(
                      () =>
                        document
                          .querySelector<HTMLElement>('.workspace-editor-tabs .active')
                          ?.focus(),
                      0
                    )
                  }
                }}
              >
                <img className="editor-tab-icon" src={fileIconUrl(f.name, false, false)} alt="" />
                <span className="editor-tab-name">{f.name}</span>
                <span
                  className={`editor-tab-close${f.dirty ? ' dirty' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    closeEditorFile(tab.id, f.path)
                  }}
                  title={f.dirty ? '未保存の変更あり / クリックで閉じる' : '閉じる'}
                >
                  {f.dirty ? '●' : '×'}
                </span>
              </div>
            ))}
          </div>
        )}
        {error && <div className="git-error">{error}</div>}
        {active ? (
          <EditorPanel tabId={tab.id} path={active.path} />
        ) : (
          <div className="workspace-empty">
            ファイルツリーまたは検索からファイルを開いてください
          </div>
        )}
      </div>
    </div>
  )
}
