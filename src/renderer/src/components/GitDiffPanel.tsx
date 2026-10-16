import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GitDiffFile, GitOverview } from '../../../shared/ipc'
import { fileIconUrl } from '../file-icons'
import { Tab } from '../stores/tabs'
import { DiffViewer } from './DiffViewer'

interface GitDiffPanelProps {
  tab: Tab
  /** Open an absolute path in the workspace's editor (switches the panel). */
  onOpenInEditor: (path: string) => void
}

/**
 * A node in the changed-file tree. Directories carry `children`; files carry
 * the underlying `file` and their added/deleted line counts.
 */
interface TreeNode {
  /** Display label — for collapsed single-child dir chains this is "a/b". */
  name: string
  /** Full directory path (dirs) or file path (files); also the toggle key. */
  path: string
  isDir: boolean
  children?: TreeNode[]
  file?: GitDiffFile
  add?: number
  del?: number
}

interface DirEntry {
  dirs: Map<string, DirEntry>
  files: GitDiffFile[]
}

/**
 * Turn the flat changed-file list into a folder tree. Directories with a
 * single subdirectory and no files of their own are collapsed into one row
 * (`internal-prd/analysis`), the way VS Code's Source Control tree does.
 */
function buildTree(files: GitDiffFile[]): TreeNode[] {
  const root: DirEntry = { dirs: new Map(), files: [] }
  for (const f of files) {
    const parts = f.path.split('/')
    let cur = root
    for (let i = 0; i < parts.length - 1; i++) {
      let next = cur.dirs.get(parts[i])
      if (!next) {
        next = { dirs: new Map(), files: [] }
        cur.dirs.set(parts[i], next)
      }
      cur = next
    }
    cur.files.push(f)
  }
  return toNodes(root, '')
}

function toNodes(entry: DirEntry, prefix: string): TreeNode[] {
  const dirNodes: TreeNode[] = []
  for (const [name, sub] of [...entry.dirs.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], 'ja')
  )) {
    let label = name
    let path = prefix ? `${prefix}/${name}` : name
    let cur = sub
    while (cur.files.length === 0 && cur.dirs.size === 1) {
      const [childName, childSub] = [...cur.dirs.entries()][0]
      label = `${label}/${childName}`
      path = `${path}/${childName}`
      cur = childSub
    }
    dirNodes.push({ name: label, path, isDir: true, children: toNodes(cur, path) })
  }
  const fileNodes: TreeNode[] = entry.files
    .sort((a, b) => a.path.localeCompare(b.path, 'ja'))
    .map((f) => {
      let add = 0
      let del = 0
      for (const h of f.hunks)
        for (const l of h.lines) {
          if (l.type === 'add') add++
          else if (l.type === 'del') del++
        }
      return {
        name: f.path.slice(f.path.lastIndexOf('/') + 1),
        path: f.path,
        isDir: false,
        file: f,
        add,
        del
      }
    })
  return [...dirNodes, ...fileNodes]
}

const LIST_WIDTH_KEY = 'sokking.diffFileListWidth'
const DEFAULT_LIST_WIDTH = 210
const MIN_LIST_WIDTH = 120
const MAX_LIST_WIDTH = 600

function loadListWidth(): number {
  const raw = Number(localStorage.getItem(LIST_WIDTH_KEY))
  return Number.isFinite(raw) && raw >= MIN_LIST_WIDTH && raw <= MAX_LIST_WIDTH
    ? raw
    : DEFAULT_LIST_WIDTH
}

export function GitDiffPanel({ tab, onOpenInEditor }: GitDiffPanelProps): React.JSX.Element {
  const [overview, setOverview] = useState<GitOverview | null>(null)
  const [diff, setDiff] = useState<GitDiffFile[]>([])
  const [loading, setLoading] = useState(false)
  // File-list highlight: the file whose diff is at the top of the viewport.
  const [activeFile, setActiveFile] = useState<string | null>(null)
  // Collapsed folders in the file tree. Default (absent) = expanded, so new
  // folders that appear on refresh show open without seeding this set.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [listWidth, setListWidth] = useState(loadListWidth)
  const diffScrollRef = useRef<HTMLDivElement>(null)
  const diffAreaRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async (): Promise<void> => {
    if (!tab.cwd) return
    setLoading(true)
    try {
      const ov = await window.sokking.gitOverview(tab.cwd)
      setOverview(ov)
      setDiff(ov.isRepo ? await window.sokking.gitDiff(tab.cwd) : [])
    } finally {
      setLoading(false)
    }
  }, [tab.cwd])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const sendToClaude = (text: string): void => {
    // Bracketed paste keeps multi-line text as a single paste for the
    // receiving app (Claude Code / readline).
    window.sokking.ptyWrite(tab.id, `\x1b[200~${text}\x1b[201~`)
  }

  const toggleDir = (path: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const jumpToFile = (path: string): void => {
    setActiveFile(path)
    diffScrollRef.current
      ?.querySelector(`[data-diff-file="${CSS.escape(path)}"]`)
      ?.scrollIntoView({ block: 'start' })
  }

  // Follow the scroll: highlight the last file whose diff starts at or above
  // the viewport top.
  const onDiffScroll = (): void => {
    const container = diffScrollRef.current
    if (!container) return
    const top = container.getBoundingClientRect().top
    let current: string | null = null
    for (const el of container.querySelectorAll<HTMLElement>('[data-diff-file]')) {
      if (el.getBoundingClientRect().top - top <= 8) current = el.dataset.diffFile ?? null
      else break
    }
    if (current) setActiveFile(current)
  }

  // Pointer capture keeps the drag alive once the cursor leaves the thin handle.
  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const handle = e.currentTarget
    try {
      handle.setPointerCapture(e.pointerId)
    } catch {
      // No capturable pointer — the drag still works while the cursor stays on
      // the handle.
    }
    const left = diffAreaRef.current?.getBoundingClientRect().left ?? 0
    const onMove = (ev: PointerEvent): void =>
      setListWidth(Math.min(MAX_LIST_WIDTH, Math.max(MIN_LIST_WIDTH, ev.clientX - left)))
    const onUp = (): void => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      setListWidth((w) => {
        localStorage.setItem(LIST_WIDTH_KEY, String(w))
        return w
      })
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
  }

  const resetListWidth = (): void => {
    setListWidth(DEFAULT_LIST_WIDTH)
    localStorage.setItem(LIST_WIDTH_KEY, String(DEFAULT_LIST_WIDTH))
  }

  // The remembered file may vanish on refresh — fall back to the first one.
  const highlighted = diff.some((f) => f.path === activeFile) ? activeFile : (diff[0]?.path ?? null)

  const tree = useMemo(() => buildTree(diff), [diff])

  const renderNodes = (nodes: TreeNode[], depth: number): React.JSX.Element[] =>
    nodes.flatMap((node) => {
      const pad = 8 + depth * 12
      if (node.isDir) {
        const open = !collapsed.has(node.path)
        const iconName = node.name.slice(node.name.lastIndexOf('/') + 1)
        return [
          <div
            key={`d:${node.path}`}
            className="diff-tree-row dir"
            style={{ paddingLeft: pad }}
            title={node.path}
            onClick={() => toggleDir(node.path)}
          >
            <span className="diff-tree-caret">{open ? '▾' : '▸'}</span>
            <img
              className="diff-tree-icon"
              src={fileIconUrl(iconName, true, open)}
              alt=""
              draggable={false}
            />
            <span className="diff-tree-name">{node.name}</span>
          </div>,
          ...(open ? renderNodes(node.children ?? [], depth + 1) : [])
        ]
      }
      const f = node.file!
      return [
        <div
          key={`f:${node.path}`}
          className={`diff-tree-row file diff-status-${f.status}${
            f.path === highlighted ? ' active' : ''
          }`}
          style={{ paddingLeft: pad }}
          title={f.status === 'renamed' && f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
          onClick={() => jumpToFile(f.path)}
        >
          <span className="diff-tree-caret" />
          <img className="diff-tree-icon" src={fileIconUrl(node.name, false)} alt="" draggable={false} />
          <span className="diff-tree-name">{node.name}</span>
          <span className="diff-file-list-counts">
            {(node.add ?? 0) > 0 && <span className="add">+{node.add}</span>}
            {(node.del ?? 0) > 0 && <span className="del">−{node.del}</span>}
          </span>
        </div>
      ]
    })

  return (
    <div className="git-panel">
      <div className="git-panel-header">
        <span className="git-panel-title">diff</span>
        <span className="git-panel-cwd" title={tab.cwd}>
          {tab.cwd.replace(/^\/home\/[^/]+/, '~')}
        </span>
        <button className="icon-button" onClick={() => void refresh()} title="更新">
          ⟳
        </button>
      </div>

      {!overview?.isRepo ? (
        <div className="git-panel-empty">
          {loading ? '読み込み中…' : 'このディレクトリは Git リポジトリではありません'}
        </div>
      ) : (
        <>
          <div className="git-diff-area" ref={diffAreaRef}>
            {diff.length === 0 ? (
              <div className="git-panel-empty">変更はありません</div>
            ) : (
              <>
                <div className="diff-file-list" style={{ width: listWidth }}>
                  {renderNodes(tree, 0)}
                </div>
                <div
                  className="diff-file-list-resizer"
                  onPointerDown={onResizeStart}
                  onDoubleClick={resetListWidth}
                  title="ドラッグで幅を変更 / ダブルクリックで既定幅に戻す"
                />
                <div className="diff-scroll" ref={diffScrollRef} onScroll={onDiffScroll}>
                  <DiffViewer
                    tabId={tab.id}
                    files={diff}
                    onSend={sendToClaude}
                    // Diff paths are relative to the repo root, not the cwd.
                    onOpenFile={(rel) => onOpenInEditor(`${overview.root ?? tab.cwd}/${rel}`)}
                  />
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
