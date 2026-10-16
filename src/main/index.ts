import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, nativeImage, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  FsAppInfo,
  FsEntry,
  FsListResult,
  FsOpenResult,
  FsReadTextResult,
  FsWriteTextResult,
  GitResult,
  HotkeyRegisterResult,
  IPC,
  PtyCreateRequest,
  PtyDataEvent,
  GitDiffFile,
  GitLogEntry,
  GitOverview
} from '../shared/ipc'
import { PtyManager } from './pty-manager'
import { CwdTracker } from './cwd-tracker'
import { ProcessTracker } from './process-tracker'
import { GitService } from './git-service'
import { AppCandidate, launchWith, listAllApps, listAppsFor, listMimeTypes, mimeTypesFor } from './open-with'
import { searchEntryNames, workspaceSearch } from './search-service'
import { cleanupStaleHookSockets, HookServer } from './hook-server'
import { HookInstaller } from './hook-installer'
import { Notifier } from './notifier'
import { openDatabase } from '../core/db'
import { TaskError, TaskRepository } from '../core/tasks'
import { RunError, RunRepository } from '../core/runs'
import { RepoError, RepoRepository } from '../core/repos'
import { buildPrompt } from '../core/prompt'
import { ControlServer } from '../core/control-server'
import { SettingsRepository } from '../core/settings'
import { FilterError, NotificationFilterRepository } from '../core/notification-filters'
import { NotificationLogRepository } from '../core/notification-log'
import { NotificationMonitor } from '../core/notification-monitor'
import { NotificationSource } from '../core/notification-source'
import { RunCoordinator } from './run-coordinator'
import { AutoDispatcher } from './auto-dispatcher'
import { RuleError, RuleRepository } from '../core/rules'
import { RuleRunner } from '../core/rule-runner'
import { fetchIssues } from '../core/github'
import type { RuleInput } from '../shared/rules'
import { NewTask, TaskFilter, TaskPatch, TaskStatus, TASK_STATUSES } from '../shared/tasks'
import { Delivery, RepoDefaults, RunOptions } from '../shared/runs'
import {
  NotificationFilterInput,
  SETTING_NOTIFICATION_MONITOR_ENABLED
} from '../shared/notifications'
import type { NotificationStatus } from '../shared/ipc'
import appIcon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null

// In dev, keep settings/session/localStorage/hook socket separate from the
// installed app so dev runs never clobber the real config. Must run before
// anything reads userData (e.g. the socket path below).
if (!app.isPackaged) {
  app.setPath('userData', app.getPath('userData') + '-dev')
}

// Per-instance socket so concurrent sokking processes (e.g. a dev run next
// to the daily instance) never steal each other's hook events. The path
// reaches Claude Code through each pty's env ($SOKKING_SOCKET), so no global
// registration depends on it.
const socketPath = path.join(app.getPath('userData'), `hook-${process.pid}.sock`)
const ptyManager = new PtyManager(() => mainWindow?.webContents ?? null, socketPath)
const cwdTracker = new CwdTracker(ptyManager, () => mainWindow?.webContents ?? null)
const processTracker = new ProcessTracker(ptyManager, () => mainWindow?.webContents ?? null)
const gitService = new GitService()
// Desktop notifications are titled with the repo (or directory) the tab's
// Claude Code session runs in, so multiple sessions stay distinguishable.
const notifier = new Notifier(
  () => mainWindow,
  async (tabId) => {
    const cwd = cwdTracker.getCwd(tabId)
    if (!cwd) return null
    const root = await gitService.repoRoot(cwd)
    return path.basename(root ?? cwd)
  }
)
const hookInstaller = new HookInstaller()

// The task box and everything else that outlives a window: SQLite under
// userData (so dev and the installed app never share a database), plus the
// control socket the CLI talks to. Fixed socket name — the CLI has to find
// it without knowing our pid; dev instances live in their own userData.
const db = openDatabase(path.join(app.getPath('userData'), 'sokking.db'))
const tasks = new TaskRepository(db)
const runs = new RunRepository(db)
const repos = new RepoRepository(db)
const runCoordinator = new RunCoordinator(
  tasks,
  runs,
  ptyManager,
  path.join(app.getPath('userData'), 'prompts')
)
const controlServer = new ControlServer(path.join(app.getPath('userData'), 'control.sock'))
tasks.onChange(() => mainWindow?.webContents.send(IPC.TaskChanged))
runs.onChange(() => mainWindow?.webContents.send(IPC.RunChanged))
ptyManager.onExit((tabId) => runCoordinator.handleTabClosed(tabId))

// Desktop-notification intake: the bus monitor feeds the filter rules,
// accepted notifications land in the task box, every one goes in the log.
const settings = new SettingsRepository(db)
const notifFilters = new NotificationFilterRepository(db)
const notifLog = new NotificationLogRepository(db)
const notifSource = new NotificationSource(notifFilters, notifLog, settings, tasks)
const notifMonitor = new NotificationMonitor(
  (n) => notifSource.handle(n),
  (message) => console.warn('[sokking] notification monitor:', message)
)
notifFilters.onChange(() => mainWindow?.webContents.send(IPC.NotifFilterChanged))
notifLog.onChange(() => mainWindow?.webContents.send(IPC.NotifLogChanged))

// GitHub rules: periodic issue searches, and the dispatcher that opens tabs
// for the tasks a rule wants processed automatically.
const rules = new RuleRepository(db)
const ruleRunner = new RuleRunner(rules, tasks, fetchIssues, (m) => console.log('[sokking] rules:', m))
const autoDispatcher = new AutoDispatcher(tasks, runs, rules, settings, () => mainWindow, (m) =>
  console.warn('[sokking] auto:', m)
)
rules.onChange(() => mainWindow?.webContents.send(IPC.RuleChanged))
const RULE_TICK_MS = 15_000

/** The log is pruned on start and daily; the cap keeps the view snappy. */
const NOTIF_LOG_KEEP = { keepDays: 14, keepCount: 2000 }

function notificationMonitorEnabled(): boolean {
  return settings.getOr(SETTING_NOTIFICATION_MONITOR_ENABLED, 'true') !== 'false'
}

function syncNotificationMonitor(): void {
  if (notificationMonitorEnabled()) {
    if (!notifMonitor.running) notifMonitor.start()
  } else {
    notifMonitor.stop()
  }
}

function notificationStatus(): NotificationStatus {
  return {
    enabled: notificationMonitorEnabled(),
    running: notifMonitor.running,
    defaultAction: notifSource.defaultAction()
  }
}

/** Turns a domain error into a renderer-facing failure; anything else propagates. */
function domainErrorMessage(e: unknown): string {
  if (e instanceof FilterError || e instanceof RuleError) return e.message
  return taskErrorMessage(e)
}

// Hook events feed both the tab status / notifications and the run's lifecycle.
const hookServer = new HookServer(socketPath, (event) => {
  notifier.handleHookEvent(event)
  runCoordinator.handleHookEvent(event)
})

function registerControlHandlers(): void {
  controlServer.handle('ping', () => ({ ok: true }))
  controlServer.handle('task.add', (req) => {
    const task = tasks.add({
      title: String(req.title ?? ''),
      body: typeof req.body === 'string' ? req.body : '',
      workdir: typeof req.workdir === 'string' ? req.workdir : null,
      source: (req.source as NewTask['source']) ?? 'manual',
      sourceRef: typeof req.sourceRef === 'string' ? req.sourceRef : null,
      sourceApp: typeof req.sourceApp === 'string' ? req.sourceApp : null
    })
    return { ok: true, task }
  })
  controlServer.handle('task.list', (req) => {
    const status = typeof req.status === 'string' ? req.status : null
    if (status && !TASK_STATUSES.includes(status as TaskStatus)) {
      throw new Error(`不明な status: ${status}`)
    }
    return { ok: true, tasks: tasks.list(status ? { status: status as TaskStatus } : {}) }
  })
}

/** Turns a domain error into a renderer-facing failure; anything else propagates. */
function taskErrorMessage(e: unknown): string {
  if (e instanceof TaskError || e instanceof RunError || e instanceof RepoError) return e.message
  throw e
}

// The global summon hotkey (default F12, overridden by the renderer's
// keybindings store via IPC once it loads). Quake-style toggle: summon the
// window from anywhere, minimize it when it's already focused.
let hotkeyAccelerator: string | null = null

function toggleWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isFocused()) {
    mainWindow.minimize()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function registerHotkey(accelerator: string | null): HotkeyRegisterResult {
  if (hotkeyAccelerator) {
    globalShortcut.unregister(hotkeyAccelerator)
    hotkeyAccelerator = null
  }
  if (!accelerator) return { ok: true }
  try {
    // register returns false when another app already grabs the key.
    if (!globalShortcut.register(accelerator, toggleWindow)) {
      return { ok: false, error: `${accelerator} を登録できません(他のアプリが使用中の可能性)` }
    }
  } catch (error) {
    // Thrown for strings that aren't valid accelerators (e.g. IME keys).
    return { ok: false, error: String(error) }
  }
  hotkeyAccelerator = accelerator
  return { ok: true }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'sokking',
    icon: appIcon,
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

/**
 * Whether a URL may be handed to the OS. Terminal output is untrusted — any
 * program can print a URL or emit an OSC 8 hyperlink — so only http(s) is let
 * through; schemes like file: or a custom app scheme would launch a local
 * handler on a single click.
 */
function isWebUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function registerIpcHandlers(): void {
  // A link clicked in a terminal (plain URL or OSC 8 hyperlink) → default browser.
  ipcMain.on(IPC.ShellOpenExternal, (_e, url: string) => {
    if (isWebUrl(url)) void shell.openExternal(url)
  })

  ipcMain.handle(IPC.PtyCreate, (_e, req: PtyCreateRequest) => {
    ptyManager.create(req.tabId, req.cwd)
  })
  ipcMain.on(IPC.PtyWrite, (_e, payload: PtyDataEvent) => {
    ptyManager.write(payload.tabId, payload.data)
  })
  ipcMain.on(IPC.PtyResize, (_e, payload: { tabId: string; cols: number; rows: number }) => {
    ptyManager.resize(payload.tabId, payload.cols, payload.rows)
  })
  ipcMain.on(IPC.PtyDispose, (_e, payload: { tabId: string }) => {
    ptyManager.dispose(payload.tabId)
    runCoordinator.handleTabClosed(payload.tabId)
  })

  ipcMain.handle(IPC.HotkeySet, (_e, accelerator: string | null) => registerHotkey(accelerator))

  // Task box. Writes answer with the stored row; validation failures come
  // back as messages instead of rejected promises so the UI can show them.
  ipcMain.handle(IPC.TaskList, (_e, filter: TaskFilter = {}) => tasks.list(filter))
  ipcMain.handle(IPC.TaskAdd, (_e, input: NewTask) => {
    try {
      return { ok: true, task: tasks.add(input) }
    } catch (e) {
      return { ok: false, error: taskErrorMessage(e) }
    }
  })
  ipcMain.handle(IPC.TaskUpdate, (_e, id: number, patch: TaskPatch) => {
    try {
      return { ok: true, task: tasks.update(id, patch) }
    } catch (e) {
      return { ok: false, error: taskErrorMessage(e) }
    }
  })
  ipcMain.handle(IPC.TaskRemove, (_e, id: number) => {
    try {
      tasks.remove(id)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: taskErrorMessage(e) }
    }
  })

  // Processing runs and the per-repository defaults of the launch dialog.
  ipcMain.handle(
    IPC.RunStart,
    async (_e, taskId: number, tabId: string, options: RunOptions) => {
      try {
        return { ok: true, run: await runCoordinator.start(taskId, tabId, options) }
      } catch (e) {
        return { ok: false, error: taskErrorMessage(e) }
      } finally {
        autoDispatcher.settle(taskId)
      }
    }
  )
  ipcMain.handle(IPC.RunListForTask, (_e, taskId: number) => runs.listForTask(taskId))
  ipcMain.handle(IPC.RepoResolve, (_e, workdir: string) => repos.resolve(workdir))
  ipcMain.handle(IPC.RepoSet, (_e, defaults: RepoDefaults) => {
    try {
      return { ok: true, repo: repos.set(defaults) }
    } catch (e) {
      return { ok: false, error: taskErrorMessage(e) }
    }
  })
  ipcMain.handle(
    IPC.PromptBuild,
    (_e, taskId: number, delivery: Delivery, pushBranch: string | null): string => {
      const task = tasks.get(taskId)
      return task ? buildPrompt(task, { delivery, pushBranch }) : ''
    }
  )

  // Desktop-notification intake: rules, log, monitor state, settings.
  ipcMain.handle(IPC.NotifFilterList, () => notifFilters.list())
  ipcMain.handle(IPC.NotifFilterAdd, (_e, input: NotificationFilterInput) => {
    try {
      return { ok: true, filter: notifFilters.add(input) }
    } catch (e) {
      return { ok: false, error: domainErrorMessage(e) }
    }
  })
  ipcMain.handle(IPC.NotifFilterUpdate, (_e, id: number, input: NotificationFilterInput) => {
    try {
      return { ok: true, filter: notifFilters.update(id, input) }
    } catch (e) {
      return { ok: false, error: domainErrorMessage(e) }
    }
  })
  ipcMain.handle(IPC.NotifFilterRemove, (_e, id: number) => {
    try {
      notifFilters.remove(id)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: domainErrorMessage(e) }
    }
  })
  ipcMain.handle(IPC.NotifFilterReorder, (_e, ids: number[]) => {
    notifFilters.reorder(ids)
    return { ok: true }
  })
  ipcMain.handle(IPC.NotifLogList, (_e, limit?: number) => notifLog.list(limit))
  ipcMain.handle(IPC.NotifLogClear, () => {
    notifLog.clear()
    return { ok: true }
  })
  ipcMain.handle(IPC.NotifStatus, () => notificationStatus())

  // GitHub rules.
  ipcMain.handle(IPC.RuleList, () => rules.list())
  ipcMain.handle(IPC.RuleAdd, (_e, input: RuleInput) => {
    try {
      return { ok: true, rule: rules.add(input) }
    } catch (e) {
      return { ok: false, error: domainErrorMessage(e) }
    }
  })
  ipcMain.handle(IPC.RuleUpdate, (_e, id: number, input: RuleInput) => {
    try {
      return { ok: true, rule: rules.update(id, input) }
    } catch (e) {
      return { ok: false, error: domainErrorMessage(e) }
    }
  })
  ipcMain.handle(IPC.RuleRemove, (_e, id: number) => {
    try {
      rules.remove(id)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: domainErrorMessage(e) }
    }
  })
  ipcMain.handle(IPC.RuleCheck, async (_e, id: number) => {
    const rule = rules.get(id)
    if (!rule) return { ok: false, error: `ルール #${id} がありません` }
    const outcome = await ruleRunner.check(rule)
    if (outcome.error) return { ok: false, error: outcome.error }
    // Auto tasks shouldn't wait for the next dispatcher tick after a manual check.
    void autoDispatcher.tick()
    return { ok: true, found: outcome.found, imported: outcome.imported.length }
  })
  ipcMain.handle(IPC.SettingGet, (_e, key: string) => settings.get(key))
  ipcMain.handle(IPC.SettingSet, (_e, key: string, value: string) => {
    settings.set(key, value)
    if (key === SETTING_NOTIFICATION_MONITOR_ENABLED) syncNotificationMonitor()
    return { ok: true }
  })

  // Directory listing for the files panel.
  ipcMain.handle(IPC.FsList, async (_e, dir: string): Promise<FsListResult> => {
    try {
      const dirents = await fs.promises.readdir(dir, { withFileTypes: true })
      const entries: FsEntry[] = await Promise.all(
        dirents.map(async (d) => {
          try {
            // stat (not lstat) so symlinks report their target's type/size.
            const st = await fs.promises.stat(path.join(dir, d.name))
            return {
              name: d.name,
              isDir: st.isDirectory(),
              size: st.isDirectory() ? null : st.size,
              mtime: st.mtimeMs
            }
          } catch {
            // broken symlink etc. — keep the entry visible
            return { name: d.name, isDir: d.isDirectory(), size: null, mtime: null }
          }
        })
      )
      return { ok: true, entries }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // Open a file (or directory) with the OS default application.
  ipcMain.handle(IPC.FsOpen, async (_e, target: string): Promise<FsOpenResult> => {
    const error = await shell.openPath(target)
    return error ? { ok: false, error } : { ok: true }
  })

  // Open a file with a specific application (the per-extension opener the
  // user configured in settings).
  ipcMain.handle(IPC.FsOpenWith, (_e, desktopFile: string, target: string): FsOpenResult => {
    // The app may have been uninstalled since it was configured.
    if (!fs.existsSync(desktopFile)) {
      return { ok: false, error: `アプリが見つかりません: ${path.basename(desktopFile)}` }
    }
    launchWith(desktopFile, target)
    return { ok: true }
  })

  // The file's MIME type chain (specific → generic), for the renderer's
  // MIME-pattern openers. Empty when xdg-mime is unavailable or stumped.
  ipcMain.handle(IPC.FsMime, async (_e, target: string): Promise<string[]> => {
    try {
      return await mimeTypesFor(target)
    } catch {
      return []
    }
  })

  // Known MIME types (+ per-media-type wildcards), for the settings UI's
  // pattern completion.
  ipcMain.handle(IPC.FsListMimeTypes, (): string[] => listMimeTypes())

  // Installed applications, for the extension→app settings UI.
  ipcMain.handle(IPC.FsListApps, (): FsAppInfo[] =>
    listAllApps(app.getLocale()).map(({ name, desktopFile }) => ({ name, desktopFile }))
  )

  // Read a file for the in-app editor. Refuses binaries (NUL byte in the
  // head) and huge files with `binary: true` so the renderer falls back to
  // an external app instead of showing an error.
  ipcMain.handle(IPC.FsReadText, async (_e, target: string): Promise<FsReadTextResult> => {
    const MAX_EDITOR_FILE = 10 * 1024 * 1024
    try {
      const st = await fs.promises.stat(target)
      if (st.isDirectory()) return { ok: false, error: 'ディレクトリです', binary: true }
      if (st.size > MAX_EDITOR_FILE) {
        return { ok: false, error: 'ファイルが大きすぎます', binary: true }
      }
      const buf = await fs.promises.readFile(target)
      if (buf.subarray(0, 8000).includes(0)) {
        return { ok: false, error: 'バイナリファイルです', binary: true }
      }
      return { ok: true, content: buf.toString('utf8'), mtime: st.mtimeMs }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), binary: false }
    }
  })

  // Save from the in-app editor. expectedMtime is what the editor last read
  // (null skips the check): a mismatch means something else wrote the file —
  // report a conflict instead of silently clobbering it.
  ipcMain.handle(
    IPC.FsWriteText,
    async (
      _e,
      target: string,
      content: string,
      expectedMtime: number | null
    ): Promise<FsWriteTextResult> => {
      try {
        if (expectedMtime !== null) {
          const st = await fs.promises.stat(target).catch(() => null)
          if (st && Math.abs(st.mtimeMs - expectedMtime) > 1) {
            return { ok: false, error: 'ディスク上のファイルが変更されています', conflict: true }
          }
        }
        await fs.promises.writeFile(target, content, 'utf8')
        const st = await fs.promises.stat(target)
        return { ok: true, mtime: st.mtimeMs }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e), conflict: false }
      }
    }
  )

  // Directory search (file names + contents) for the workspace panel.
  ipcMain.handle(IPC.WorkspaceSearch, (_e, root: string, query: string) =>
    workspaceSearch(root, query)
  )

  // Recursive entry-name search (files + dirs) for the files-tree filter.
  ipcMain.handle(IPC.FsSearchNames, (_e, root: string, query: string) =>
    searchEntryNames(root, query)
  )

  // Native file drag out of the files panel (drop into browsers' upload
  // areas, file managers, other apps). The renderer preventDefaults the DOM
  // drag and asks main to start an OS-level one instead.
  ipcMain.on(IPC.FsStartDrag, (e, target: string) => {
    const fallback = (): Electron.NativeImage =>
      nativeImage.createFromPath(appIcon).resize({ width: 32, height: 32 })
    void app
      .getFileIcon(target)
      .catch(fallback)
      .then((icon) => e.sender.startDrag({ file: target, icon: icon.isEmpty() ? fallback() : icon }))
  })

  // Right-click menu for a files-panel entry: default open, open-with app
  // list (from the target's MIME type), reveal in file manager. openerFile
  // is the configured per-extension opener; it takes over the default open.
  ipcMain.handle(IPC.FsContextMenu, async (e, target: string, x: number, y: number, openerFile?: string): Promise<void> => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? mainWindow
    if (!win) return
    const locale = app.getLocale()
    let apps: AppCandidate[] = []
    try {
      apps = await listAppsFor(target, locale)
    } catch {
      // xdg-mime/gio unavailable — the submenu just shows the all-apps list
    }
    const appItem = (a: AppCandidate): Electron.MenuItemConstructorOptions => ({
      label: a.name,
      // Menus render icons at their natural size, so downscale explicitly.
      icon: a.icon ? nativeImage.createFromPath(a.icon).resize({ width: 16, height: 16 }) : undefined,
      click: (): void => launchWith(a.desktopFile, target)
    })
    const menu = Menu.buildFromTemplate([
      {
        label: '開く',
        click: (): void => {
          if (openerFile && fs.existsSync(openerFile)) launchWith(openerFile, target)
          else void shell.openPath(target)
        }
      },
      // Files only: hand the path back to the renderer, which opens it in
      // the in-app editor panel (or falls back to an external app when the
      // content turns out to be binary).
      ...(fs.statSync(target, { throwIfNoEntry: false })?.isDirectory()
        ? []
        : [
            {
              label: 'エディタで開く',
              click: (): void => e.sender.send(IPC.FsOpenInEditor, target)
            }
          ]),
      {
        label: 'アプリケーションで開く',
        submenu: [
          ...apps.map(appItem),
          ...(apps.length ? [{ type: 'separator' as const }] : []),
          { label: 'すべてのアプリケーション', submenu: listAllApps(locale).map(appItem) }
        ]
      },
      { type: 'separator' },
      {
        label: 'コピー',
        // GNOME Files (Nautilus) paste format. Electron's clipboard holds a
        // single custom format at a time, so text/uri-list is not also set —
        // Ubuntu's default file manager is the target here.
        click: (): void => {
          clipboard.writeBuffer(
            'x-special/gnome-copied-files',
            Buffer.from(`copy\n${pathToFileURL(target).toString()}`)
          )
        }
      },
      { label: 'パスをコピー', click: () => clipboard.writeText(target) },
      { type: 'separator' },
      { label: 'ファイルマネージャーで表示', click: () => shell.showItemInFolder(target) }
    ])
    // Anchor to the clicked row (the OS cursor can be elsewhere, e.g. when
    // the menu is triggered synthetically or via keyboard).
    menu.popup({ window: win, x: Math.round(x), y: Math.round(y) })
  })

  ipcMain.handle(IPC.GitOverview, (_e, cwd: string): Promise<GitOverview> => {
    return gitService.overview(cwd)
  })
  ipcMain.handle(IPC.GitCheckout, (_e, cwd: string, branch: string): Promise<GitResult> => {
    return gitService.checkout(cwd, branch)
  })
  ipcMain.handle(IPC.GitCreateBranch, (_e, cwd: string, branch: string): Promise<GitResult> => {
    return gitService.createBranch(cwd, branch)
  })
  ipcMain.handle(IPC.GitDiff, (_e, cwd: string): Promise<GitDiffFile[]> => {
    return gitService.diff(cwd)
  })
  ipcMain.handle(IPC.GitLog, (_e, cwd: string): Promise<GitLogEntry[]> => {
    return gitService.log(cwd)
  })
  ipcMain.handle(IPC.GitCommit, (_e, cwd: string, message: string): Promise<GitResult> => {
    return gitService.commit(cwd, message)
  })
  ipcMain.handle(IPC.GitFetch, (_e, cwd: string): Promise<GitResult> => {
    return gitService.fetch(cwd)
  })
  ipcMain.handle(IPC.GitPull, (_e, cwd: string): Promise<GitResult> => {
    return gitService.pull(cwd)
  })
  ipcMain.handle(IPC.GitPush, (_e, cwd: string): Promise<GitResult> => {
    return gitService.push(cwd)
  })
  ipcMain.handle(IPC.GitUndoCommit, (_e, cwd: string): Promise<GitResult> => {
    return gitService.undoLastCommit(cwd)
  })
  ipcMain.handle(IPC.GitRevert, (_e, cwd: string, hash: string): Promise<GitResult> => {
    return gitService.revert(cwd, hash)
  })
}

app.whenReady().then(() => {
  // No application menu bar — sokking drives everything from its own UI.
  Menu.setApplicationMenu(null)
  registerIpcHandlers()
  registerControlHandlers()
  // Runs don't survive the process: whatever was open belongs to the last run of the app.
  runCoordinator.recoverAfterRestart()
  controlServer.start()
  notifLog.prune(NOTIF_LOG_KEEP)
  setInterval(() => notifLog.prune(NOTIF_LOG_KEEP), 24 * 3600_000)
  syncNotificationMonitor()
  setInterval(() => void ruleRunner.tick(), RULE_TICK_MS)
  autoDispatcher.start()
  cleanupStaleHookSockets(app.getPath('userData'))
  hookServer.start()
  cwdTracker.start()
  processTracker.start()
  createWindow()
  // Provisional default; the renderer re-registers with the saved binding on load.
  registerHotkey('F12')

  if (mainWindow) {
    void hookInstaller.promptAndInstall(mainWindow)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // Focusing the window acknowledges the pending desktop notifications: they
  // leave the OS notification list, which also clears the dock's unread badge.
  app.on('browser-window-focus', () => notifier.closeAll())
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('before-quit', () => {
  cwdTracker.stop()
  processTracker.stop()
  ptyManager.disposeAll()
  hookServer.stop()
  controlServer.stop()
  notifMonitor.stop()
  autoDispatcher.stop()
  db.close()
})
