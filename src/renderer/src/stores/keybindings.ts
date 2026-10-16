import { create } from 'zustand'

export type ShortcutAction =
  | 'newTab'
  | 'closeTab'
  | 'closeEditorTab'
  | 'wsFocusTree'
  | 'wsFocusEditor'
  | 'wsPrevEditorTab'
  | 'wsNextEditorTab'
  | 'panelLeft'
  | 'panelRight'
  | 'prevTab'
  | 'nextTab'
  | 'moveTabUp'
  | 'moveTabDown'
  | 'openBookmarks'
  | 'openNotifications'
  | 'openFileManager'
  | 'find'
  | 'copy'
  | 'paste'
  | 'globalActivate'

export interface KeyBinding {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  /** Normalized key: single chars uppercased (e.g. 'T'), named keys verbatim ('PageUp'). */
  key: string
}

export const ACTION_LABELS: Record<ShortcutAction, string> = {
  newTab: '新しいセッションタブ',
  closeTab: 'セッションタブを閉じる',
  closeEditorTab: '表示中のエディタタブを閉じる',
  wsFocusTree: 'ファイルツリーへフォーカス',
  wsFocusEditor: 'エディタへフォーカス',
  wsPrevEditorTab: '左のエディタタブへ',
  wsNextEditorTab: '右のエディタタブへ',
  panelLeft: '左のパネルへ',
  panelRight: '右のパネルへ',
  prevTab: '前のセッションタブ',
  nextTab: '次のセッションタブ',
  moveTabUp: 'セッションタブを上へ移動',
  moveTabDown: 'セッションタブを下へ移動',
  openBookmarks: 'ブックマーク一覧',
  openNotifications: '通知一覧',
  openFileManager: '現在のディレクトリをファイルマネージャーで開く',
  find: '検索 (ターミナル / workspace 内)',
  copy: 'コピー (ターミナル)',
  paste: '貼り付け (ターミナル)',
  globalActivate: 'sokking を前面に出す / 最小化'
}

/** App-wide actions (the グローバル settings group), in settings-UI order;
    matched against renderer keydowns. */
export const ACTIONS: ShortcutAction[] = [
  'newTab',
  'closeTab',
  'panelLeft',
  'panelRight',
  'prevTab',
  'nextTab',
  'moveTabUp',
  'moveTabDown',
  'openBookmarks',
  'openNotifications',
  'openFileManager',
  'find',
  'copy',
  'paste'
]

/** Workspace-panel actions: matched like ACTIONS but they only fire while
    the workspace panel is showing (App drops them elsewhere, TerminalView
    passes them through to the shell). */
export const WORKSPACE_ACTIONS: ShortcutAction[] = [
  'wsFocusTree',
  'wsFocusEditor',
  'wsPrevEditorTab',
  'wsNextEditorTab',
  'closeEditorTab'
]

/** OS-level hotkeys: registered in main via globalShortcut, never matched here. */
export const GLOBAL_ACTIONS: ShortcutAction[] = ['globalActivate']

const ALL_ACTIONS: ShortcutAction[] = [...ACTIONS, ...WORKSPACE_ACTIONS, ...GLOBAL_ACTIONS]

const DEFAULT_BINDINGS: Record<ShortcutAction, KeyBinding> = {
  newTab: { ctrl: true, shift: true, alt: false, meta: false, key: 'T' },
  closeTab: { ctrl: true, shift: true, alt: false, meta: false, key: 'W' },
  // The workspace combos are free to shadow shell keys (Ctrl+W word-delete,
  // Ctrl+E end-of-line): they only fire while the workspace panel is
  // showing — the terminal passes them through.
  closeEditorTab: { ctrl: true, shift: false, alt: false, meta: false, key: 'W' },
  wsFocusTree: { ctrl: true, shift: true, alt: false, meta: false, key: 'E' },
  wsFocusEditor: { ctrl: true, shift: false, alt: false, meta: false, key: 'E' },
  wsPrevEditorTab: { ctrl: true, shift: false, alt: false, meta: false, key: 'PageUp' },
  wsNextEditorTab: { ctrl: true, shift: false, alt: false, meta: false, key: 'PageDown' },
  panelLeft: { ctrl: true, shift: false, alt: false, meta: false, key: 'ArrowLeft' },
  panelRight: { ctrl: true, shift: false, alt: false, meta: false, key: 'ArrowRight' },
  prevTab: { ctrl: true, shift: false, alt: false, meta: false, key: 'ArrowUp' },
  nextTab: { ctrl: true, shift: false, alt: false, meta: false, key: 'ArrowDown' },
  moveTabUp: { ctrl: true, shift: true, alt: false, meta: false, key: 'ArrowUp' },
  moveTabDown: { ctrl: true, shift: true, alt: false, meta: false, key: 'ArrowDown' },
  openBookmarks: { ctrl: true, shift: true, alt: false, meta: false, key: 'B' },
  openNotifications: { ctrl: true, shift: true, alt: false, meta: false, key: 'N' },
  openFileManager: { ctrl: true, shift: true, alt: false, meta: false, key: 'O' },
  find: { ctrl: true, shift: true, alt: false, meta: false, key: 'F' },
  copy: { ctrl: true, shift: true, alt: false, meta: false, key: 'C' },
  paste: { ctrl: true, shift: true, alt: false, meta: false, key: 'V' },
  globalActivate: { ctrl: false, shift: false, alt: false, meta: false, key: 'F12' }
}

const STORAGE_KEY = 'sokking.keybindings'

export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key
}

export function matchBinding(e: KeyboardEvent, b: KeyBinding, ignoreAlt = false): boolean {
  return (
    e.ctrlKey === b.ctrl &&
    e.shiftKey === b.shift &&
    (ignoreAlt || e.altKey === b.alt) &&
    e.metaKey === b.meta &&
    normalizeKey(e.key) === b.key
  )
}

/**
 * Actions matched even with an extra Alt held down. Rectangular selection is
 * Alt+drag (Shift+Alt inside apps that track the mouse), so the hand is still
 * on Alt when the copy combo follows — without this the keystroke would miss
 * the binding, reach the shell, and clear the very selection being copied.
 */
const ALT_TOLERANT_ACTIONS: ShortcutAction[] = ['copy']

const KEY_SYMBOLS: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓'
}

export function formatBinding(b: KeyBinding): string {
  const parts: string[] = []
  if (b.ctrl) parts.push('Ctrl')
  if (b.shift) parts.push('Shift')
  if (b.alt) parts.push('Alt')
  if (b.meta) parts.push('Meta')
  parts.push(KEY_SYMBOLS[b.key] ?? b.key)
  return parts.join('+')
}

const ACCELERATOR_KEYS: Record<string, string> = {
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ' ': 'Space'
}

/** Electron accelerator string for globalShortcut.register. */
export function toAccelerator(b: KeyBinding): string {
  const parts: string[] = []
  if (b.ctrl) parts.push('Ctrl')
  if (b.shift) parts.push('Shift')
  if (b.alt) parts.push('Alt')
  if (b.meta) parts.push('Super')
  parts.push(ACCELERATOR_KEYS[b.key] ?? b.key)
  return parts.join('+')
}

function load(): Record<ShortcutAction, KeyBinding> {
  const merged = { ...DEFAULT_BINDINGS }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const stored = JSON.parse(raw) as Partial<Record<ShortcutAction, KeyBinding>>
      for (const action of ALL_ACTIONS) {
        if (stored[action]) merged[action] = stored[action] as KeyBinding
      }
    }
  } catch {
    // fall back to defaults on malformed storage
  }
  return merged
}

function persist(bindings: Record<ShortcutAction, KeyBinding>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings))
  } catch {
    // storage may be unavailable; keep the in-memory bindings regardless
  }
}

interface KeybindingsState {
  bindings: Record<ShortcutAction, KeyBinding>
  /** Action currently awaiting a captured key combo (settings UI), or null. */
  capturing: ShortcutAction | null
  setBinding: (action: ShortcutAction, binding: KeyBinding) => void
  resetBinding: (action: ShortcutAction) => void
  setCapturing: (action: ShortcutAction | null) => void
  /** The action bound to this event, if any. */
  actionFor: (e: KeyboardEvent) => ShortcutAction | null
}

export const useKeybindingsStore = create<KeybindingsState>((set, get) => ({
  bindings: load(),
  capturing: null,

  setBinding: (action, binding) => {
    set((s) => {
      const bindings = { ...s.bindings, [action]: binding }
      persist(bindings)
      return { bindings }
    })
  },

  resetBinding: (action) => {
    set((s) => {
      const bindings = { ...s.bindings, [action]: DEFAULT_BINDINGS[action] }
      persist(bindings)
      return { bindings }
    })
  },

  setCapturing: (action) => set({ capturing: action }),

  actionFor: (e) => {
    const { bindings } = get()
    for (const action of [...ACTIONS, ...WORKSPACE_ACTIONS]) {
      if (matchBinding(e, bindings[action])) return action
    }
    // Exact matching first, so a stray Alt never shadows an Alt-bound action.
    for (const action of ALT_TOLERANT_ACTIONS) {
      if (!bindings[action].alt && matchBinding(e, bindings[action], true)) return action
    }
    return null
  }
}))
