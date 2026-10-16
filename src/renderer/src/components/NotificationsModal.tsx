import { useEffect } from 'react'
import { NotificationItem, useNotificationsStore } from '../stores/notifications'
import { useTabsStore } from '../stores/tabs'

interface NotificationsModalProps {
  /** Jump to the notification's tab (App also flips the main area back to the terminal). */
  onJumpToTab: (tabId: string) => void
  onClose: () => void
}

/**
 * App-wide history of the notifications raised by Claude Code sessions
 * (permission / idle / stop) across every tab, newest first. Entries whose
 * tab is still open jump to it on click; entries can be removed one by one
 * or all at once.
 */
export function NotificationsModal({
  onJumpToTab,
  onClose
}: NotificationsModalProps): React.JSX.Element {
  const items = useNotificationsStore((s) => s.items)
  const unread = useNotificationsStore((s) => s.unread)
  const remove = useNotificationsStore((s) => s.remove)
  const clear = useNotificationsStore((s) => s.clear)
  const tabs = useTabsStore((s) => s.tabs)

  // Everything is read while the dialog is open (also as new notifications
  // stream in).
  useEffect(() => {
    if (unread > 0) useNotificationsStore.getState().markSeen()
  }, [unread])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const tabExists = (tabId: string): boolean => tabs.some((t) => t.id === tabId)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal notifications-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">通知{items.length > 0 ? ` (${items.length})` : ''}</span>
          <span className="notif-header-actions">
            <button className="notif-clear" onClick={clear} disabled={items.length === 0}>
              クリア
            </button>
            <button className="icon-button" onClick={onClose} title="閉じる">
              ×
            </button>
          </span>
        </div>

        {items.length === 0 ? (
          <div className="notif-empty">通知はありません</div>
        ) : (
          <div className="notif-list">
            {items.map((item) => (
              <div
                key={item.id}
                className={`notif-item kind-${item.kind}${tabExists(item.tabId) ? '' : ' gone'}`}
                onClick={tabExists(item.tabId) ? () => onJumpToTab(item.tabId) : undefined}
                title={tabExists(item.tabId) ? 'クリックでタブへ移動' : 'タブは閉じられています'}
              >
                <span className="notif-lamp" />
                <div className="notif-body">
                  <div className="notif-main">
                    {item.source && <span className="notif-source">[{item.source}]</span>}
                    <span className="notif-title">{item.title}</span>
                    <span className="notif-time">{formatTime(item.timestamp)}</span>
                  </div>
                  {item.message && <div className="notif-message">{item.message}</div>}
                </div>
                <button
                  className="notif-remove"
                  onClick={(e) => {
                    e.stopPropagation()
                    remove(item.id)
                  }}
                  title="この通知を削除"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="modal-footer">
          <span className="modal-hint">クリックで発生元のタブへ移動 / Esc で閉じる</span>
        </div>
      </div>
    </div>
  )
}

function formatTime(timestamp: NotificationItem['timestamp']): string {
  const d = new Date(timestamp)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
