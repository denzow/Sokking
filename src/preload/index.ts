import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import {
  AppNotificationEvent,
  FsAppInfo,
  FsListResult,
  FsOpenResult,
  FsReadTextResult,
  FsSearchNamesResult,
  FsWriteTextResult,
  GitDiffFile,
  GitLogEntry,
  GitOverview,
  GitResult,
  HotkeyRegisterResult,
  IPC,
  PtyDataEvent,
  PtyExitEvent,
  TabActivityEvent,
  TabCwdEvent,
  TabProcessEvent,
  WorkspaceSearchResult
} from '../shared/ipc'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  /** The user's home directory, for ~ expansion/abbreviation in the renderer. */
  homeDir: process.env.HOME ?? '',

  ptyCreate: (tabId: string, cwd?: string): Promise<void> =>
    ipcRenderer.invoke(IPC.PtyCreate, { tabId, cwd }),
  ptyWrite: (tabId: string, data: string): void =>
    ipcRenderer.send(IPC.PtyWrite, { tabId, data }),
  ptyResize: (tabId: string, cols: number, rows: number): void =>
    ipcRenderer.send(IPC.PtyResize, { tabId, cols, rows }),
  ptyDispose: (tabId: string): void => ipcRenderer.send(IPC.PtyDispose, { tabId }),

  onPtyData: (cb: (payload: PtyDataEvent) => void): (() => void) => subscribe(IPC.PtyData, cb),
  onPtyExit: (cb: (payload: PtyExitEvent) => void): (() => void) => subscribe(IPC.PtyExit, cb),
  onTabCwd: (cb: (payload: TabCwdEvent) => void): (() => void) => subscribe(IPC.TabCwd, cb),
  onTabProcess: (cb: (payload: TabProcessEvent) => void): (() => void) =>
    subscribe(IPC.TabProcess, cb),
  onTabActivity: (cb: (payload: TabActivityEvent) => void): (() => void) =>
    subscribe(IPC.TabActivity, cb),
  onNotification: (cb: (payload: AppNotificationEvent) => void): (() => void) =>
    subscribe(IPC.AppNotification, cb),

  fsList: (dir: string): Promise<FsListResult> => ipcRenderer.invoke(IPC.FsList, dir),
  fsOpen: (target: string): Promise<FsOpenResult> => ipcRenderer.invoke(IPC.FsOpen, target),
  fsOpenWith: (desktopFile: string, target: string): Promise<FsOpenResult> =>
    ipcRenderer.invoke(IPC.FsOpenWith, desktopFile, target),
  fsListApps: (): Promise<FsAppInfo[]> => ipcRenderer.invoke(IPC.FsListApps),
  fsMime: (target: string): Promise<string[]> => ipcRenderer.invoke(IPC.FsMime, target),
  fsListMimeTypes: (): Promise<string[]> => ipcRenderer.invoke(IPC.FsListMimeTypes),
  fsContextMenu: (target: string, x: number, y: number, openerFile?: string): Promise<void> =>
    ipcRenderer.invoke(IPC.FsContextMenu, target, x, y, openerFile),
  /** Start an OS-native drag of the file/directory (for drops outside the app). */
  fsStartDrag: (target: string): void => ipcRenderer.send(IPC.FsStartDrag, target),
  /** Read a file for the in-app editor (binary/huge files are refused). */
  fsReadText: (target: string): Promise<FsReadTextResult> =>
    ipcRenderer.invoke(IPC.FsReadText, target),
  /** Save from the in-app editor; expectedMtime detects outside writes (null skips). */
  fsWriteText: (
    target: string,
    content: string,
    expectedMtime: number | null
  ): Promise<FsWriteTextResult> =>
    ipcRenderer.invoke(IPC.FsWriteText, target, content, expectedMtime),
  /** Fired by the files-panel context menu's 「エディタで開く」. */
  onOpenInEditor: (cb: (path: string) => void): (() => void) =>
    subscribe(IPC.FsOpenInEditor, cb),
  /** Directory search (file names + contents) for the workspace panel. */
  workspaceSearch: (root: string, query: string): Promise<WorkspaceSearchResult> =>
    ipcRenderer.invoke(IPC.WorkspaceSearch, root, query),
  /** Recursive entry-name search (files + dirs) for the files-tree filter. */
  fsSearchNames: (root: string, query: string): Promise<FsSearchNamesResult> =>
    ipcRenderer.invoke(IPC.FsSearchNames, root, query),

  /** Open an http(s) URL in the default browser; other schemes are ignored. */
  openExternal: (url: string): void => ipcRenderer.send(IPC.ShellOpenExternal, url),

  gitOverview: (cwd: string): Promise<GitOverview> => ipcRenderer.invoke(IPC.GitOverview, cwd),
  gitCheckout: (cwd: string, branch: string): Promise<GitResult> =>
    ipcRenderer.invoke(IPC.GitCheckout, cwd, branch),
  gitCreateBranch: (cwd: string, branch: string): Promise<GitResult> =>
    ipcRenderer.invoke(IPC.GitCreateBranch, cwd, branch),
  gitDiff: (cwd: string): Promise<GitDiffFile[]> => ipcRenderer.invoke(IPC.GitDiff, cwd),
  gitLog: (cwd: string): Promise<GitLogEntry[]> => ipcRenderer.invoke(IPC.GitLog, cwd),
  gitCommit: (cwd: string, message: string): Promise<GitResult> =>
    ipcRenderer.invoke(IPC.GitCommit, cwd, message),
  gitFetch: (cwd: string): Promise<GitResult> => ipcRenderer.invoke(IPC.GitFetch, cwd),
  gitPull: (cwd: string): Promise<GitResult> => ipcRenderer.invoke(IPC.GitPull, cwd),
  gitPush: (cwd: string): Promise<GitResult> => ipcRenderer.invoke(IPC.GitPush, cwd),
  gitUndoCommit: (cwd: string): Promise<GitResult> => ipcRenderer.invoke(IPC.GitUndoCommit, cwd),
  gitRevert: (cwd: string, hash: string): Promise<GitResult> =>
    ipcRenderer.invoke(IPC.GitRevert, cwd, hash),

  setGlobalHotkey: (accelerator: string | null): Promise<HotkeyRegisterResult> =>
    ipcRenderer.invoke(IPC.HotkeySet, accelerator)
}

export type SokkingApi = typeof api

contextBridge.exposeInMainWorld('sokking', api)
