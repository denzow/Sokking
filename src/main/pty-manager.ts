import * as pty from 'node-pty'
import os from 'node:os'
import fs from 'node:fs'
import { WebContents } from 'electron'
import { IPC, PtyDataEvent, PtyExitEvent } from '../shared/ipc'

interface PtySession {
  tabId: string
  proc: pty.IPty
}

/** The shell every tab runs; also the "idle" marker for process tracking. */
export function defaultShell(): string {
  return process.env.SHELL || '/bin/bash'
}

export class PtyManager {
  private sessions = new Map<string, PtySession>()
  private exitListeners = new Set<(tabId: string) => void>()

  constructor(
    private getWebContents: () => WebContents | null,
    private socketPath: string
  ) {}

  create(tabId: string, cwd?: string): void {
    if (this.sessions.has(tabId)) return
    const shell = defaultShell()
    // A restored cwd may no longer exist — fall back to home rather than crash.
    const startDir = cwd && this.isDir(cwd) ? cwd : os.homedir()
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      SOKKING_TAB_ID: tabId,
      SOKKING_SOCKET: this.socketPath
    }
    // sokking's own runtime markers must not leak into user shells: an
    // inherited NODE_ENV=production makes npm silently omit devDependencies
    // on install, wrecking node_modules of whatever repo the tab is in.
    delete env.NODE_ENV
    delete env.NODE_ENV_ELECTRON_VITE
    const proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: startDir,
      env
    })

    proc.onData((data) => {
      const payload: PtyDataEvent = { tabId, data }
      this.getWebContents()?.send(IPC.PtyData, payload)
    })

    proc.onExit(({ exitCode }) => {
      this.sessions.delete(tabId)
      const payload: PtyExitEvent = { tabId, exitCode }
      this.getWebContents()?.send(IPC.PtyExit, payload)
      for (const listener of this.exitListeners) listener(tabId)
    })

    this.sessions.set(tabId, { tabId, proc })
  }

  private isDir(path: string): boolean {
    try {
      return fs.statSync(path).isDirectory()
    } catch {
      return false
    }
  }

  write(tabId: string, data: string): void {
    this.sessions.get(tabId)?.proc.write(data)
  }

  has(tabId: string): boolean {
    return this.sessions.has(tabId)
  }

  /** Main-side notice that a tab's shell exited (the renderer gets PtyExit). */
  onExit(listener: (tabId: string) => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  /**
   * Resolves once the tab's pty exists. The renderer creates the pty when
   * the tab's terminal mounts, which can land after a request that wants
   * to write into it (launching a run right after opening the tab).
   */
  async waitFor(tabId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (!this.sessions.has(tabId)) {
      if (Date.now() > deadline) return false
      await new Promise((r) => setTimeout(r, 50))
    }
    return true
  }

  resize(tabId: string, cols: number, rows: number): void {
    if (cols < 2 || rows < 2) return
    try {
      this.sessions.get(tabId)?.proc.resize(cols, rows)
    } catch {
      // resize can race with process exit
    }
  }

  dispose(tabId: string): void {
    const session = this.sessions.get(tabId)
    if (!session) return
    this.sessions.delete(tabId)
    session.proc.kill()
  }

  disposeAll(): void {
    for (const tabId of [...this.sessions.keys()]) this.dispose(tabId)
  }

  pids(): Map<string, number> {
    const result = new Map<string, number>()
    for (const [tabId, session] of this.sessions) result.set(tabId, session.proc.pid)
    return result
  }

  /**
   * Foreground process name (argv[0]) per tab, straight from node-pty
   * (tcgetpgrp on the pty + /proc/<pgrp>/cmdline). The shell itself when the
   * tab sits at the prompt.
   */
  foregroundProcesses(): Map<string, string> {
    const result = new Map<string, string>()
    for (const [tabId, session] of this.sessions) result.set(tabId, session.proc.process)
    return result
  }
}
