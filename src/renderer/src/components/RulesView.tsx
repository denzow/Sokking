import { useEffect, useState } from 'react'
import { Delivery, PermissionMode, PERMISSION_MODES } from '../../../shared/runs'
import {
  DEFAULT_MAX_PARALLEL_RUNS,
  DEFAULT_RULE_INTERVAL_SECONDS,
  MIN_RULE_INTERVAL_SECONDS,
  Rule,
  RuleInput,
  SETTING_MAX_PARALLEL_RUNS
} from '../../../shared/rules'
import { useRulesStore } from '../stores/rules'
import type { AutoStatus } from '../../../shared/ipc'

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
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface RuleDraft {
  id: number | null
  name: string
  workdir: string
  query: string
  intervalMinutes: string
  auto: boolean
  permissionMode: PermissionMode
  delivery: Delivery
  pushBranch: string
  promptTemplate: string
  enabled: boolean
}

function emptyDraft(): RuleDraft {
  return {
    id: null,
    name: '',
    workdir: '',
    query: 'label:agent-ready',
    intervalMinutes: String(DEFAULT_RULE_INTERVAL_SECONDS / 60),
    auto: false,
    permissionMode: 'acceptEdits',
    delivery: 'pr',
    pushBranch: '',
    promptTemplate: '',
    enabled: true
  }
}

function draftFromRule(r: Rule): RuleDraft {
  return {
    id: r.id,
    name: r.name,
    workdir: abbreviateHome(r.workdir),
    query: r.query,
    intervalMinutes: String(Math.round(r.intervalSeconds / 60)),
    auto: r.auto,
    permissionMode: r.permissionMode,
    delivery: r.delivery,
    pushBranch: r.pushBranch ?? '',
    promptTemplate: r.promptTemplate ?? '',
    enabled: r.enabled
  }
}

/** GitHub rules: what to search, how often, and whether to start work unasked. */
export function RulesView(): React.JSX.Element {
  const rules = useRulesStore((s) => s.rules)
  const loaded = useRulesStore((s) => s.loaded)
  const error = useRulesStore((s) => s.error)
  const clearError = useRulesStore((s) => s.clearError)
  const [draft, setDraft] = useState<RuleDraft | null>(null)
  const [maxParallel, setMaxParallel] = useState<string>('')
  const [auto, setAuto] = useState<AutoStatus | null>(null)

  useEffect(() => {
    void useRulesStore.getState().refresh()
    void window.sokking.settingGet(SETTING_MAX_PARALLEL_RUNS).then((v) => {
      setMaxParallel(v ?? String(DEFAULT_MAX_PARALLEL_RUNS))
    })
    const refreshAuto = (): void => {
      void window.sokking.autoStatus().then(setAuto)
    }
    refreshAuto()
    const timer = window.setInterval(refreshAuto, 5000)
    return () => window.clearInterval(timer)
  }, [rules])

  const commitMaxParallel = (): void => {
    const n = Math.floor(Number(maxParallel))
    if (!Number.isFinite(n) || n < 1) {
      setMaxParallel(String(DEFAULT_MAX_PARALLEL_RUNS))
      return
    }
    void window.sokking.settingSet(SETTING_MAX_PARALLEL_RUNS, String(n))
  }

  return (
    <div className="notif-view">
      <div className="notif-header">
        <span className="notif-title">ルール</span>
        <label className="notif-switch" title="自動処理で同時に開く処理タブの上限">
          並列上限
          <input
            className="rules-parallel"
            type="number"
            min={1}
            value={maxParallel}
            onChange={(e) => setMaxParallel(e.target.value)}
            onBlur={commitMaxParallel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitMaxParallel()
            }}
          />
        </label>
        {auto && (
          <span className="notif-switch" title="自動処理の状態">
            実行中 {auto.openRuns} / 待ち {auto.pending}
            {auto.rateLimit.pausedUntil && (
              <>
                <span className="rule-row-error">
                  {' '}
                  レート制限のため {formatTime(auto.rateLimit.pausedUntil)} まで停止
                </span>
                <button
                  className="start-run-link"
                  onClick={() => void window.sokking.autoResume().then(() => window.sokking.autoStatus().then(setAuto))}
                >
                  再開
                </button>
              </>
            )}
          </span>
        )}
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
      <div className="rules-list">
        {!loaded ? (
          <div className="taskbox-empty">読み込み中…</div>
        ) : rules.length === 0 ? (
          <div className="taskbox-empty">
            ルールがありません。リポジトリと GitHub の検索条件を登録すると、合致する Issue を定期的にタスクボックスへ取り込みます。
          </div>
        ) : (
          rules.map((r) => <RuleRow key={r.id} rule={r} onEdit={() => setDraft(draftFromRule(r))} />)
        )}
      </div>
      {draft && <RuleEditor draft={draft} onClose={() => setDraft(null)} />}
    </div>
  )
}

function RuleRow({ rule, onEdit }: { rule: Rule; onEdit: () => void }): React.JSX.Element {
  const update = useRulesStore((s) => s.update)
  const remove = useRulesStore((s) => s.remove)
  const check = useRulesStore((s) => s.check)
  const checking = useRulesStore((s) => s.checking.includes(rule.id))
  const [confirm, setConfirm] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const toInput = (enabled: boolean): RuleInput => ({
    name: rule.name,
    workdir: rule.workdir,
    query: rule.query,
    intervalSeconds: rule.intervalSeconds,
    auto: rule.auto,
    permissionMode: rule.permissionMode,
    delivery: rule.delivery,
    pushBranch: rule.pushBranch,
    promptTemplate: rule.promptTemplate,
    enabled
  })

  return (
    <div className={`rule-row${rule.enabled ? '' : ' disabled'}`}>
      <div className="rule-row-head">
        <input
          type="checkbox"
          checked={rule.enabled}
          title={rule.enabled ? '無効にする' : '有効にする'}
          onChange={(e) => void update(rule.id, toInput(e.target.checked))}
        />
        <span className="rule-row-name" onClick={onEdit} title="クリックで編集">
          {rule.name}
        </span>
        {rule.auto && (
          <span className="notif-result accepted" title="取り込んだら自動で処理を始める">
            自動
          </span>
        )}
        <span className="notif-spacer" />
        <button
          className="start-run-link"
          disabled={checking}
          onClick={() => void check(rule.id).then(setMessage)}
        >
          {checking ? '検索中…' : '今すぐ確認'}
        </button>
        {confirm ? (
          <button
            className="icon-button danger"
            onBlur={() => setConfirm(false)}
            onClick={() => void remove(rule.id)}
          >
            削除!
          </button>
        ) : (
          <button className="icon-button" title="削除" onClick={() => setConfirm(true)}>
            ×
          </button>
        )}
      </div>
      <div className="rule-row-detail">
        <code>{rule.query}</code>
        <span className="rule-row-dir">{abbreviateHome(rule.workdir)}</span>
        <span>{Math.round(rule.intervalSeconds / 60)} 分ごと</span>
        <span>{rule.permissionMode}</span>
        <span>{rule.delivery === 'pr' ? 'PR' : `push → ${rule.pushBranch}`}</span>
      </div>
      <div className="rule-row-status">
        {rule.lastCheckedAt ? `最終確認 ${formatTime(rule.lastCheckedAt)}` : '未確認'}
        {rule.lastError && <span className="rule-row-error"> {rule.lastError}</span>}
        {message && <span className="rule-row-message"> {message}</span>}
      </div>
    </div>
  )
}

function RuleEditor({ draft, onClose }: { draft: RuleDraft; onClose: () => void }): React.JSX.Element {
  const add = useRulesStore((s) => s.add)
  const update = useRulesStore((s) => s.update)
  const [d, setD] = useState(draft)
  const [busy, setBusy] = useState(false)
  const patch = (p: Partial<RuleDraft>): void => setD((prev) => ({ ...prev, ...p }))

  const minutes = Number(d.intervalMinutes)
  const canSave =
    d.name.trim() !== '' &&
    d.workdir.trim() !== '' &&
    d.query.trim() !== '' &&
    Number.isFinite(minutes) &&
    minutes * 60 >= MIN_RULE_INTERVAL_SECONDS &&
    (d.delivery !== 'push' || d.pushBranch.trim() !== '') &&
    !busy

  const save = async (): Promise<void> => {
    if (!canSave) return
    setBusy(true)
    const input: RuleInput = {
      name: d.name,
      workdir: expandHome(d.workdir.trim()),
      query: d.query,
      intervalSeconds: Math.round(minutes * 60),
      auto: d.auto,
      permissionMode: d.permissionMode,
      delivery: d.delivery,
      pushBranch: d.delivery === 'push' ? d.pushBranch : null,
      promptTemplate: d.promptTemplate.trim() || null,
      enabled: d.enabled
    }
    const saved = d.id === null ? await add(input) : await update(d.id, input)
    setBusy(false)
    if (saved) onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal start-run-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{d.id === null ? 'ルールを追加' : 'ルールを編集'}</span>
          <button className="icon-button" onClick={onClose} title="閉じる">
            ×
          </button>
        </div>
        <div className="modal-body start-run-body">
          <div className="start-run-row">
            <label className="start-run-field">
              ルール名
              <input autoFocus value={d.name} onChange={(e) => patch({ name: e.target.value })} />
            </label>
            <label className="start-run-field">
              確認の間隔 (分)
              <input
                type="number"
                min={1}
                value={d.intervalMinutes}
                onChange={(e) => patch({ intervalMinutes: e.target.value })}
              />
            </label>
          </div>
          <label className="start-run-field">
            作業ディレクトリ (リポジトリのチェックアウト。gh はここの remote からリポジトリを判定する)
            <input
              placeholder="例: ~/work/app"
              value={d.workdir}
              onChange={(e) => patch({ workdir: e.target.value })}
            />
          </label>
          <label className="start-run-field">
            検索条件 (gh issue list --search に渡す。open な Issue だけが対象)
            <input
              placeholder="例: label:agent-ready"
              value={d.query}
              onChange={(e) => patch({ query: e.target.value })}
            />
          </label>
          <label className="start-run-check">
            <input type="checkbox" checked={d.auto} onChange={(e) => patch({ auto: e.target.checked })} />
            取り込んだら自動で処理を始める (Issue ごとの worktree で Claude Code を起動)
          </label>
          <div className="start-run-row">
            <label className="start-run-field">
              権限モード
              <select
                value={d.permissionMode}
                onChange={(e) => patch({ permissionMode: e.target.value as PermissionMode })}
              >
                {PERMISSION_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="start-run-field">
              成果の形
              <select value={d.delivery} onChange={(e) => patch({ delivery: e.target.value as Delivery })}>
                <option value="pr">PR を作る</option>
                <option value="push">ブランチへ直接 push</option>
              </select>
            </label>
            {d.delivery === 'push' && (
              <label className="start-run-field">
                push 先ブランチ
                <input value={d.pushBranch} onChange={(e) => patch({ pushBranch: e.target.value })} />
              </label>
            )}
          </div>
          <label className="start-run-field">
            プロンプトのテンプレート (任意。空なら既定。{'{title} {body} {sourceRef} {delivery}'} を置換)
            <textarea
              rows={5}
              value={d.promptTemplate}
              onChange={(e) => patch({ promptTemplate: e.target.value })}
            />
          </label>
        </div>
        <div className="modal-footer start-run-footer">
          <button onClick={onClose}>キャンセル</button>
          <button className="primary" disabled={!canSave} onClick={() => void save()}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
