import { useEffect, useMemo, useRef, useState } from 'react'
import { FsAppInfo } from '../../../shared/ipc'
import {
  ACTIONS,
  ACTION_LABELS,
  formatBinding,
  GLOBAL_ACTIONS,
  normalizeKey,
  ShortcutAction,
  useKeybindingsStore,
  WORKSPACE_ACTIONS
} from '../stores/keybindings'
import {
  FONT_FAMILIES,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  THEMES,
  useAppearanceStore
} from '../stores/appearance'
import { useFileOpenersStore } from '../stores/file-openers'

const MODIFIER_KEYS = ['Control', 'Shift', 'Alt', 'Meta']

type Section = 'appearance' | 'shortcuts' | 'files'

interface SettingsProps {
  onClose: () => void
}

export function Settings({ onClose }: SettingsProps): React.JSX.Element {
  const [section, setSection] = useState<Section>('appearance')
  const setCapturing = useKeybindingsStore((s) => s.setCapturing)

  // Escape closes the dialog when not mid-capture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !useKeybindingsStore.getState().capturing) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const close = (): void => {
    setCapturing(null)
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">設定</span>
          <button className="icon-button" onClick={close} title="閉じる">
            ×
          </button>
        </div>
        <div className="settings-body">
          <nav className="settings-nav">
            <button
              className={`settings-nav-item${section === 'appearance' ? ' active' : ''}`}
              onClick={() => setSection('appearance')}
            >
              外観
            </button>
            <button
              className={`settings-nav-item${section === 'shortcuts' ? ' active' : ''}`}
              onClick={() => setSection('shortcuts')}
            >
              ショートカット
            </button>
            <button
              className={`settings-nav-item${section === 'files' ? ' active' : ''}`}
              onClick={() => setSection('files')}
            >
              ファイル
            </button>
          </nav>
          <div className="settings-content">
            {section === 'appearance' && <AppearanceSettings />}
            {section === 'shortcuts' && <ShortcutSettings />}
            {section === 'files' && <FileOpenerSettings />}
          </div>
        </div>
      </div>
    </div>
  )
}

function AppearanceSettings(): React.JSX.Element {
  const themeKey = useAppearanceStore((s) => s.themeKey)
  const fontFamily = useAppearanceStore((s) => s.fontFamily)
  const fontSize = useAppearanceStore((s) => s.fontSize)
  const setTheme = useAppearanceStore((s) => s.setTheme)
  const setFontFamily = useAppearanceStore((s) => s.setFontFamily)
  const setFontSize = useAppearanceStore((s) => s.setFontSize)

  return (
    <div className="appearance-settings">
      <div className="setting-group">
        <span className="setting-label">カラースキーム</span>
        <div className="theme-grid">
          {THEMES.map((theme) => (
            <button
              key={theme.key}
              className={`theme-card${themeKey === theme.key ? ' active' : ''}`}
              onClick={() => setTheme(theme.key)}
              title={theme.name}
              style={{ background: theme.terminal.background, color: theme.terminal.foreground }}
            >
              <span className="theme-swatches">
                <span style={{ background: theme.terminal.red }} />
                <span style={{ background: theme.terminal.green }} />
                <span style={{ background: theme.terminal.blue }} />
                <span style={{ background: theme.ui.accent }} />
              </span>
              <span className="theme-name">{theme.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="setting-group">
        <span className="setting-label">フォント</span>
        <select
          className="setting-input"
          value={FONT_FAMILIES.includes(fontFamily) ? fontFamily : ''}
          onChange={(e) => setFontFamily(e.target.value)}
        >
          {!FONT_FAMILIES.includes(fontFamily) && <option value="">{fontFamily}（カスタム）</option>}
          {FONT_FAMILIES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

      <div className="setting-group">
        <span className="setting-label">フォントサイズ</span>
        <div className="font-size-row">
          <input
            type="range"
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
          />
          <input
            type="number"
            className="setting-input font-size-input"
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
          />
          <span className="font-size-unit">px</span>
        </div>
      </div>
    </div>
  )
}

function FileOpenerSettings(): React.JSX.Element {
  const openers = useFileOpenersStore((s) => s.openers)
  const addOpener = useFileOpenersStore((s) => s.addOpener)
  const updateOpener = useFileOpenersStore((s) => s.updateOpener)
  const removeOpener = useFileOpenersStore((s) => s.removeOpener)
  const [apps, setApps] = useState<FsAppInfo[] | null>(null)
  const [mimeTypes, setMimeTypes] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    void window.sokking.fsListApps().then((list) => {
      if (!cancelled) setApps(list)
    })
    void window.sokking.fsListMimeTypes().then((list) => {
      if (!cancelled) setMimeTypes(list)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Same normalized pattern on two rows: the rows conflict (matching can't
  // order them), flag both.
  const patternCount = new Map<string, number>()
  for (const o of openers) {
    if (o.pattern) patternCount.set(o.pattern, (patternCount.get(o.pattern) ?? 0) + 1)
  }

  return (
    <div className="file-opener-settings">
      <div className="setting-group">
        <span className="setting-label">拡張子・MIME タイプごとに開くアプリ</span>
        {openers.map((o, i) => {
          const conflict = o.pattern !== '' && (patternCount.get(o.pattern) ?? 0) > 1
          // A configured app may have been uninstalled — keep it selectable
          // so the row still shows what it points to.
          const missing =
            apps !== null && o.desktopFile !== '' && !apps.some((a) => a.desktopFile === o.desktopFile)
          return (
            <div className="file-opener-row" key={i}>
              <input
                className={`setting-input file-opener-ext${conflict ? ' conflict' : ''}`}
                value={o.pattern}
                placeholder="拡張子 / MIME"
                list="mime-type-options"
                onChange={(e) => updateOpener(i, { pattern: e.target.value })}
                title={conflict ? '同じパターンが複数あります' : '例: png / tar.gz / image/* / text/plain'}
              />
              <AppCombobox
                apps={apps ?? []}
                label={
                  o.desktopFile === ''
                    ? ''
                    : missing
                      ? `${o.appName}（見つかりません）`
                      : o.appName
                }
                onSelect={(a) => updateOpener(i, { desktopFile: a.desktopFile, appName: a.name })}
              />
              <button
                className="keybind-reset"
                onClick={() => removeOpener(i)}
                title="この行を削除"
              >
                ×
              </button>
            </div>
          )
        })}
        <button className="sidebar-button" onClick={addOpener}>
          ＋ 追加
        </button>
        {/* Shared completion source for every pattern input: the system's
            known MIME types plus type/* wildcards. */}
        <datalist id="mime-type-options">
          {mimeTypes.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>
      <div className="settings-hint">
        workspace パネルからアプリでファイルを開くとき（Shift+Enter・右クリックの「開く」、
        またはエディタで開けないバイナリのフォールバック）、パターンが一致すれば指定のアプリで開きます。
        「/」を含む指定は MIME タイプ（image/* のようなワイルドカード可）として扱い、拡張子の一致が MIME
        の一致より優先されます。どれにも一致しないファイルは OS の既定アプリで開きます。
      </div>
    </div>
  )
}

interface AppComboboxProps {
  apps: FsAppInfo[]
  /** Display name of the current choice; '' while nothing is selected. */
  label: string
  onSelect: (app: FsAppInfo) => void
}

/**
 * Searchable app picker: a button showing the current choice that opens an
 * incremental-search list (same AND term matching as the bookmarks palette).
 */
function AppCombobox({ apps, label, onSelect }: AppComboboxProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return apps
    return apps.filter((a) => terms.every((t) => a.name.toLowerCase().includes(t)))
  }, [apps, query])
  const clampedSelected = Math.min(selected, Math.max(0, filtered.length - 1))

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Keep the highlighted row visible while stepping with ↑/↓.
  useEffect(() => {
    listRef.current?.querySelector('.app-combobox-item.selected')?.scrollIntoView({ block: 'nearest' })
  }, [clampedSelected, filtered])

  const openList = (): void => {
    setQuery('')
    setSelected(0)
    setOpen(true)
  }

  const choose = (app: FsAppInfo): void => {
    onSelect(app)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      // Close only the list — keep the settings modal (whose window-level
      // Escape handler this stops) open.
      e.stopPropagation()
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(Math.min(clampedSelected + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(Math.max(clampedSelected - 1, 0))
    } else if (e.key === 'Enter') {
      const app = filtered[clampedSelected]
      if (app) choose(app)
    }
  }

  return (
    <div
      className="app-combobox"
      ref={wrapperRef}
      onBlur={(e) => {
        // Focus left the combobox entirely (not just moved within it).
        if (!wrapperRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      {open ? (
        <input
          ref={inputRef}
          className="setting-input file-opener-app"
          placeholder={label || 'アプリを検索…'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0)
          }}
          onKeyDown={onKeyDown}
        />
      ) : (
        <button
          className={`setting-input file-opener-app app-combobox-button${label ? '' : ' placeholder'}`}
          onClick={openList}
          title="クリックして検索"
        >
          {label || '（アプリを選択）'}
        </button>
      )}
      {open && (
        <div className="app-combobox-list" ref={listRef}>
          {filtered.map((a, index) => (
            <div
              key={a.desktopFile}
              className={`app-combobox-item${index === clampedSelected ? ' selected' : ''}`}
              // onClick would be too late: the input's blur closes the list first.
              onMouseDown={(e) => {
                e.preventDefault()
                choose(a)
              }}
              onMouseMove={() => setSelected(index)}
            >
              {a.name}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="app-combobox-empty">
              {apps.length === 0 ? '読み込み中…' : '一致するアプリがありません'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ShortcutSettings(): React.JSX.Element {
  const bindings = useKeybindingsStore((s) => s.bindings)
  const capturing = useKeybindingsStore((s) => s.capturing)
  const setBinding = useKeybindingsStore((s) => s.setBinding)
  const resetBinding = useKeybindingsStore((s) => s.resetBinding)
  const setCapturing = useKeybindingsStore((s) => s.setCapturing)

  // While capturing, grab the next key combo (capture phase so it preempts the
  // global shortcut handler and xterm). A lone modifier is ignored; Escape aborts.
  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (MODIFIER_KEYS.includes(e.key)) return
      if (e.key === 'Escape') {
        setCapturing(null)
        return
      }
      setBinding(capturing, {
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey,
        key: normalizeKey(e.key)
      })
      setCapturing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, setBinding, setCapturing])

  // Detect duplicate combos so the user can spot conflicts.
  const seen = new Map<string, number>()
  for (const a of [...ACTIONS, ...WORKSPACE_ACTIONS, ...GLOBAL_ACTIONS]) {
    const k = formatBinding(bindings[a])
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }

  const renderRow = (action: ShortcutAction): React.JSX.Element => {
    const combo = formatBinding(bindings[action])
    const conflict = (seen.get(combo) ?? 0) > 1
    return (
      <div className="keybind-row" key={action}>
        <span className="keybind-label">{ACTION_LABELS[action]}</span>
        <button
          className={[
            'keybind-combo',
            capturing === action ? 'capturing' : '',
            conflict ? 'conflict' : ''
          ].join(' ')}
          onClick={() => setCapturing(capturing === action ? null : action)}
          title={conflict ? '他の操作と重複しています' : 'クリックして新しいキーを押す'}
        >
          {capturing === action ? 'キーを押す…' : combo}
        </button>
        <button
          className="keybind-reset"
          onClick={() => resetBinding(action)}
          title="デフォルトに戻す"
        >
          ↺
        </button>
      </div>
    )
  }

  return (
    <div className="shortcut-settings">
      <div className="keybind-group-title">グローバル</div>
      {ACTIONS.map(renderRow)}
      <div className="keybind-group-title">
        ワークスペース — workspace パネル表示中のみ（Esc を2回でパネルメニューへ）
      </div>
      {WORKSPACE_ACTIONS.map(renderRow)}
      <div className="keybind-group-title">OS グローバル — sokking が非アクティブでも効きます</div>
      {GLOBAL_ACTIONS.map(renderRow)}
      <div className="settings-hint">
        割り当てるにはキー欄をクリックして希望のキーを押してください（Esc で中止）。
      </div>
    </div>
  )
}
