import fs from 'node:fs'
import path from 'node:path'
import type { TaskRepository } from '../core/tasks'
import { RunError, RunRepository } from '../core/runs'
import { findPrUrl } from '../core/prompt'
import type { Run, RunOptions } from '../shared/runs'
import type { HookEvent } from './hook-server'
import type { PtyManager } from './pty-manager'

/** How long to wait for a freshly opened tab's shell before giving up on the launch. */
const PTY_WAIT_MS = 5000

/**
 * Launches Claude Code for a task inside a tab's shell and follows the
 * session through the hook events to move the task between running and
 * review, record the session id and the PR it produced, and close the run
 * when the session (or the tab) ends.
 */
export class RunCoordinator {
  constructor(
    private tasks: TaskRepository,
    private runs: RunRepository,
    private pty: PtyManager,
    /** Where the per-run prompt files go (the command reads the prompt from a file). */
    private promptDir: string
  ) {}

  async start(taskId: number, tabId: string, options: RunOptions): Promise<Run> {
    const task = this.tasks.get(taskId)
    if (!task) throw new RunError(`タスク #${taskId} がありません`)
    // A tab hosts one run at a time; relaunching in the same tab supersedes
    // the previous session (the user restarted it on purpose).
    const previous = this.runs.openForTab(tabId)
    if (previous) this.runs.finish(previous.id, 'done')

    const run = this.runs.start(taskId, tabId, options)
    this.tasks.update(taskId, { status: 'running', workdir: options.workdir, autoPending: false })

    fs.mkdirSync(this.promptDir, { recursive: true })
    const promptFile = path.join(this.promptDir, `run-${run.id}.md`)
    fs.writeFileSync(promptFile, options.prompt, { mode: 0o600 })

    if (!(await this.pty.waitFor(tabId, PTY_WAIT_MS))) {
      this.runs.finish(run.id, 'failed')
      throw new RunError('タブのシェルが起動しませんでした')
    }
    this.pty.write(tabId, launchCommand(options, promptFile) + '\n')
    return run
  }

  handleHookEvent(event: HookEvent): void {
    const run = this.runs.openForTab(event.tabId)
    if (!run) return
    switch (event.hookEventName) {
      case 'SessionStart':
        if (event.sessionId && !run.sessionId) this.runs.setSessionId(run.id, event.sessionId)
        this.setTaskStatus(run.taskId, 'running')
        break
      case 'UserPromptSubmit':
        // The person asked for more work in the tab — the task is active again.
        this.setTaskStatus(run.taskId, 'running')
        break
      case 'Stop': {
        // Each turn ends with Stop; the result is ready for a look. The PR
        // URL, when the turn reported one, is remembered for the task panel.
        const prUrl = event.message ? findPrUrl(event.message) : null
        if (prUrl && !run.prUrl) this.runs.setPrUrl(run.id, prUrl)
        this.setTaskStatus(run.taskId, 'review')
        break
      }
      case 'SessionEnd':
        this.runs.finish(run.id, 'done')
        this.setTaskStatus(run.taskId, 'review', { from: 'running' })
        break
    }
  }

  /** The tab's shell is gone (closed or exited): the run, if open, ended with it. */
  handleTabClosed(tabId: string): void {
    const run = this.runs.openForTab(tabId)
    if (!run) return
    this.runs.finish(run.id, 'interrupted')
    this.setTaskStatus(run.taskId, 'review', { from: 'running' })
  }

  /**
   * Nothing survives a restart on the pty side: every run left open belongs
   * to a session that no longer exists, and its task needs a person's look.
   */
  recoverAfterRestart(): void {
    this.runs.finishAllOpen('interrupted')
    for (const task of this.tasks.list({ status: 'running' })) {
      this.tasks.setStatus(task.id, 'review')
    }
  }

  private setTaskStatus(
    taskId: number,
    status: 'running' | 'review',
    guard: { from?: 'running' } = {}
  ): void {
    const task = this.tasks.get(taskId)
    if (!task || task.status === status) return
    if (guard.from && task.status !== guard.from) return
    // Done / archived tasks stay put — a late hook event must not reopen them.
    if (task.status === 'done' || task.status === 'archived') return
    this.tasks.setStatus(taskId, status)
  }
}

/**
 * The shell line that launches the session. The prompt travels through a
 * file so quoting is a non-issue and the terminal isn't flooded with it.
 */
export function launchCommand(options: RunOptions, promptFile: string): string {
  const mode = options.permissionMode === 'default' ? '' : ` --permission-mode ${options.permissionMode}`
  return `claude${mode} "$(cat ${shellQuote(promptFile)})"`
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
