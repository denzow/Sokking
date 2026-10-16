import type { BrowserWindow } from 'electron'
import { buildPrompt } from '../core/prompt'
import { issueNumberFromUrl } from '../core/github'
import type { RuleRepository } from '../core/rules'
import type { RunRepository } from '../core/runs'
import type { SettingsRepository } from '../core/settings'
import type { TaskRepository } from '../core/tasks'
import { prepareIssueWorktree } from '../core/worktree'
import { ensureFolderTrusted } from '../core/claude-config'
import { IPC } from '../shared/ipc'
import { AutoRunRequest, DEFAULT_MAX_PARALLEL_RUNS, SETTING_MAX_PARALLEL_RUNS } from '../shared/rules'
import type { RunOptions } from '../shared/runs'
import type { Task } from '../shared/tasks'

/** How often pending auto tasks are looked at. */
const TICK_MS = 5000
/** A request the renderer hasn't turned into a run within this time is retried. */
const IN_FLIGHT_TIMEOUT_MS = 30_000

/**
 * Starts the tasks that rules marked for automatic processing. The run
 * itself needs a tab (a pty lives in the renderer's terminal), so the
 * dispatcher prepares the worktree and the options, then asks the window
 * to open the tab and launch. Parallelism is capped by a setting.
 */
export class AutoDispatcher {
  private timer: NodeJS.Timeout | null = null
  private inFlight = new Map<number, number>()
  private busy = false

  constructor(
    private tasks: TaskRepository,
    private runs: RunRepository,
    private rules: RuleRepository,
    private settings: SettingsRepository,
    private getWindow: () => BrowserWindow | null,
    private log: (message: string) => void = () => {}
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), TICK_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  maxParallel(): number {
    const raw = Number(this.settings.get(SETTING_MAX_PARALLEL_RUNS))
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_MAX_PARALLEL_RUNS
  }

  /** The renderer started (or failed to start) the run: the request is no longer in flight. */
  settle(taskId: number): void {
    this.inFlight.delete(taskId)
  }

  async tick(): Promise<void> {
    if (this.busy) return
    const win = this.getWindow()
    if (!win) return
    this.busy = true
    try {
      const now = Date.now()
      for (const [taskId, at] of this.inFlight) {
        if (now - at > IN_FLIGHT_TIMEOUT_MS) this.inFlight.delete(taskId)
      }
      const limit = this.maxParallel()
      let open = this.runs.listOpen().length + this.inFlight.size
      for (const task of this.tasks.listAutoPending()) {
        if (open >= limit) break
        if (this.inFlight.has(task.id)) continue
        const request = await this.prepare(task)
        if (!request) continue
        this.inFlight.set(task.id, Date.now())
        open++
        win.webContents.send(IPC.AutoRunRequest, request)
      }
    } finally {
      this.busy = false
    }
  }

  private async prepare(task: Task): Promise<AutoRunRequest | null> {
    const rule = task.ruleId === null ? null : this.rules.get(task.ruleId)
    if (!rule) {
      // The rule is gone; the task stays in the box for a person.
      this.tasks.update(task.id, { autoPending: false })
      return null
    }
    const issueNumber = task.sourceRef ? issueNumberFromUrl(task.sourceRef) : null
    let workdir = rule.workdir
    if (issueNumber !== null) {
      try {
        workdir = await prepareIssueWorktree(rule.workdir, issueNumber)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        this.log(`#${task.id} の worktree を用意できません: ${message}`)
        this.rules.markChecked(rule.id, `worktree: ${message}`)
        this.tasks.update(task.id, { autoPending: false })
        return null
      }
    }
    // Nobody is there to answer Claude Code's first-run trust prompt.
    try {
      ensureFolderTrusted(workdir)
    } catch (e) {
      this.log(`信頼設定を書けません (${workdir}): ${e instanceof Error ? e.message : e}`)
    }
    const options: RunOptions = {
      workdir,
      permissionMode: rule.permissionMode,
      delivery: rule.delivery,
      pushBranch: rule.pushBranch,
      prompt: buildPrompt(task, {
        delivery: rule.delivery,
        pushBranch: rule.pushBranch,
        template: rule.promptTemplate
      }),
      mode: 'auto'
    }
    return { taskId: task.id, title: task.title, options }
  }
}
