import fs from 'node:fs'
import { WebContents } from 'electron'
import { IPC, TabCwdEvent } from '../shared/ipc'
import { PtyManager } from './pty-manager'

/**
 * Polls /proc/<pid>/cwd for each pty's shell to track the current directory
 * of every tab (Linux only, which sokking targets).
 */
export class CwdTracker {
  private cache = new Map<string, string>()
  private timer: NodeJS.Timeout | null = null

  constructor(
    private ptyManager: PtyManager,
    private getWebContents: () => WebContents | null
  ) {}

  start(intervalMs = 1500): void {
    this.timer = setInterval(() => this.poll(), intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  getCwd(tabId: string): string | null {
    return this.cache.get(tabId) ?? null
  }

  private poll(): void {
    for (const [tabId, pid] of this.ptyManager.pids()) {
      let cwd: string
      try {
        cwd = fs.readlinkSync(`/proc/${pid}/cwd`)
      } catch {
        continue
      }
      if (this.cache.get(tabId) === cwd) continue
      this.cache.set(tabId, cwd)
      const payload: TabCwdEvent = { tabId, cwd }
      this.getWebContents()?.send(IPC.TabCwd, payload)
    }
  }
}
