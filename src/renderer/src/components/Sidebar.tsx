import { useEffect, useRef, useState } from 'react'
import { Tab, tabLabel, useTabsStore } from '../stores/tabs'
import { useBookmarksStore } from '../stores/bookmarks'
import { useNotificationsStore } from '../stores/notifications'
import { formatBinding, useKeybindingsStore } from '../stores/keybindings'
import { selectInboxCount, useTasksStore } from '../stores/tasks'
import { closeTab } from '../tab-actions'

interface SidebarProps {
  /** Which main view is showing — highlights the matching nav entry. */
  view: 'tabs' | 'taskbox'
  onShowTaskBox: () => void
  /** A session tab was clicked: the main area should show the tabs view. */
  onTabSelected: () => void
  onOpenSettings: () => void
  onOpenBookmarks: () => void
  onOpenNotifications: () => void
  /** Narrow rail mode (workspace panel showing): tabs shrink to their first
      character, footer buttons to their icons — the workspace gets the room. */
  collapsed: boolean
}

const WIDTH_KEY = 'sokking.sidebarWidth'
const DEFAULT_WIDTH = 230
const MIN_WIDTH = 140
const MAX_WIDTH = 500

function loadWidth(): number {
  const raw = Number(localStorage.getItem(WIDTH_KEY))
  return Number.isFinite(raw) && raw >= MIN_WIDTH && raw <= MAX_WIDTH ? raw : DEFAULT_WIDTH
}

export function Sidebar({
  view,
  onShowTaskBox,
  onTabSelected,
  onOpenSettings,
  onOpenBookmarks,
  onOpenNotifications,
  collapsed
}: SidebarProps): React.JSX.Element {
  const tabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const addTab = useTabsStore((s) => s.addTab)
  const bookmarksCombo = useKeybindingsStore((s) => formatBinding(s.bindings.openBookmarks))
  const unreadNotifs = useNotificationsStore((s) => s.unread)
  const inboxCount = useTasksStore(selectInboxCount)
  const [width, setWidth] = useState(loadWidth)
  // Width changes animate (the workspace collapse) — except while dragging
  // the resizer, where the transition would rubber-band behind the cursor.
  const [resizing, setResizing] = useState(false)

  // Pointer capture keeps the drag alive even when the cursor crosses into
  // the xterm canvas; the terminals refit themselves via ResizeObserver.
  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const handle = e.currentTarget
    try {
      handle.setPointerCapture(e.pointerId)
    } catch {
      // No capturable pointer (e.g. the pointer was already released) —
      // the drag still works while the cursor stays on the handle.
    }
    setResizing(true)
    // The sidebar's left edge is the window's left edge, so clientX is the width.
    const onMove = (ev: PointerEvent): void =>
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, ev.clientX)))
    const onUp = (): void => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      setResizing(false)
      setWidth((w) => {
        localStorage.setItem(WIDTH_KEY, String(w))
        return w
      })
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
  }

  const resetWidth = (): void => {
    setWidth(DEFAULT_WIDTH)
    localStorage.setItem(WIDTH_KEY, String(DEFAULT_WIDTH))
  }

  return (
    <div
      className={`sidebar${collapsed ? ' collapsed' : ''}${resizing ? ' resizing' : ''}`}
      style={collapsed ? undefined : { width }}
    >
      {/* Fixed entries above the session tabs: the places work comes from. */}
      <div className="sidebar-nav">
        <button
          className={`sidebar-nav-item${view === 'taskbox' ? ' active' : ''}`}
          onClick={onShowTaskBox}
          title={`タスクボックス${inboxCount > 0 ? ` (受信箱 ${inboxCount} 件)` : ''}`}
        >
          <span className="sidebar-nav-icon">▤</span>
          {!collapsed && <span className="sidebar-nav-label">タスクボックス</span>}
          {inboxCount > 0 &&
            (collapsed ? (
              <span className="unread-dot" />
            ) : (
              <span className="sidebar-nav-badge">{inboxCount}</span>
            ))}
        </button>
      </div>
      <div className="sidebar-tabs">
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            active={view === 'tabs' && tab.id === activeTabId}
            collapsed={collapsed}
            onSelected={onTabSelected}
          />
        ))}
      </div>
      <div className="sidebar-footer">
        <button
          className="sidebar-button"
          onClick={() => {
            addTab()
            onTabSelected()
          }}
          title="新しいセッションタブ"
        >
          ＋{!collapsed && ' 新しいセッションタブ'}
        </button>
        <button
          className="sidebar-button"
          onClick={onOpenBookmarks}
          title={`ブックマーク一覧 (${bookmarksCombo})`}
        >
          ≡{!collapsed && ' ブックマーク一覧'}
        </button>
        <button
          className="sidebar-button"
          onClick={onOpenNotifications}
          title="通知一覧（全タブ共通）"
        >
          ⚑{!collapsed && ' 通知'}
          {unreadNotifs > 0 &&
            (collapsed ? (
              <span className="unread-dot" />
            ) : (
              <span className="unread-badge">({unreadNotifs})</span>
            ))}
        </button>
        <button className="sidebar-button" onClick={onOpenSettings} title="設定">
          ⚙{!collapsed && ' 設定'}
        </button>
      </div>
      {!collapsed && (
        <div
          className="sidebar-resizer"
          onPointerDown={onResizeStart}
          onDoubleClick={resetWidth}
          title="ドラッグで幅を変更 / ダブルクリックで既定幅に戻す"
        />
      )}
    </div>
  )
}

function TabItem({
  tab,
  active,
  collapsed,
  onSelected
}: {
  tab: Tab
  active: boolean
  collapsed: boolean
  onSelected: () => void
}): React.JSX.Element {
  const activateTabInStore = useTabsStore((s) => s.activateTab)
  const renameTab = useTabsStore((s) => s.renameTab)
  const activateTab = (tabId: string): void => {
    activateTabInStore(tabId)
    onSelected()
  }
  const toggleBookmark = useBookmarksStore((s) => s.toggleBookmark)
  const bookmarked = useBookmarksStore((s) => s.isBookmarked(tab.cwd))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  // Keep the active row visible however it was activated — the tab-switch
  // shortcuts and the tab search change the active tab without a click, and
  // the list scrolls, so the row can be outside the viewport.
  useEffect(() => {
    if (active) rootRef.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const commitRename = (): void => {
    renameTab(tab.id, draft.trim() || null)
    setEditing(false)
  }

  if (collapsed) {
    // Rail mode: the status marker plus the label's first character; the
    // full label and cwd move into the tooltip. No rename/bookmark/close —
    // those need the expanded row.
    const label = tabLabel(tab)
    return (
      <div
        ref={rootRef}
        className={`tab-item${active ? ' active' : ''}${tab.attention ? ' attention' : ''}`}
        onClick={() => activateTab(tab.id)}
        title={`${label}${tab.cwd ? `\n${tab.cwd}` : ''}${tab.activityMessage ? `\n${tab.activityMessage}` : ''}`}
      >
        <span className={`tab-marker${tab.activity ? ` ${tab.activity}` : ''}`}>
          {tab.activity ? '' : '❯'}
        </span>
        <span className="tab-initial">{[...label][0] ?? '?'}</span>
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className={`tab-item${active ? ' active' : ''}${tab.attention ? ' attention' : ''}`}
      onClick={() => activateTab(tab.id)}
      onDoubleClick={() => {
        setDraft(tab.title ?? '')
        setEditing(true)
      }}
      title={tab.activityMessage || tab.cwd}
    >
      {/* Marker column: a prompt caret for a plain shell, or the Claude Code
          session lamp (running / permission / idle) drawn by CSS. */}
      <span
        className={`tab-marker${tab.activity ? ` ${tab.activity}` : ''}`}
        title={
          tab.activity === 'running'
            ? 'Claude Code 実行中'
            : tab.activity === 'permission'
              ? 'Claude Code 許可待ち'
              : tab.activity === 'idle'
                ? 'Claude Code 入力待ち'
                : undefined
        }
      >
        {tab.activity ? '' : '❯'}
      </span>
      {editing ? (
        <input
          className="tab-rename-input"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') setEditing(false)
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="tab-label">
          <span className="tab-title">
            {tabLabel(tab)}
            {tab.runningProcess && (
              <span className="tab-process" title={`実行中: ${tab.runningProcess}`}>
                {tab.runningProcess}
              </span>
            )}
          </span>
          {tab.cwd && <span className="tab-cwd">{tab.cwd.replace(/^\/home\/[^/]+/, '~')}</span>}
        </span>
      )}
      {tab.cwd && (
        <button
          className={`tab-bookmark${bookmarked ? ' active' : ''}`}
          title={
            bookmarked ? 'このディレクトリのブックマークを解除' : 'このディレクトリをブックマーク'
          }
          onClick={(e) => {
            e.stopPropagation()
            toggleBookmark(tab.cwd)
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          ★
        </button>
      )}
      <button
        className="tab-close"
        title="セッションタブを閉じる"
        onClick={(e) => {
          e.stopPropagation()
          closeTab(tab.id, { ptyAlive: true })
        }}
      >
        ×
      </button>
    </div>
  )
}
