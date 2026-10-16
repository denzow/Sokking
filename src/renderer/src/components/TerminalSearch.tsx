import { useEffect, useMemo, useRef, useState } from 'react'
import type { ISearchOptions } from '@xterm/addon-search'
import { useAppearanceStore } from '../stores/appearance'
import { terminals } from './TerminalView'

interface TerminalSearchProps {
  /** The tab whose terminal is searched; searching follows the active tab. */
  tabId: string
  /** Bumped every time the shortcut is pressed, to refocus an already-open box. */
  focusToken: number
  onClose: () => void
}

/** Search bar over the terminal area (Ctrl+Shift+F), driving xterm's search addon. */
export function TerminalSearch({
  tabId,
  focusToken,
  onClose
}: TerminalSearchProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const [results, setResults] = useState({ index: -1, count: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  const theme = useAppearanceStore((s) => s.currentTheme())

  // Matches keep the terminal's own colors and are marked by their border, so
  // the text stays readable whatever the color scheme is.
  const options = useMemo<ISearchOptions>(
    () => ({
      caseSensitive,
      regex,
      decorations: {
        matchBackground: theme.ui.bgHover,
        matchBorder: theme.ui.textDim,
        matchOverviewRuler: theme.ui.textDim,
        activeMatchBackground: theme.ui.bgHover,
        activeMatchBorder: theme.ui.accent,
        activeMatchColorOverviewRuler: theme.ui.accent
      }
    }),
    [caseSensitive, regex, theme]
  )

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusToken])

  useEffect(() => {
    const handle = terminals.get(tabId)
    if (!handle) return
    const sub = handle.search.onDidChangeResults((r) =>
      setResults({ index: r.resultIndex, count: r.resultCount })
    )
    return () => {
      sub.dispose()
      handle.search.clearDecorations()
    }
  }, [tabId])

  // Search as you type; an empty box drops the highlights.
  useEffect(() => {
    const handle = terminals.get(tabId)
    if (!handle) return
    if (!query) {
      handle.search.clearDecorations()
      setResults({ index: -1, count: 0 })
      return
    }
    // Incremental keeps the current match while the term is still a prefix.
    handle.search.findNext(query, { ...options, incremental: true })
  }, [query, options, tabId])

  const find = (backwards: boolean): void => {
    const handle = terminals.get(tabId)
    if (!handle || !query) return
    if (backwards) handle.search.findPrevious(query, options)
    else handle.search.findNext(query, options)
  }

  const close = (): void => {
    terminals.get(tabId)?.search.clearDecorations()
    terminals.get(tabId)?.term.focus()
    onClose()
  }

  return (
    <div className="terminal-search">
      <input
        ref={inputRef}
        className="terminal-search-input"
        placeholder="ターミナル内を検索"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            find(e.shiftKey)
            e.preventDefault()
          } else if (e.key === 'Escape') {
            close()
            e.preventDefault()
          }
        }}
      />
      <span className="terminal-search-count">
        {query === '' ? '' : results.count === 0 ? '一致なし' : `${results.index + 1}/${results.count}`}
      </span>
      <button
        className={`terminal-search-toggle${caseSensitive ? ' active' : ''}`}
        title="大文字小文字を区別"
        onClick={() => setCaseSensitive((v) => !v)}
      >
        Aa
      </button>
      <button
        className={`terminal-search-toggle${regex ? ' active' : ''}`}
        title="正規表現"
        onClick={() => setRegex((v) => !v)}
      >
        .*
      </button>
      <button className="icon-button" title="前へ (Shift+Enter)" onClick={() => find(true)}>
        ↑
      </button>
      <button className="icon-button" title="次へ (Enter)" onClick={() => find(false)}>
        ↓
      </button>
      <button className="icon-button" title="閉じる (Esc)" onClick={close}>
        ✕
      </button>
    </div>
  )
}
