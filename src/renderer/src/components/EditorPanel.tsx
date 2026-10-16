import { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import JsonWorker from 'monaco-editor/languages/features/json/json.worker.js?worker'
import CssWorker from 'monaco-editor/languages/features/css/css.worker.js?worker'
import HtmlWorker from 'monaco-editor/languages/features/html/html.worker.js?worker'
import TsWorker from 'monaco-editor/languages/features/typescript/ts.worker.js?worker'
import { resolveFontFamily, Theme, themeByKey, useAppearanceStore } from '../stores/appearance'
import { docKey, takeSeed, useEditorStore } from '../stores/editor'
import { formatBinding, useKeybindingsStore } from '../stores/keybindings'

// Monaco's language services run in workers; vite turns these imports into
// bundled worker constructors.
;(globalThis as { MonacoEnvironment?: monaco.Environment }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  }
}

/**
 * An open document: the Monaco model plus what save/dirty tracking needs.
 * Module-level (like the terminals registry) so text and undo history survive
 * the panel unmounting while another view tab is shown. Keyed per session tab
 * (docKey) — the same file open in two session tabs gets independent models.
 */
interface Doc {
  model: monaco.editor.ITextModel
  /** Version at the last save/load — dirty = current version differs. */
  savedVersionId: number
  /** Disk mtime at the last read/save, for save-conflict detection. */
  mtime: number
  /** Cursor/scroll position, restored when the tab is shown again. */
  viewState: monaco.editor.ICodeEditorViewState | null
  listener: monaco.IDisposable | null
}

const docs = new Map<string, Doc>()

// The single live editor widget (one EditorPanel serves every editor view
// tab), for App to hand focus back after Escape moved it to a view tab.
let currentEditor: monaco.editor.IStandaloneCodeEditor | null = null

/** Focus the editor widget (no-op while no editor panel is mounted). */
export function focusEditor(): void {
  currentEditor?.focus()
}

// Whether the next model swap should focus the editor. Deliberate opens
// (files panel, tab click, Enter on a tab) set this; plain panel stepping
// (Ctrl+←/→) does not — otherwise every arrow step into an editor tab would
// steal focus into Monaco and demand an Escape to continue.
let pendingFocus = false

/** Make the next shown editor panel take keyboard focus. */
export function requestEditorFocus(): void {
  pendingFocus = true
}

// Line to jump to on the next model swap (search results open a file at a
// hit). null clears a stale request (e.g. the open fell back to an external
// app and no swap will consume it).
let pendingReveal: number | null = null

/** Make the next model swap jump to (and center) this line. */
export function requestEditorReveal(line: number | null): void {
  pendingReveal = line
}

/** Jump the live editor to a line — for hits in the already-shown file. */
export function revealEditorLine(line: number): void {
  currentEditor?.setPosition({ lineNumber: line, column: 1 })
  currentEditor?.revealLineInCenter(line)
}

function disposeDoc(key: string): void {
  const doc = docs.get(key)
  if (!doc) return
  doc.listener?.dispose()
  doc.model.dispose() // detaches itself from the editor if showing
  docs.delete(key)
}

/**
 * Close an editor file: confirm when dirty, dispose the Monaco model, drop
 * it from the store. Returns false when the user kept the file open. Called
 * from App's view-tab close buttons — the registry lives here, not there.
 */
export function closeEditorFile(tabId: string, path: string): boolean {
  const file = useEditorStore.getState().files.find((f) => f.tabId === tabId && f.path === path)
  if (!file) return true
  if (
    file.dirty &&
    !window.confirm(`${file.name} には未保存の変更があります。保存せずに閉じますか?`)
  ) {
    return false
  }
  disposeDoc(docKey(tabId, path))
  useEditorStore.getState().close(tabId, path)
  return true
}

/** Whether a session tab has editor files with unsaved changes. */
export function hasDirtyEditorFiles(tabId: string): boolean {
  return useEditorStore.getState().files.some((f) => f.tabId === tabId && f.dirty)
}

/** Drop a closing session tab's editor files and their models. */
export function closeEditorFilesForTab(tabId: string): void {
  for (const key of [...docs.keys()]) {
    if (key.startsWith(`${tabId}\n`)) disposeDoc(key)
  }
  useEditorStore.getState().closeForTab(tabId)
}

async function ensureDoc(
  tabId: string,
  path: string
): Promise<{ ok: true; doc: Doc } | { ok: false; error: string }> {
  const key = docKey(tabId, path)
  const existing = docs.get(key)
  if (existing) return { ok: true, doc: existing }
  // The opener (files panel) usually seeded the content; a missing seed means
  // a reopen after close — read from disk.
  let seed = takeSeed(tabId, path)
  if (!seed) {
    const read = await window.sokking.fsReadText(path)
    if (!read.ok) return { ok: false, error: read.error }
    seed = { content: read.content, mtime: read.mtime }
  }
  // Language is inferred from the URI's path extension. The tabId authority
  // keeps URIs unique when two session tabs open the same file (Monaco
  // refuses two models with one URI).
  const uri = monaco.Uri.from({ scheme: 'sokking', authority: tabId, path })
  const model = monaco.editor.createModel(seed.content, undefined, uri)
  const doc: Doc = {
    model,
    savedVersionId: model.getAlternativeVersionId(),
    mtime: seed.mtime,
    viewState: null,
    listener: null
  }
  // Alternative version ids make undo-back-to-saved read as clean again.
  doc.listener = model.onDidChangeContent(() => {
    useEditorStore
      .getState()
      .setDirty(tabId, path, model.getAlternativeVersionId() !== doc.savedVersionId)
  })
  docs.set(key, doc)
  return { ok: true, doc }
}

function isLightColor(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return false
  const n = parseInt(m[1], 16)
  const luminance = 0.299 * ((n >> 16) & 0xff) + 0.587 * ((n >> 8) & 0xff) + 0.114 * (n & 0xff)
  return luminance > 128
}

/** (Re)define the 'sokking' Monaco theme from the app theme's palette. */
function applyMonacoTheme(theme: Theme): void {
  monaco.editor.defineTheme('sokking', {
    base: isLightColor(theme.ui.bg) ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': theme.terminal.background ?? theme.ui.bg,
      'editor.foreground': theme.terminal.foreground ?? theme.ui.text,
      'editor.selectionBackground': theme.terminal.selectionBackground ?? theme.ui.bgHover,
      'editor.lineHighlightBackground': theme.ui.bgAlt,
      'editorLineNumber.foreground': theme.ui.textDim,
      'editorCursor.foreground': theme.terminal.cursor ?? theme.ui.text
    }
  })
  monaco.editor.setTheme('sokking')
}

interface EditorPanelProps {
  /** Session tab whose editor file is showing. */
  tabId: string
  /** Absolute path of the file this panel shows — one view tab per file. */
  path: string
}

/**
 * A Monaco editor showing one file. App keeps a single instance mounted
 * across editor view tabs and swaps `path`, so switching files swaps models
 * (with per-file cursor/scroll state) instead of rebuilding the editor.
 * Ctrl+S saves; saving detects outside writes via mtime and offers
 * overwrite / reload instead of clobbering.
 */
export function EditorPanel({ tabId, path }: EditorPanelProps): React.JSX.Element {
  const dirty = useEditorStore(
    (s) => s.files.find((f) => f.tabId === tabId && f.path === path)?.dirty ?? false
  )
  const closeTabHint = useKeybindingsStore((s) => formatBinding(s.bindings.closeEditorTab))
  const themeKey = useAppearanceStore((s) => s.themeKey)
  const fontFamily = useAppearanceStore((s) => s.fontFamily)
  const fontSize = useAppearanceStore((s) => s.fontSize)
  // Save/conflict feedback for the shown file; cleared on file switch.
  const [message, setMessage] = useState('')
  const [conflict, setConflict] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const keyRef = useRef(docKey(tabId, path))
  keyRef.current = docKey(tabId, path)
  const pathRef = useRef(path)
  pathRef.current = path
  const tabIdRef = useRef(tabId)
  tabIdRef.current = tabId

  const save = async (force = false): Promise<void> => {
    const target = pathRef.current
    const doc = docs.get(keyRef.current)
    if (!doc) return
    const result = await window.sokking.fsWriteText(
      target,
      doc.model.getValue(),
      force ? null : doc.mtime
    )
    if (result.ok) {
      doc.mtime = result.mtime
      doc.savedVersionId = doc.model.getAlternativeVersionId()
      useEditorStore.getState().setDirty(tabIdRef.current, target, false)
      setMessage('')
      setConflict(false)
    } else {
      setMessage(result.error)
      setConflict(result.conflict)
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save

  // Conflict resolution: throw away the buffer and re-read the disk version.
  const reloadFromDisk = async (): Promise<void> => {
    const target = pathRef.current
    const doc = docs.get(keyRef.current)
    if (!doc) return
    const read = await window.sokking.fsReadText(target)
    if (!read.ok) {
      setMessage(read.error)
      return
    }
    doc.model.setValue(read.content)
    doc.mtime = read.mtime
    doc.savedVersionId = doc.model.getAlternativeVersionId()
    useEditorStore.getState().setDirty(tabIdRef.current, target, false)
    setMessage('')
    setConflict(false)
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const appearance = useAppearanceStore.getState()
    applyMonacoTheme(appearance.currentTheme())
    const editor = monaco.editor.create(container, {
      theme: 'sokking',
      automaticLayout: true,
      fontFamily: resolveFontFamily(appearance.fontFamily),
      fontSize: appearance.fontSize,
      minimap: { enabled: true },
      scrollBeyondLastLine: false
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void saveRef.current()
    })
    // Escape releases focus — after it, Ctrl+←/→ switch panels again (inside
    // Monaco they are word-wise cursor movement). The precondition keeps all
    // of Monaco's own Escape uses (dismiss suggest/find/hints, cancel a
    // selection) working: only a "nothing left to dismiss" Escape falls
    // through. Focus goes to the active file tab in the workspace strip (a
    // plain blur doesn't stick — Monaco's EditContext re-acquires focus),
    // deferred a tick so it wins over that re-acquisition.
    editor.addCommand(
      monaco.KeyCode.Escape,
      () => {
        setTimeout(() => {
          const target =
            document.querySelector<HTMLElement>('.workspace-editor-tabs .active') ??
            document.querySelector<HTMLElement>('.view-tabs .active')
          target?.focus()
        }, 0)
      },
      '!suggestWidgetVisible && !findWidgetVisible && !parameterHintsVisible && ' +
        '!renameInputVisible && !inSnippetMode && !editorHasSelection && !editorHasMultipleSelections'
    )
    editorRef.current = editor
    currentEditor = editor
    return () => {
      // Models (text, undo history) stay in `docs`; only the widget dies.
      const doc = docs.get(keyRef.current)
      if (doc) doc.viewState = editor.saveViewState()
      editorRef.current = null
      currentEditor = null
      editor.dispose()
    }
  }, [])

  // Follow the app theme / font settings live (also runs once on mount,
  // which is a harmless re-apply).
  useEffect(() => {
    applyMonacoTheme(themeByKey(themeKey))
    editorRef.current?.updateOptions({ fontFamily: resolveFontFamily(fontFamily), fontSize })
  }, [themeKey, fontFamily, fontSize])

  // Swap the editor to this file's model, parking the previous file's
  // cursor/scroll state first.
  const prevKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const key = docKey(tabId, path)
    const prev = prevKeyRef.current
    if (prev && prev !== key) {
      const prevDoc = docs.get(prev)
      if (prevDoc) prevDoc.viewState = editor.saveViewState()
    }
    prevKeyRef.current = key
    setMessage('')
    setConflict(false)
    let cancelled = false
    void ensureDoc(tabId, path).then((result) => {
      if (cancelled || !editorRef.current) return
      if (!result.ok) {
        pendingFocus = false
        pendingReveal = null
        setMessage(result.error)
        editor.setModel(null)
        return
      }
      editor.setModel(result.doc.model)
      if (result.doc.viewState) editor.restoreViewState(result.doc.viewState)
      // A search hit's jump-to-line wins over the parked cursor position.
      if (pendingReveal !== null) {
        const line = pendingReveal
        pendingReveal = null
        editor.setPosition({ lineNumber: line, column: 1 })
        editor.revealLineInCenter(line)
      }
      // Focus only on deliberate opens — not when stepping through panels.
      if (pendingFocus) {
        pendingFocus = false
        editor.focus()
      }
    })
    return () => {
      cancelled = true
    }
  }, [tabId, path])

  return (
    <div className="editor-panel">
      <div className="editor-toolbar">
        <span className="editor-path" title={path}>
          {path.replace(/^\/home\/[^/]+/, '~')}
        </span>
        <span className="editor-hint">
          Esc: フォーカス解除 / Esc×2: パネルメニューへ / {closeTabHint}: タブを閉じる
        </span>
        <button
          className="editor-save"
          onClick={() => void saveRef.current()}
          disabled={!dirty}
          title="保存 (Ctrl+S)"
        >
          保存
        </button>
      </div>
      {message && (
        <div className="editor-message">
          <span>{message}</span>
          {conflict && (
            <>
              <button onClick={() => void saveRef.current(true)}>上書き保存</button>
              <button onClick={() => void reloadFromDisk()}>読み込み直す</button>
            </>
          )}
        </div>
      )}
      <div className="editor-body" ref={containerRef} />
    </div>
  )
}
