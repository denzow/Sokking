import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, bookmarkLabel, collapseHome, useBookmarksStore } from '../stores/bookmarks'
import { useTabsStore } from '../stores/tabs'

interface BookmarksModalProps {
  onClose: () => void
}

/** Case-insensitive AND match: every whitespace-separated term must appear in
    the bookmark's path — the full form or the ~-abbreviated one shown in the
    list, so typing what you see always matches. */
function filterBookmarks(bookmarks: Bookmark[], query: string): Bookmark[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return bookmarks
  return bookmarks.filter((b) => {
    const full = b.path.toLowerCase()
    const abbreviated = collapseHome(b.path).toLowerCase()
    return terms.every((t) => full.includes(t) || abbreviated.includes(t))
  })
}

export function BookmarksModal({ onClose }: BookmarksModalProps): React.JSX.Element {
  const bookmarks = useBookmarksStore((s) => s.bookmarks)
  const removeBookmark = useBookmarksStore((s) => s.removeBookmark)
  const addTab = useTabsStore((s) => s.addTab)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => filterBookmarks(bookmarks, query), [bookmarks, query])

  // Keep the selection on a real entry as filtering / deletion shrinks the list.
  const clampedSelected = Math.min(selected, Math.max(0, filtered.length - 1))

  const openBookmark = (bookmark: Bookmark): void => {
    addTab(bookmark.path)
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((prev) => Math.min(Math.min(prev, filtered.length - 1) + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((prev) => Math.max(Math.min(prev, filtered.length - 1) - 1, 0))
    } else if (e.key === 'Enter') {
      // Without preventDefault the same keystroke's keypress fires after focus
      // has moved to the new tab's terminal, feeding it a stray Enter.
      e.preventDefault()
      const bookmark = filtered[clampedSelected]
      if (bookmark) openBookmark(bookmark)
    }
  }

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Escape closes the palette wherever the focus is (the input's own handler
  // only covers typing in the search field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Keep the selected row visible while stepping with ↑/↓.
  useEffect(() => {
    listRef.current
      ?.querySelector('.bookmark-item.selected')
      ?.scrollIntoView({ block: 'nearest' })
  }, [clampedSelected, filtered])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal bookmarks-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bookmarks-search-row">
          <span className="bookmarks-search-icon">★</span>
          <input
            ref={inputRef}
            className="bookmarks-search-input"
            placeholder="ブックマークを検索…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(0)
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="bookmarks-list" ref={listRef}>
          {filtered.map((bookmark, index) => (
            <div
              key={bookmark.path}
              className={`bookmark-item${index === clampedSelected ? ' selected' : ''}`}
              onClick={() => openBookmark(bookmark)}
              onMouseMove={() => setSelected(index)}
              title={`${bookmark.path} で新しいセッションタブを開く`}
            >
              <span className="bookmark-marker">★</span>
              <span className="bookmark-label">
                <span className="bookmark-name">{bookmarkLabel(bookmark)}</span>
                <span className="bookmark-path">{collapseHome(bookmark.path)}</span>
              </span>
              <button
                className="bookmark-remove"
                title="ブックマークを削除"
                onClick={(e) => {
                  e.stopPropagation()
                  removeBookmark(bookmark.path)
                }}
              >
                ×
              </button>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="bookmarks-empty">
              {bookmarks.length === 0
                ? 'ブックマークはまだありません（タブの ★ でそのディレクトリを保存）'
                : '一致するブックマークがありません'}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <span className="modal-hint">↑↓ 選択 / Enter で開く / Esc で閉じる</span>
        </div>
      </div>
    </div>
  )
}
