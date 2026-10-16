import { useEffect, useRef, useState } from 'react'
import { WorkspaceSearchMatch } from '../../../shared/ipc'
import { fileIconUrl } from '../file-icons'
import { Tab } from '../stores/tabs'

interface WorkspaceSearchProps {
  tab: Tab
  /** Open a hit: absolute path, plus the line for content matches. */
  onOpenFile: (path: string, line?: number) => void
  /** Bumped by the find shortcut — refocus (and select) the query input. */
  focusToken?: number
}

const MIN_QUERY = 2
const DEBOUNCE_MS = 300

interface Results {
  files: string[]
  matches: WorkspaceSearchMatch[]
  truncated: boolean
}

// Query survives the pane unmounting (switching to the tree, leaving the
// panel) — keyed by tab id; results are re-fetched on mount. In-memory only.
const savedQueries = new Map<string, string>()

/**
 * Directory search under the tab's cwd: file-name matches and content
 * matches (grep) in one list. Typing searches incrementally (debounced);
 * ↑/↓ move the selection, Enter opens it (focus stays in the input, palette
 * style); clicking a hit opens it too, content hits at their line.
 */
export function WorkspaceSearch({ tab, onOpenFile, focusToken }: WorkspaceSearchProps): React.JSX.Element {
  const [query, setQuery] = useState(() => savedQueries.get(tab.id) ?? '')
  const [results, setResults] = useState<Results | null>(null)
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState('')
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  // Stale-response guard: only the latest request may set state.
  const seqRef = useRef(0)

  // Focus on mount, and again whenever the find shortcut re-requests it.
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusToken])

  useEffect(() => {
    savedQueries.set(tab.id, query)
    const q = query.trim()
    if (q.length < MIN_QUERY) {
      setResults(null)
      setError('')
      setSearching(false)
      return
    }
    setSearching(true)
    const seq = ++seqRef.current
    const timer = setTimeout(() => {
      void window.sokking.workspaceSearch(tab.cwd, q).then((result) => {
        if (seq !== seqRef.current) return
        setSearching(false)
        if (result.ok) {
          setResults({ files: result.files, matches: result.matches, truncated: result.truncated })
          setError('')
        } else if (result.error !== 'cancelled') {
          setResults(null)
          setError(result.error)
        }
      })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [tab.id, tab.cwd, query])

  // New results restart the keyboard selection from the top.
  useEffect(() => {
    setSelected(0)
  }, [results])

  // Keep the selected row visible while ↑/↓ move it.
  useEffect(() => {
    resultsRef.current?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const needle = query.trim().toLowerCase()

  // Content matches grouped per file, in the order grep reported them.
  const grouped: { file: string; matches: WorkspaceSearchMatch[] }[] = []
  if (results) {
    let last: { file: string; matches: WorkspaceSearchMatch[] } | null = null
    for (const m of results.matches) {
      if (!last || last.file !== m.file) {
        last = { file: m.file, matches: [] }
        grouped.push(last)
      }
      last.matches.push(m)
    }
  }

  // The selectable rows in display order: file-name hits, then every content
  // match (the per-file headers are not selectable). Index = selection.
  const items: { path: string; line?: number }[] = results
    ? [
        ...results.files.map((rel) => ({ path: rel })),
        ...grouped.flatMap((g) => g.matches.map((m) => ({ path: m.file, line: m.line })))
      ]
    : []
  // Where each group's matches start in `items`.
  let offset = results?.files.length ?? 0
  const groupStart = grouped.map((g) => {
    const start = offset
    offset += g.matches.length
    return start
  })

  const openItem = (item: { path: string; line?: number }): void => {
    onOpenFile(`${tab.cwd}/${item.path}`, item.line)
  }

  return (
    <div className="workspace-search">
      <div className="workspace-search-header">
        <input
          ref={inputRef}
          className="workspace-search-input"
          value={query}
          placeholder="ディレクトリ配下を検索 (ファイル名 + 内容)"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              setQuery('')
            } else if (e.key === 'ArrowDown') {
              setSelected((s) => Math.min(s + 1, Math.max(items.length - 1, 0)))
            } else if (e.key === 'ArrowUp') {
              setSelected((s) => Math.max(s - 1, 0))
            } else if (e.key === 'Enter') {
              if (items[selected]) openItem(items[selected])
            } else {
              return
            }
            e.preventDefault()
          }}
        />
      </div>
      {error && <div className="git-error">{error}</div>}
      <div className="workspace-search-results" ref={resultsRef}>
        {query.trim().length < MIN_QUERY ? (
          <div className="search-note">{MIN_QUERY}文字以上で検索します</div>
        ) : searching && !results ? (
          <div className="search-note">検索中…</div>
        ) : results ? (
          <>
            {results.files.length === 0 && grouped.length === 0 && (
              <div className="search-note">一致なし</div>
            )}
            {results.files.length > 0 && (
              <>
                <div className="search-section">ファイル名 ({results.files.length})</div>
                {results.files.map((rel, i) => (
                  <div
                    key={rel}
                    className={`search-file-row${selected === i ? ' selected' : ''}`}
                    title={rel}
                    onClick={() => onOpenFile(`${tab.cwd}/${rel}`)}
                  >
                    <img
                      className="files-icon"
                      src={fileIconUrl(rel.slice(rel.lastIndexOf('/') + 1), false, false)}
                      alt=""
                    />
                    <span className="search-file-path">{highlight(rel, needle)}</span>
                  </div>
                ))}
              </>
            )}
            {grouped.length > 0 && (
              <>
                <div className="search-section">
                  内容 ({results.matches.length}件 / {grouped.length}ファイル)
                </div>
                {grouped.map((g, gi) => (
                  <div key={g.file}>
                    <div
                      className="search-match-file"
                      title={g.file}
                      onClick={() => onOpenFile(`${tab.cwd}/${g.file}`, g.matches[0].line)}
                    >
                      <img
                        className="files-icon"
                        src={fileIconUrl(g.file.slice(g.file.lastIndexOf('/') + 1), false, false)}
                        alt=""
                      />
                      <span className="search-file-path">{g.file}</span>
                    </div>
                    {g.matches.map((m, mi) => (
                      <div
                        key={`${m.file}:${m.line}`}
                        className={`search-match-row${selected === groupStart[gi] + mi ? ' selected' : ''}`}
                        title={`${m.file}:${m.line}`}
                        onClick={() => onOpenFile(`${tab.cwd}/${m.file}`, m.line)}
                      >
                        <span className="search-match-line">{m.line}</span>
                        <span className="search-match-text">{highlight(m.text.trim(), needle)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}
            {results.truncated && (
              <div className="search-note">結果が多すぎるため一部のみ表示しています</div>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}

/** The query's occurrences highlighted (case-insensitive), as spans. */
export function highlight(text: string, needle: string): React.ReactNode {
  if (!needle) return text
  const lower = text.toLowerCase()
  const parts: React.ReactNode[] = []
  let pos = 0
  for (;;) {
    const hit = lower.indexOf(needle, pos)
    if (hit === -1) break
    if (hit > pos) parts.push(text.slice(pos, hit))
    parts.push(
      <span key={hit} className="search-hit">
        {text.slice(hit, hit + needle.length)}
      </span>
    )
    pos = hit + needle.length
  }
  if (parts.length === 0) return text
  if (pos < text.length) parts.push(text.slice(pos))
  return parts
}
