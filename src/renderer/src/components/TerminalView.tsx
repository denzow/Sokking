import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { Tab } from '../stores/tabs'
import { useKeybindingsStore, WORKSPACE_ACTIONS } from '../stores/keybindings'
import { resolveFontFamily, useAppearanceStore } from '../stores/appearance'

interface TerminalViewProps {
  tab: Tab
  active: boolean
}

/**
 * The live terminal of each tab, so the search bar — which lives outside this
 * component, over the terminal area — can drive the active tab's xterm.
 * Entries are added when a tab's terminal is created and removed when it dies.
 */
export const terminals = new Map<string, { term: Terminal; search: SearchAddon }>()

/**
 * Hand a clicked link to the OS browser. xterm's default would call
 * window.open(), which Electron's window-open handler denies, so every link —
 * plain URLs found by the web-links addon and OSC 8 hyperlinks alike — goes
 * through this. Main re-checks the scheme; terminal output is untrusted.
 */
function openLink(_event: MouseEvent, uri: string): void {
  window.sokking.openExternal(uri)
}

export function TerminalView({ tab, active }: TerminalViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    const container = containerRef.current!
    const appearance = useAppearanceStore.getState()
    const term = new Terminal({
      fontFamily: resolveFontFamily(appearance.fontFamily),
      fontSize: appearance.fontSize,
      scrollback: 10000,
      cursorBlink: true,
      allowProposedApi: true,
      // OSC 8 hyperlinks (Claude Code emits these).
      linkHandler: { activate: openLink },
      theme: appearance.currentTheme().terminal
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    const search = new SearchAddon()
    term.loadAddon(search)
    terminals.set(tab.id, { term, search })
    // Plain http(s) URLs printed as text — underlined on hover, click to open.
    term.loadAddon(new WebLinksAddon(openLink))
    term.open(container)
    try {
      const webgl = new WebglAddon()
      // Chromium caps the number of simultaneous WebGL contexts (~16); opening
      // more tabs than that makes it force-lose the oldest terminal's context,
      // leaving it blank. Dispose the addon on loss so xterm falls back to the
      // DOM renderer and the terminal keeps drawing.
      webgl.onContextLoss(() => {
        webgl.dispose()
        if (container.clientWidth > 0 && container.clientHeight > 0) fit.fit()
      })
      term.loadAddon(webgl)
    } catch {
      // WebGL unavailable — fall back to the DOM renderer
    }
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    // Let app-level shortcuts win over the shell while the terminal is focused:
    // any combo bound to an action is handed back to the window handler.
    // copy/paste need this terminal instance, so they are handled right here.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const action = useKeybindingsStore.getState().actionFor(e)
      if (!action) return true
      // Workspace-category combos (Ctrl+W, Ctrl+E, …) belong to the shell
      // here: they only act while the workspace panel is showing, and a
      // focused terminal means the terminal panel is showing — keep the
      // shell's word-delete / end-of-line / paging keys.
      if (WORKSPACE_ACTIONS.includes(action)) return true
      if (action === 'copy') {
        const selection = term.getSelection()
        if (selection) void navigator.clipboard.writeText(selection)
        e.preventDefault()
        return false
      }
      if (action === 'paste') {
        void navigator.clipboard.readText().then((text) => {
          if (text) term.paste(text)
        })
        // Suppress the browser's own paste so the text isn't inserted twice.
        e.preventDefault()
        return false
      }
      return false
    })

    // Subscribe before creating the pty so the first prompt is never dropped.
    const unsubData = window.sokking.onPtyData(({ tabId, data }) => {
      if (tabId === tab.id) term.write(data)
    })
    const unsubExit = window.sokking.onPtyExit(({ tabId, exitCode }) => {
      if (tabId === tab.id) term.write(`\r\n[プロセスが終了しました (code ${exitCode})]\r\n`)
    })
    // Seed the shell in the cwd inherited from the spawning tab (empty → home).
    void window.sokking.ptyCreate(tab.id, tab.cwd || undefined).then(() => {
      window.sokking.ptyResize(tab.id, term.cols, term.rows)
    })

    term.onData((data) => {
      window.sokking.ptyWrite(tab.id, data)
    })
    term.onResize(({ cols, rows }) => {
      window.sokking.ptyResize(tab.id, cols, rows)
    })

    const resizeObserver = new ResizeObserver(() => {
      if (container.clientWidth > 0 && container.clientHeight > 0) fit.fit()
    })
    resizeObserver.observe(container)

    // Apply live theme / font changes to this terminal.
    const unsubAppearance = useAppearanceStore.subscribe((s) => {
      term.options.theme = s.currentTheme().terminal
      term.options.fontFamily = resolveFontFamily(s.fontFamily)
      term.options.fontSize = s.fontSize
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        fit.fit()
        window.sokking.ptyResize(tab.id, term.cols, term.rows)
      }
    })

    return () => {
      resizeObserver.disconnect()
      unsubData()
      unsubExit()
      unsubAppearance()
      terminals.delete(tab.id)
      window.sokking.ptyDispose(tab.id)
      term.dispose()
    }
    // The terminal and pty live for the lifetime of the tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  useEffect(() => {
    if (active) {
      fitRef.current?.fit()
      termRef.current?.focus()
    }
  }, [active])

  return (
    <div
      ref={containerRef}
      className="terminal-container"
      style={{ display: active ? 'block' : 'none' }}
    />
  )
}
