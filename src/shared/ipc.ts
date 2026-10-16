// IPC channel names and payload types shared across main / preload / renderer.

import type { Task } from './tasks'
import type { RepoDefaults, Run } from './runs'
import type { FilterAction, NotificationFilter } from './notifications'

export const IPC = {
  PtyCreate: 'pty:create',
  PtyWrite: 'pty:write',
  PtyResize: 'pty:resize',
  PtyDispose: 'pty:dispose',
  PtyData: 'pty:data',
  PtyExit: 'pty:exit',
  TabCwd: 'tab:cwd',
  TabProcess: 'tab:process',
  TabActivity: 'tab:activity',
  AppNotification: 'notification:event',
  FsList: 'fs:list',
  FsOpen: 'fs:open',
  FsOpenWith: 'fs:open-with',
  FsListApps: 'fs:list-apps',
  FsMime: 'fs:mime',
  FsListMimeTypes: 'fs:list-mime-types',
  FsContextMenu: 'fs:context-menu',
  FsStartDrag: 'fs:start-drag',
  FsReadText: 'fs:read-text',
  FsWriteText: 'fs:write-text',
  FsOpenInEditor: 'fs:open-in-editor',
  WorkspaceSearch: 'workspace:search',
  FsSearchNames: 'fs:search-names',
  ShellOpenExternal: 'shell:open-external',
  GitOverview: 'git:overview',
  GitCheckout: 'git:checkout',
  GitCreateBranch: 'git:create-branch',
  GitDiff: 'git:diff',
  GitLog: 'git:log',
  GitCommit: 'git:commit',
  GitFetch: 'git:fetch',
  GitPull: 'git:pull',
  GitPush: 'git:push',
  GitUndoCommit: 'git:undo-commit',
  GitRevert: 'git:revert',
  HotkeySet: 'hotkey:set',
  TaskList: 'task:list',
  TaskAdd: 'task:add',
  TaskUpdate: 'task:update',
  TaskRemove: 'task:remove',
  /** main → renderer: the task box changed (any writer); re-fetch. */
  TaskChanged: 'task:changed',
  RunStart: 'run:start',
  RunListForTask: 'run:list-for-task',
  /** main → renderer: a run changed (started, session id, PR, finished). */
  RunChanged: 'run:changed',
  RepoResolve: 'repo:resolve',
  RepoSet: 'repo:set',
  PromptBuild: 'prompt:build',
  NotifFilterList: 'notif-filter:list',
  NotifFilterAdd: 'notif-filter:add',
  NotifFilterUpdate: 'notif-filter:update',
  NotifFilterRemove: 'notif-filter:remove',
  NotifFilterReorder: 'notif-filter:reorder',
  /** main → renderer: the filter rules changed. */
  NotifFilterChanged: 'notif-filter:changed',
  NotifLogList: 'notif-log:list',
  NotifLogClear: 'notif-log:clear',
  /** main → renderer: a notification was received (the log grew). */
  NotifLogChanged: 'notif-log:changed',
  NotifStatus: 'notif:status',
  SettingGet: 'setting:get',
  SettingSet: 'setting:set'
} as const

export type NotifFilterResult =
  | { ok: true; filter: NotificationFilter }
  | { ok: false; error: string }
export type OkResult = { ok: true } | { ok: false; error: string }

/** State of the desktop-notification monitor, for the notifications view. */
export interface NotificationStatus {
  enabled: boolean
  running: boolean
  defaultAction: FilterAction
}

/** Outcome of a task-box write; errors are user-facing messages. */
export type TaskResult = { ok: true; task: Task } | { ok: false; error: string }
export type TaskRemoveResult = { ok: true } | { ok: false; error: string }
export type RunStartResult = { ok: true; run: Run } | { ok: false; error: string }
export type RepoSetResult = { ok: true; repo: RepoDefaults } | { ok: false; error: string }

export interface PtyCreateRequest {
  tabId: string
  cwd?: string
}

export interface PtyDataEvent {
  tabId: string
  data: string
}

export interface PtyExitEvent {
  tabId: string
  exitCode: number
}

export interface TabCwdEvent {
  tabId: string
  cwd: string
}

export interface TabProcessEvent {
  tabId: string
  /** Foreground command name in the tab; null = shell prompt (idle). */
  process: string | null
}

/** Claude Code session status, derived from hook events. */
export type TabActivityState = 'running' | 'permission' | 'idle'

export interface TabActivityEvent {
  tabId: string
  /** null = the Claude Code session ended; the tab's status icon disappears. */
  state: TabActivityState | null
  message: string
}

/** Notification-worthy hook events, mirrored into the in-app history. */
export type AppNotificationKind = 'permission' | 'idle' | 'stop'

export interface AppNotificationEvent {
  tabId: string
  kind: AppNotificationKind
  title: string
  message: string
  /** Repo (or cwd) basename of the tab's session; null when unknown. */
  source: string | null
  /** Epoch milliseconds when the hook event was received. */
  timestamp: number
}

export interface FsEntry {
  name: string
  isDir: boolean
  /** Bytes; null for directories and unreadable entries (e.g. broken symlinks). */
  size: number | null
  /** Epoch milliseconds; null when unreadable. */
  mtime: number | null
}

export type FsListResult = { ok: true; entries: FsEntry[] } | { ok: false; error: string }

export type FsOpenResult = { ok: true } | { ok: false; error: string }

/**
 * Reading a file for the in-app editor. `binary: true` means the file exists
 * but is not editor material (binary content or too large) — the caller
 * should fall back to opening it with an external app.
 */
export type FsReadTextResult =
  | { ok: true; content: string; mtime: number }
  | { ok: false; error: string; binary: boolean }

/**
 * Saving from the in-app editor. `conflict: true` means the file's mtime no
 * longer matches what the editor read — something else wrote it in between.
 */
export type FsWriteTextResult =
  | { ok: true; mtime: number }
  | { ok: false; error: string; conflict: boolean }

/** One content-search hit in the workspace panel's directory search. */
export interface WorkspaceSearchMatch {
  /** Path relative to the searched root. */
  file: string
  /** 1-based line number. */
  line: number
  /** The matching line's text (may be trimmed for very long lines). */
  text: string
}

/**
 * Directory search for the workspace panel: file-name matches and content
 * matches in one call. `truncated` = either list hit its cap.
 */
export type WorkspaceSearchResult =
  | { ok: true; files: string[]; matches: WorkspaceSearchMatch[]; truncated: boolean }
  | { ok: false; error: string }

/** One hit of the files-tree recursive name filter (file or directory). */
export interface FsNameMatch {
  /** Path relative to the searched root. */
  path: string
  isDir: boolean
}

/**
 * Recursive name search under a root for the files-tree filter: entry names
 * (files and directories, any depth) matched by substring — against the
 * relative path instead when the query contains '/'. `truncated` = the
 * result or walk cap was hit.
 */
export type FsSearchNamesResult =
  | { ok: true; entries: FsNameMatch[]; truncated: boolean }
  | { ok: false; error: string }

/** An installed desktop application, selectable as a per-extension opener. */
export interface FsAppInfo {
  name: string
  /** Absolute path to the .desktop file — the stable id stored in settings. */
  desktopFile: string
}

export interface GitOverview {
  isRepo: boolean
  /** Absolute path of the repository root (diff paths are relative to it);
      null when not a repo. */
  root: string | null
  currentBranch: string
  branches: string[]
  hasCommits: boolean
  /** Upstream branch (e.g. "origin/main"), null when the branch tracks nothing. */
  tracking: string | null
  /** Commits ahead of / behind the upstream; both 0 without one. */
  ahead: number
  behind: number
  /** Files with working-tree changes, untracked ones included. */
  changedCount: number
}

export type GitResult = { ok: true } | { ok: false; error: string }

/** Outcome of registering the global summon hotkey (the OS grab can fail). */
export type HotkeyRegisterResult = { ok: true } | { ok: false; error: string }

export type DiffLineType = 'add' | 'del' | 'context'

export interface GitDiffLine {
  type: DiffLineType
  text: string
  oldLine: number | null
  newLine: number | null
}

export interface GitDiffHunk {
  header: string
  lines: GitDiffLine[]
}

export type DiffFileStatus = 'modified' | 'added' | 'deleted' | 'renamed'

export interface GitDiffFile {
  path: string
  oldPath: string | null
  status: DiffFileStatus
  hunks: GitDiffHunk[]
}

export interface GitLogEntry {
  hash: string
  shortHash: string
  subject: string
  author: string
  /** ISO-ish date string from git (e.g. "2026-07-11 10:59:22 +0900"). */
  date: string
  isHead: boolean
}
