import { useCallback, useEffect, useRef, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { TerminalView } from './components/TerminalView'
import { TerminalSearch } from './components/TerminalSearch'
import {
  focusWorkspaceContent,
  focusWorkspaceTree,
  openWorkspaceSearch,
  WorkspacePanel
} from './components/WorkspacePanel'
import {
  closeEditorFile,
  focusEditor,
  hasDirtyEditorFiles,
  requestEditorFocus
} from './components/EditorPanel'
import { GitControlPanel } from './components/GitControlPanel'
import { GitDiffPanel } from './components/GitDiffPanel'
import { GitLogPanel } from './components/GitLogPanel'
import { Settings } from './components/Settings'
import { BookmarksModal } from './components/BookmarksModal'
import { NotificationsModal } from './components/NotificationsModal'
import { TabSearchModal } from './components/TabSearchModal'
import { useTabsStore } from './stores/tabs'
import { openFileInEditor, useEditorStore } from './stores/editor'
import { openFile } from './stores/file-openers'
import { useNotificationsStore } from './stores/notifications'
import { useTasksStore } from './stores/tasks'
import { useRunsStore } from './stores/runs'
import { TaskBox } from './components/TaskBox'
import { TaskPanel } from './components/TaskPanel'
import { StartRunModal } from './components/StartRunModal'
import { closeTab } from './tab-actions'
import type { Task } from '../../shared/tasks'
import {
  ShortcutAction,
  toAccelerator,
  useKeybindingsStore,
  WORKSPACE_ACTIONS
} from './stores/keybindings'
import { loadSession, saveSession } from './stores/session'

type MainPanel = 'terminal' | 'task' | 'git' | 'workspace' | 'diff' | 'log'

/** What the main area shows: the active session tab's panels, or the task box. */
type MainView = 'tabs' | 'taskbox'

/** Main-area panels in left-to-right order for Ctrl+←/→ switching; the task
    panel exists only on a processing tab, the Git panels only when the
    active tab's cwd is a repository, and the workspace (file tree + editor
    + search) sits to their right. */
function panelOrder(isRepo: boolean, hasTask: boolean): MainPanel[] {
  const order: MainPanel[] = ['terminal']
  if (hasTask) order.push('task')
  if (isRepo) order.push('diff', 'git', 'log')
  order.push('workspace')
  return order
}

export default function App(): React.JSX.Element {
  const tabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const [panel, setPanel] = useState<MainPanel>('terminal')
  const [view, setView] = useState<MainView>('tabs')
  /** Task whose launch dialog is open, if any. */
  const [runModalTask, setRunModalTask] = useState<Task | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [bookmarksOpen, setBookmarksOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [tabSearchOpen, setTabSearchOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchFocus, setSearchFocus] = useState(0)
  const [gitInfo, setGitInfo] = useState<{ isRepo: boolean; branch: string }>({
    isRepo: false,
    branch: ''
  })

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
  const activeCwd = activeTab?.cwd ?? ''

  // Keep the latest isRepo / panel readable from the once-registered key handler.
  const isRepoRef = useRef(false)
  isRepoRef.current = gitInfo.isRepo
  const hasTaskRef = useRef(false)
  hasTaskRef.current = activeTab?.taskId !== null && activeTab?.taskId !== undefined
  const panelRef = useRef<MainPanel>('terminal')
  panelRef.current = panel
  const activeTabIdRef = useRef<string | null>(null)
  activeTabIdRef.current = activeTabId

  // Detect whether the active tab's cwd is a git repo (and which branch), so
  // the Git panels only appear under a repository. Re-checked when the cwd
  // changes and whenever the panel switches (to pick up branch changes).
  useEffect(() => {
    let cancelled = false
    if (!activeCwd) {
      setGitInfo({ isRepo: false, branch: '' })
      return
    }
    void window.sokking.gitOverview(activeCwd).then((ov) => {
      if (cancelled) return
      setGitInfo({ isRepo: ov.isRepo, branch: ov.currentBranch })
    })
    return () => {
      cancelled = true
    }
  }, [activeCwd, panel])

  // Never leave a Git panel open once the active tab is no longer a repo.
  useEffect(() => {
    if (!gitInfo.isRepo) {
      setPanel((p) => (p === 'git' || p === 'diff' || p === 'log' ? 'terminal' : p))
    }
  }, [gitInfo.isRepo])

  // Switching session tabs always lands on the terminal — the previous tab's
  // panel choice (diff / log / files) shouldn't leak into the next tab. The
  // terminal search closes too (unmounting it drops the old tab's highlights):
  // a query typed against one tab's output is noise on another's.
  useEffect(() => {
    setPanel('terminal')
    setSearchOpen(false)
  }, [activeTabId])

  // Open an absolute path in the workspace's editor and switch to the panel
  // (shared by the files-panel context menu and the diff panel's open
  // button). Binaries fall back to the external app without a panel switch.
  const openPathInWorkspace = useCallback((path: string): void => {
    void (async () => {
      const tabId = useTabsStore.getState().activeTabId
      if (!tabId) return
      const wasShowing = useEditorStore.getState().active[tabId] === path
      const r = await openFileInEditor(tabId, path, openFile)
      if (r.ok && r.opened === 'editor') {
        // Same focus split as the workspace: an already-shown file gets no
        // model swap to consume a pending focus request.
        if (wasShowing) focusEditor()
        else requestEditorFocus()
        setPanel('workspace')
      }
    })()
  }, [])

  // "Open in a tab" from the task box: jump to the task's tab when it has
  // one, otherwise go through the launch dialog (it opens the tab and starts
  // Claude Code in it).
  const openTaskInTab = useCallback((task: Task): void => {
    const store = useTabsStore.getState()
    const existing = store.tabs.find((t) => t.taskId === task.id)
    if (existing) {
      store.activateTab(existing.id)
      setView('tabs')
      setPanel('terminal')
      return
    }
    setRunModalTask(task)
  }, [])

  // Global IPC listeners (registered once).
  useEffect(() => {
    const store = useTabsStore.getState()
    const unsubCwd = window.sokking.onTabCwd(({ tabId, cwd }) => {
      useTabsStore.getState().setCwd(tabId, cwd)
    })
    const unsubProcess = window.sokking.onTabProcess(({ tabId, process }) => {
      useTabsStore.getState().setRunningProcess(tabId, process)
    })
    const unsubActivity = window.sokking.onTabActivity(({ tabId, state, message }) => {
      useTabsStore.getState().setActivity(tabId, state, message)
    })
    const unsubExit = window.sokking.onPtyExit(({ tabId }) => {
      // The shell exited: the tab goes, with its editor files, tree state
      // and (for a task tab) the task's running status.
      closeTab(tabId, { ptyAlive: false })
    })
    const unsubNotification = window.sokking.onNotification((event) => {
      useNotificationsStore.getState().add(event)
    })
    // The task box is main's data; fetch it now and whenever main reports a
    // change (the CLI and background sources write to it too).
    void useTasksStore.getState().refresh()
    const unsubTasks = window.sokking.onTaskChanged(() => {
      void useTasksStore.getState().refresh()
    })
    const unsubRuns = window.sokking.onRunChanged(() => {
      void useRunsStore.getState().refreshAll()
    })
    // Files-panel context menu 「エディタで開く」. The helper reads in the
    // renderer (not main) so binaries still fall back to the external app
    // (configured opener or OS default).
    const unsubOpenInEditor = window.sokking.onOpenInEditor(openPathInWorkspace)

    // Refocusing the window means the visible (active) tab has been seen —
    // its attention highlight, if any, is acknowledged.
    const onFocus = (): void => {
      const { activeTabId, clearAttention } = useTabsStore.getState()
      if (activeTabId) clearAttention(activeTabId)
    }
    window.addEventListener('focus', onFocus)

    // Restore the previous session's tabs (their directories) on first launch,
    // otherwise start with a single tab.
    if (store.tabs.length === 0) {
      const saved = loadSession()
      if (saved && saved.tabs.length > 0) store.restoreTabs(saved.tabs, saved.activeIndex)
      else store.addTab()
    }

    // Persist the open tabs' directories on every change so the latest state is
    // always saved by the time the app quits.
    const unsubPersist = useTabsStore.subscribe((state) => {
      saveSession({
        tabs: state.tabs.map((t) => ({ cwd: t.cwd, title: t.title, taskId: t.taskId })),
        activeIndex: Math.max(
          0,
          state.tabs.findIndex((t) => t.id === state.activeTabId)
        )
      })
    })

    return () => {
      unsubCwd()
      unsubProcess()
      unsubActivity()
      unsubExit()
      unsubNotification()
      unsubTasks()
      unsubRuns()
      unsubOpenInEditor()
      unsubPersist()
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  // App-wide keyboard shortcuts, dispatched from the (customizable) keybindings
  // store. Mirrored inside xterm's key handler so the shell doesn't swallow them.
  useEffect(() => {
    const runAction = (action: ShortcutAction): void => {
      const store = useTabsStore.getState()
      switch (action) {
        case 'newTab':
          store.addTab()
          setView('tabs')
          break
        case 'closeTab':
          if (store.activeTabId) {
            const tabId = store.activeTabId
            // The tab's editor files die with it — don't lose edits silently.
            if (
              hasDirtyEditorFiles(tabId) &&
              !window.confirm('未保存のエディタファイルがあります。タブを閉じますか?')
            ) {
              break
            }
            closeTab(tabId, { ptyAlive: true })
          }
          break
        case 'closeEditorTab': {
          // Closes the shown file; the store lands on its right neighbor.
          // (The dispatch guard already limits workspace actions to the
          // workspace panel.)
          const tabId = activeTabIdRef.current
          if (!tabId) break
          const active = useEditorStore.getState().active[tabId]
          if (active) closeEditorFile(tabId, active)
          break
        }
        case 'wsFocusTree':
          focusWorkspaceTree()
          break
        case 'wsFocusEditor':
          focusEditor()
          break
        case 'wsPrevEditorTab':
        case 'wsNextEditorTab': {
          const tabId = activeTabIdRef.current
          if (!tabId) break
          const s = useEditorStore.getState()
          const files = s.files.filter((f) => f.tabId === tabId)
          const index = files.findIndex((f) => f.path === s.active[tabId])
          const next = files[index + (action === 'wsPrevEditorTab' ? -1 : 1)]
          if (next) s.setActive(tabId, next.path)
          break
        }
        case 'panelLeft':
        case 'panelRight': {
          const order = panelOrder(isRepoRef.current, hasTaskRef.current)
          const index = order.indexOf(panelRef.current)
          const next = index + (action === 'panelLeft' ? -1 : 1)
          if (next < 0 || next >= order.length) break
          setPanel(order[next])
          break
        }
        case 'prevTab':
          store.activateRelative(-1)
          setView('tabs')
          break
        case 'nextTab':
          store.activateRelative(1)
          setView('tabs')
          break
        case 'moveTabUp':
          store.moveTab(-1)
          break
        case 'moveTabDown':
          store.moveTab(1)
          break
        case 'openBookmarks':
          setBookmarksOpen((open) => !open)
          break
        case 'openNotifications':
          setNotificationsOpen((open) => !open)
          break
        case 'openFileManager': {
          // Same as the files panel's 🗁 button: the active tab's cwd goes to
          // the OS default handler for directories (= the file manager).
          const cwd = store.tabs.find((t) => t.id === store.activeTabId)?.cwd
          if (cwd) void window.sokking.fsOpen(cwd)
          break
        }
        case 'find':
          // On the workspace panel the shortcut means the workspace search
          // (the directory search pane), not the terminal search.
          if (panelRef.current === 'workspace' && openWorkspaceSearch()) break
          // Searching acts on the terminal, so bring it back into view first.
          setPanel('terminal')
          setSearchOpen(true)
          // Re-pressing the shortcut refocuses the box instead of doing nothing.
          setSearchFocus((n) => n + 1)
          break
      }
    }
    // Shift pressed twice in a row (nothing in between) opens the tab search
    // palette. `lastShift` is the timestamp of the previous lone Shift press;
    // any other key resets it, so Shift+X followed by Shift never triggers.
    let lastShift = 0
    const DOUBLE_SHIFT_MS = 400
    const isTypingTarget = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'SELECT') &&
      // xterm's hidden textarea is where terminal typing lands — not a form field.
      !target.classList.contains('xterm-helper-textarea')

    const handler = (e: KeyboardEvent): void => {
      const kb = useKeybindingsStore.getState()
      if (kb.capturing) return // don't fire actions while rebinding in settings
      if (e.key === 'Shift') {
        // Skip while typing in a real text field (settings, other palettes) —
        // capitalizing there shouldn't pop the palette open.
        if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || isTypingTarget(e.target)) return
        const now = e.timeStamp
        if (lastShift && now - lastShift < DOUBLE_SHIFT_MS) {
          lastShift = 0
          setTabSearchOpen((open) => !open)
        } else {
          lastShift = now
        }
        return
      }
      lastShift = 0
      const action = kb.actionFor(e)
      if (!action) return
      // copy/paste are handled inside the focused TerminalView (they need the
      // xterm instance); elsewhere the native clipboard behavior should win.
      // globalActivate lives in the main process (globalShortcut) — the OS
      // grab normally swallows the key before it ever reaches the renderer.
      if (action === 'copy' || action === 'paste' || action === 'globalActivate') return
      // Workspace-category combos only exist on the workspace panel;
      // anywhere else the key keeps its native meaning (word-delete etc. in
      // the shell — TerminalView passes them through — no-op elsewhere).
      const isWorkspaceAction = WORKSPACE_ACTIONS.includes(action)
      if (isWorkspaceAction && panelRef.current !== 'workspace') return
      // While focus lives inside the workspace panel, its widgets own the
      // keys (Monaco word-wise Ctrl+←/→, the search input, the tree):
      // global shortcuts are dropped except session-tab switching and find
      // (= the workspace search). Double-Esc moves focus to the panel menu,
      // where every shortcut applies again.
      if (
        !isWorkspaceAction &&
        panelRef.current === 'workspace' &&
        e.target instanceof HTMLElement &&
        e.target.closest('.workspace-panel') &&
        action !== 'prevTab' &&
        action !== 'nextTab' &&
        action !== 'find'
      ) {
        return
      }
      e.preventDefault()
      runAction(action)
    }
    // Capture-phase companion to `handler`, for keys Monaco would consume
    // before they bubble:
    // - Double-Esc anywhere inside the workspace panel exits to the panel
    //   menu (the active view tab). The first press still does its local job
    //   (dismiss a widget, clear a filter) — only the quick second one is
    //   swallowed and turned into the jump.
    // - Inside Monaco, the combos that must stay app-level (session-tab
    //   switching, find, the workspace actions) are dispatched here.
    let lastEsc = 0
    const onCapture = (e: KeyboardEvent): void => {
      if (useKeybindingsStore.getState().capturing) return
      const inWorkspacePanel =
        panelRef.current === 'workspace' &&
        e.target instanceof HTMLElement &&
        !!e.target.closest('.workspace-panel')
      if (e.key === 'Escape') {
        if (e.repeat) return
        if (!inWorkspacePanel) {
          lastEsc = 0
          return
        }
        const now = e.timeStamp
        if (lastEsc && now - lastEsc < DOUBLE_SHIFT_MS) {
          lastEsc = 0
          e.preventDefault()
          e.stopPropagation()
          document.querySelector<HTMLElement>('.view-tabs .view-tab.active')?.focus()
        } else {
          lastEsc = now
        }
        return
      }
      lastEsc = 0
      if (!(e.target instanceof HTMLElement) || !e.target.closest('.monaco-editor')) return
      const action = useKeybindingsStore.getState().actionFor(e)
      if (!action) return
      const allowed =
        action === 'prevTab' ||
        action === 'nextTab' ||
        action === 'find' ||
        (WORKSPACE_ACTIONS.includes(action) && panelRef.current === 'workspace')
      if (!allowed) return
      e.preventDefault()
      e.stopPropagation()
      runAction(action)
    }
    window.addEventListener('keydown', handler)
    window.addEventListener('keydown', onCapture, true)
    return () => {
      window.removeEventListener('keydown', handler)
      window.removeEventListener('keydown', onCapture, true)
    }
  }, [])

  // Keep main's globalShortcut registration in sync with the (persisted)
  // globalActivate binding: push it on startup and on every change.
  useEffect(() => {
    const register = (): void => {
      const binding = useKeybindingsStore.getState().bindings.globalActivate
      void window.sokking.setGlobalHotkey(toAccelerator(binding)).then((result) => {
        if (!result.ok) console.warn('グローバルホットキーを登録できません:', result.error)
      })
    }
    register()
    let last = useKeybindingsStore.getState().bindings.globalActivate
    const unsub = useKeybindingsStore.subscribe((s) => {
      if (s.bindings.globalActivate === last) return
      last = s.bindings.globalActivate
      register()
    })
    return unsub
  }, [])

  return (
    <div className="app">
      <Sidebar
        view={view}
        onShowTaskBox={() => setView('taskbox')}
        onTabSelected={() => setView('tabs')}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenBookmarks={() => setBookmarksOpen(true)}
        onOpenNotifications={() => setNotificationsOpen(true)}
        // The workspace wants the horizontal room — the tab list shrinks to a
        // first-character rail while it is showing.
        collapsed={view === 'tabs' && panel === 'workspace'}
      />
      <div className="main">
        {/* A top bar switches the main area between the terminal, the files
            panel, and (when the cwd is a git repo) the two Git panels. */}
        {view === 'tabs' && (
        <div className="view-tabs">
          <button
            className={`view-tab${panel === 'terminal' ? ' active' : ''}`}
            onClick={() => setPanel('terminal')}
            title="terminal パネル (Ctrl+←)"
          >
            terminal
          </button>
          {activeTab?.taskId !== null && activeTab?.taskId !== undefined && (
            <button
              className={`view-tab${panel === 'task' ? ' active' : ''}`}
              onClick={() => setPanel('task')}
              title="task パネル: このタブが処理しているタスク (Ctrl+←/→)"
            >
              task
            </button>
          )}
          {gitInfo.isRepo && (
            <>
              <button
                className={`view-tab${panel === 'diff' ? ' active' : ''}`}
                onClick={() => setPanel('diff')}
                title="diff パネル (Ctrl+←/→)"
              >
                diff
              </button>
              <button
                className={`view-tab${panel === 'git' ? ' active' : ''}`}
                onClick={() => setPanel('git')}
                title="git パネル: ブランチ / コミット / pull / push (Ctrl+←/→)"
              >
                git
              </button>
              <button
                className={`view-tab${panel === 'log' ? ' active' : ''}`}
                onClick={() => setPanel('log')}
                title="log パネル (Ctrl+←/→)"
              >
                log
              </button>
            </>
          )}
          <button
            className={`view-tab${panel === 'workspace' ? ' active' : ''}`}
            onClick={() => setPanel('workspace')}
            onKeyDown={(e) => {
              // Enter/↓ descend back into the workspace (the ↑ that got the
              // focus up here has no other way back down by keyboard).
              if (e.key !== 'Enter' && e.key !== 'ArrowDown') return
              e.preventDefault()
              setPanel('workspace')
              // Deferred: the panel may be mounting right now.
              setTimeout(focusWorkspaceContent, 0)
            }}
            title="workspace パネル: ファイルツリー + エディタ + 検索 (Ctrl+→) / Enterで中へ"
          >
            workspace
          </button>
          {gitInfo.isRepo && (
            <span className="view-tabs-branch" title="現在のブランチ">
              <span className="view-tab-icon">⎇</span>
              {gitInfo.branch}
            </span>
          )}
        </div>
        )}
        <div className="view-content">
          {/* Terminals stay mounted (ptys alive) but are hidden while another
              panel — or the task box — takes over the area. */}
          <div
            className="terminals"
            style={{ display: view === 'tabs' && panel === 'terminal' ? 'block' : 'none' }}
          >
            {tabs.map((tab) => (
              <TerminalView
                key={tab.id}
                tab={tab}
                active={view === 'tabs' && tab.id === activeTabId && panel === 'terminal'}
              />
            ))}
            {searchOpen && activeTabId && (
              <TerminalSearch
                tabId={activeTabId}
                focusToken={searchFocus}
                onClose={() => setSearchOpen(false)}
              />
            )}
          </div>
          {view === 'taskbox' && <TaskBox onOpenInTab={openTaskInTab} />}
          {view === 'tabs' && panel === 'task' && activeTab && (
            <TaskPanel key={activeTab.id} tab={activeTab} onRelaunch={setRunModalTask} />
          )}
          {view === 'tabs' && panel === 'git' && activeTab && <GitControlPanel tab={activeTab} />}
          {view === 'tabs' && panel === 'workspace' && activeTab && (
            // Keyed by tab: the side pane's saved state is per tab, and
            // restoring it happens at mount.
            <WorkspacePanel key={activeTab.id} tab={activeTab} />
          )}
          {view === 'tabs' && panel === 'diff' && activeTab && (
            <GitDiffPanel tab={activeTab} onOpenInEditor={openPathInWorkspace} />
          )}
          {view === 'tabs' && panel === 'log' && activeTab && <GitLogPanel tab={activeTab} />}
        </div>
      </div>
      {tabSearchOpen && (
        <TabSearchModal
          onClose={() => setTabSearchOpen(false)}
          onSelect={(tabId) => {
            useTabsStore.getState().activateTab(tabId)
            setView('tabs')
            setTabSearchOpen(false)
          }}
        />
      )}
      {runModalTask && (
        <StartRunModal
          task={runModalTask}
          onClose={() => setRunModalTask(null)}
          onStarted={() => {
            setRunModalTask(null)
            setView('tabs')
            setPanel('terminal')
          }}
        />
      )}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      {bookmarksOpen && <BookmarksModal onClose={() => setBookmarksOpen(false)} />}
      {notificationsOpen && (
        <NotificationsModal
          onClose={() => setNotificationsOpen(false)}
          onJumpToTab={(tabId) => {
            useTabsStore.getState().activateTab(tabId)
            setView('tabs')
            setPanel('terminal')
            setNotificationsOpen(false)
          }}
        />
      )}
    </div>
  )
}
