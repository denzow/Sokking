import { useEffect, useMemo, useRef, useState } from 'react'
import { Tab, tabLabel, useTabsStore } from '../stores/tabs'
import { collapseHome } from '../stores/bookmarks'

interface TabSearchModalProps {
  onClose: () => void
  /** Called with the chosen tab's id; the caller activates it. */
  onSelect: (tabId: string) => void
}

/** Case-insensitive AND match over the tab's name, its directory (full and
    ~-abbreviated, so typing what you see always matches) and the command
    currently running in it. */
function filterTabs(tabs: Tab[], query: string): Tab[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return tabs
  return tabs.filter((tab) => {
    const haystacks = [
      tabLabel(tab).toLowerCase(),
      tab.cwd.toLowerCase(),
      collapseHome(tab.cwd).toLowerCase(),
      (tab.runningProcess ?? '').toLowerCase()
    ]
    return terms.every((t) => haystacks.some((h) => h.includes(t)))
  })
}

/** Tab switcher palette (Shift twice): incremental search over the open tabs
    by directory and running process. */
export function TabSearchModal({ onClose, onSelect }: TabSearchModalProps): React.JSX.Element {
  const tabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Notification tabs (attention: the yellow-highlighted rows waiting for
  // input) float to the top so they are the first candidates. Stable within
  // each group, so the usual order is otherwise preserved.
  const filtered = useMemo(() => {
    const matched = filterTabs(tabs, query)
    return [...matched].sort((a, b) => Number(b.attention) - Number(a.attention))
  }, [tabs, query])

  // Keep the selection on a real entry as filtering shrinks the list.
  const clampedSelected = Math.min(selected, Math.max(0, filtered.length - 1))

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((prev) => Math.min(Math.min(prev, filtered.length - 1) + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((prev) => Math.max(Math.min(prev, filtered.length - 1) - 1, 0))
    } else if (e.key === 'Enter') {
      // Without preventDefault the same keystroke's keypress fires after focus
      // has moved to the destination terminal, feeding it a stray Enter.
      e.preventDefault()
      const tab = filtered[clampedSelected]
      if (tab) onSelect(tab.id)
    }
  }

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Escape closes the palette wherever the focus is.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Keep the selected row visible while stepping with ↑/↓.
  useEffect(() => {
    listRef.current?.querySelector('.tab-search-item.selected')?.scrollIntoView({ block: 'nearest' })
  }, [clampedSelected, filtered])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal tab-search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bookmarks-search-row">
          <span className="bookmarks-search-icon">⇥</span>
          <input
            ref={inputRef}
            className="bookmarks-search-input"
            placeholder="タブを検索…（ディレクトリ / 実行中プロセス）"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(0)
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="bookmarks-list" ref={listRef}>
          {filtered.map((tab, index) => (
            <div
              key={tab.id}
              className={`tab-search-item bookmark-item${index === clampedSelected ? ' selected' : ''}${tab.attention ? ' attention' : ''}`}
              onClick={() => onSelect(tab.id)}
              onMouseMove={() => setSelected(index)}
              title={tab.cwd}
            >
              <span className="bookmark-label">
                <span className="bookmark-name">
                  {tabLabel(tab)}
                  {tab.id === activeTabId && <span className="tab-search-current">現在のタブ</span>}
                </span>
                {/* Directory and running process sit side by side on the same
                    line — spreading them to the row's two edges made the pair
                    hard to read. */}
                <span className="tab-search-meta">
                  <span className="bookmark-path">{collapseHome(tab.cwd)}</span>
                  {tab.runningProcess && (
                    <span className="tab-search-process">{tab.runningProcess}</span>
                  )}
                </span>
              </span>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="bookmarks-empty">一致するタブがありません</div>
          )}
        </div>
        <div className="modal-footer">
          <span className="modal-hint">↑↓ 選択 / Enter で切り替え / Esc で閉じる</span>
        </div>
      </div>
    </div>
  )
}
