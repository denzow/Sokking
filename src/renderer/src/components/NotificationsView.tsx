import { useEffect, useState } from 'react'
import {
  FilterAction,
  NotificationFilter,
  NotificationFilterInput,
  NotificationLogEntry,
  SETTING_NOTIFICATION_DEFAULT_ACTION,
  SETTING_NOTIFICATION_MONITOR_ENABLED
} from '../../../shared/notifications'
import { useIntakeStore } from '../stores/notification-intake'

function expandHome(dir: string): string {
  const home = window.sokking.homeDir
  if (!home) return dir
  if (dir === '~') return home
  return dir.startsWith('~/') ? home + dir.slice(1) : dir
}

function abbreviateHome(dir: string): string {
  const home = window.sokking.homeDir
  if (home && (dir === home || dir.startsWith(home + '/'))) return '~' + dir.slice(home.length)
  return dir
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Escapes a literal so it matches itself as a regular expression. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface FilterDraft {
  id: number | null
  name: string
  enabled: boolean
  appPattern: string
  titlePattern: string
  bodyPattern: string
  action: FilterAction
  workdir: string
}

function emptyDraft(): FilterDraft {
  return {
    id: null,
    name: '',
    enabled: true,
    appPattern: '',
    titlePattern: '',
    bodyPattern: '',
    action: 'accept',
    workdir: ''
  }
}

function draftFromFilter(f: NotificationFilter): FilterDraft {
  return {
    id: f.id,
    name: f.name,
    enabled: f.enabled,
    appPattern: f.appPattern,
    titlePattern: f.titlePattern,
    bodyPattern: f.bodyPattern,
    action: f.action,
    workdir: f.workdir ? abbreviateHome(f.workdir) : ''
  }
}

function draftFromEntry(e: NotificationLogEntry): FilterDraft {
  return {
    ...emptyDraft(),
    name: `${e.app}: ${e.title}`.slice(0, 60),
    appPattern: `^${escapeRegExp(e.app)}$`,
    titlePattern: escapeRegExp(e.title)
  }
}

/**
 * Desktop-notification intake: what arrived (and what became of it), the
 * rules, and the monitor switch. Rules are drafted from log rows so the
 * patterns start from a real notification instead of a blank form.
 */
export function NotificationsView(): React.JSX.Element {
  const filters = useIntakeStore((s) => s.filters)
  const log = useIntakeStore((s) => s.log)
  const status = useIntakeStore((s) => s.status)
  const error = useIntakeStore((s) => s.error)
  const clearError = useIntakeStore((s) => s.clearError)
  const setSetting = useIntakeStore((s) => s.setSetting)
  const clearLog = useIntakeStore((s) => s.clearLog)
  const markSeen = useIntakeStore((s) => s.markSeen)
  const [draft, setDraft] = useState<FilterDraft | null>(null)

  useEffect(() => {
    const s = useIntakeStore.getState()
    void s.refreshFilters()
    void s.refreshLog()
    void s.refreshStatus()
    markSeen()
  }, [markSeen])

  const filterName = (id: number | null): string =>
    id === null ? '既定' : (filters.find((f) => f.id === id)?.name ?? `#${id} (削除済み)`)

  return (
    <div className="notif-view">
      <div className="notif-header">
        <span className="notif-title">通知</span>
        <label className="notif-switch" title="デスクトップ通知の監視 (busctl)">
          <input
            type="checkbox"
            checked={status?.enabled ?? true}
            onChange={(e) =>
              void setSetting(SETTING_NOTIFICATION_MONITOR_ENABLED, e.target.checked ? 'true' : 'false')
            }
          />
          監視
          <span className={`notif-dot${status?.running ? ' on' : ''}`} />
        </label>
        <label className="notif-switch" title="どのルールにも合致しない通知の扱い">
          既定:
          <select
            value={status?.defaultAction ?? 'ignore'}
            onChange={(e) => void setSetting(SETTING_NOTIFICATION_DEFAULT_ACTION, e.target.value)}
          >
            <option value="ignore">無視する</option>
            <option value="accept">タスクにする</option>
          </select>
        </label>
        <span className="notif-spacer" />
        <button className="notif-button" onClick={() => setDraft(emptyDraft())}>
          ＋ ルール
        </button>
      </div>
      {error && (
        <div className="taskbox-error" onClick={clearError} title="クリックで閉じる">
          {error}
        </div>
      )}
      <div className="notif-body">
        <div className="notif-column notif-log">
          <div className="notif-column-header">
            <span>受信ログ</span>
            <span className="notif-column-count">{log.length}</span>
            <span className="notif-spacer" />
            {log.length > 0 && (
              <button className="start-run-link" onClick={() => void clearLog()}>
                クリア
              </button>
            )}
          </div>
          {log.length === 0 ? (
            <div className="taskbox-empty">
              まだ通知を受けていません。
              <br />
              <code>notify-send テスト 本文</code> で試せます。
            </div>
          ) : (
            log.map((e) => (
              <div key={e.id} className={`notif-row ${e.result}`}>
                <div className="notif-row-head">
                  <span className="task-source">{e.app || '(不明)'}</span>
                  <span className="notif-row-title">{e.title || '(要約なし)'}</span>
                  <span className="notif-row-time">{formatTime(e.receivedAt)}</span>
                </div>
                {e.body && <div className="notif-row-body">{e.body}</div>}
                <div className="notif-row-foot">
                  <span className={`notif-result ${e.result}`}>
                    {e.result === 'accepted' ? 'タスク化' : '無視'}
                  </span>
                  <span className="notif-row-filter">ルール: {filterName(e.matchedFilterId)}</span>
                  {e.taskId !== null && <span className="notif-row-task">task #{e.taskId}</span>}
                  <span className="notif-spacer" />
                  <button className="start-run-link" onClick={() => setDraft(draftFromEntry(e))}>
                    この通知でルールを作る
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="notif-column notif-filters">
          <div className="notif-column-header">
            <span>フィルタルール</span>
            <span className="notif-column-count">{filters.length}</span>
          </div>
          {filters.length === 0 && (
            <div className="taskbox-empty">
              ルールがありません。上から順に評価され、最初に合致したルールが通知の扱いを決めます。
            </div>
          )}
          {filters.map((f, index) => (
            <FilterRow
              key={f.id}
              filter={f}
              first={index === 0}
              last={index === filters.length - 1}
              onEdit={() => setDraft(draftFromFilter(f))}
            />
          ))}
        </div>
      </div>
      {draft && <FilterEditor draft={draft} onClose={() => setDraft(null)} />}
    </div>
  )
}

function FilterRow({
  filter,
  first,
  last,
  onEdit
}: {
  filter: NotificationFilter
  first: boolean
  last: boolean
  onEdit: () => void
}): React.JSX.Element {
  const filters = useIntakeStore((s) => s.filters)
  const updateFilter = useIntakeStore((s) => s.updateFilter)
  const removeFilter = useIntakeStore((s) => s.removeFilter)
  const reorderFilters = useIntakeStore((s) => s.reorderFilters)
  const [confirm, setConfirm] = useState(false)

  const move = (offset: number): void => {
    const ids = filters.map((f) => f.id)
    const i = ids.indexOf(filter.id)
    const j = i + offset
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    void reorderFilters(ids)
  }

  const toInput = (f: NotificationFilter, enabled: boolean): NotificationFilterInput => ({
    name: f.name,
    enabled,
    appPattern: f.appPattern,
    titlePattern: f.titlePattern,
    bodyPattern: f.bodyPattern,
    action: f.action,
    workdir: f.workdir,
    promptTemplate: f.promptTemplate
  })

  const patterns = [
    filter.appPattern && `app: ${filter.appPattern}`,
    filter.titlePattern && `要約: ${filter.titlePattern}`,
    filter.bodyPattern && `本文: ${filter.bodyPattern}`
  ].filter(Boolean)

  return (
    <div className={`filter-row${filter.enabled ? '' : ' disabled'}`}>
      <div className="filter-row-head">
        <input
          type="checkbox"
          checked={filter.enabled}
          title={filter.enabled ? '無効にする' : '有効にする'}
          onChange={(e) => void updateFilter(filter.id, toInput(filter, e.target.checked))}
        />
        <span className={`notif-result ${filter.action === 'accept' ? 'accepted' : 'ignored'}`}>
          {filter.action === 'accept' ? 'タスク化' : '無視'}
        </span>
        <span className="filter-row-name" onClick={onEdit} title="クリックで編集">
          {filter.name}
        </span>
        <button className="icon-button" disabled={first} title="上へ" onClick={() => move(-1)}>
          ↑
        </button>
        <button className="icon-button" disabled={last} title="下へ" onClick={() => move(1)}>
          ↓
        </button>
        {confirm ? (
          <button
            className="icon-button danger"
            title="本当に削除"
            onBlur={() => setConfirm(false)}
            onClick={() => void removeFilter(filter.id)}
          >
            削除!
          </button>
        ) : (
          <button className="icon-button" title="削除" onClick={() => setConfirm(true)}>
            ×
          </button>
        )}
      </div>
      <div className="filter-row-detail">
        {patterns.length ? patterns.join('  ') : '(すべての通知に合致)'}
        {filter.workdir && <span className="filter-row-dir"> → {abbreviateHome(filter.workdir)}</span>}
      </div>
    </div>
  )
}

function FilterEditor({ draft, onClose }: { draft: FilterDraft; onClose: () => void }): React.JSX.Element {
  const addFilter = useIntakeStore((s) => s.addFilter)
  const updateFilter = useIntakeStore((s) => s.updateFilter)
  const log = useIntakeStore((s) => s.log)
  const [d, setD] = useState(draft)
  const [busy, setBusy] = useState(false)

  const patch = (p: Partial<FilterDraft>): void => setD((prev) => ({ ...prev, ...p }))

  const matchCount = ((): number | null => {
    try {
      const re = (p: string): RegExp | null => (p ? new RegExp(p, 'i') : null)
      const [a, t, b] = [re(d.appPattern), re(d.titlePattern), re(d.bodyPattern)]
      return log.filter(
        (e) => (!a || a.test(e.app)) && (!t || t.test(e.title)) && (!b || b.test(e.body))
      ).length
    } catch {
      return null
    }
  })()

  const save = async (): Promise<void> => {
    if (!d.name.trim() || busy) return
    setBusy(true)
    const input: NotificationFilterInput = {
      name: d.name,
      enabled: d.enabled,
      appPattern: d.appPattern,
      titlePattern: d.titlePattern,
      bodyPattern: d.bodyPattern,
      action: d.action,
      workdir: d.action === 'accept' && d.workdir.trim() ? expandHome(d.workdir.trim()) : null,
      promptTemplate: null
    }
    const saved = d.id === null ? await addFilter(input) : await updateFilter(d.id, input)
    setBusy(false)
    if (saved) onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal filter-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{d.id === null ? 'ルールを追加' : 'ルールを編集'}</span>
          <button className="icon-button" onClick={onClose} title="閉じる">
            ×
          </button>
        </div>
        <div className="modal-body start-run-body">
          <label className="start-run-field">
            ルール名
            <input autoFocus value={d.name} onChange={(e) => patch({ name: e.target.value })} />
          </label>
          <div className="start-run-row">
            <label className="start-run-field">
              扱い
              <select value={d.action} onChange={(e) => patch({ action: e.target.value as FilterAction })}>
                <option value="accept">タスクにする</option>
                <option value="ignore">無視する</option>
              </select>
            </label>
            {d.action === 'accept' && (
              <label className="start-run-field">
                作業ディレクトリ (任意)
                <input
                  placeholder="例: ~/work/app"
                  value={d.workdir}
                  onChange={(e) => patch({ workdir: e.target.value })}
                />
              </label>
            )}
          </div>
          <label className="start-run-field">
            アプリ名 (正規表現、空なら何でも)
            <input
              placeholder="例: ^Slack$"
              value={d.appPattern}
              onChange={(e) => patch({ appPattern: e.target.value })}
            />
          </label>
          <label className="start-run-field">
            要約 (正規表現)
            <input
              placeholder="例: #dev-team"
              value={d.titlePattern}
              onChange={(e) => patch({ titlePattern: e.target.value })}
            />
          </label>
          <label className="start-run-field">
            本文 (正規表現)
            <input
              placeholder="例: @denzow"
              value={d.bodyPattern}
              onChange={(e) => patch({ bodyPattern: e.target.value })}
            />
          </label>
          <div className="notif-match-hint">
            {matchCount === null
              ? '正規表現が不正です'
              : `受信ログのうち ${matchCount} 件に合致します`}
          </div>
        </div>
        <div className="modal-footer start-run-footer">
          <button onClick={onClose}>キャンセル</button>
          <button className="primary" disabled={!d.name.trim() || busy || matchCount === null} onClick={() => void save()}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
