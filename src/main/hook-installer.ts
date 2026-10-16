import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'

const HOOK_MARKER = 'sokking-hook.js'

interface HookCommand {
  type: 'command'
  command: string
}

interface HookMatcherEntry {
  matcher?: string
  hooks: HookCommand[]
}

/** Every hook event the tab status icon needs. */
const REQUIRED_ENTRIES: { event: string; matcher?: string }[] = [
  { event: 'Notification', matcher: 'permission_prompt' },
  { event: 'Notification', matcher: 'idle_prompt' },
  { event: 'Stop' },
  { event: 'SessionStart' },
  { event: 'SessionEnd' },
  { event: 'UserPromptSubmit' },
  { event: 'PreToolUse' }
]

/**
 * Installs the sokking hook forwarder into ~/.claude/settings.json so that
 * Claude Code reports its session lifecycle (start/end), activity
 * (prompt submit / tool use / turn completion) and prompts (permission, idle)
 * back to the originating tab.
 */
export class HookInstaller {
  private settingsPath = path.join(os.homedir(), '.claude', 'settings.json')

  hookScriptPath(): string {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'sokking-hook.js')
      : path.join(app.getAppPath(), 'resources', 'sokking-hook.js')
  }

  isInstalled(): boolean {
    try {
      const raw = fs.readFileSync(this.settingsPath, 'utf8')
      return raw.includes(HOOK_MARKER)
    } catch {
      return false
    }
  }

  /** Whether every event in REQUIRED_ENTRIES already has a sokking hook. */
  private isComplete(): boolean {
    try {
      const raw = fs.readFileSync(this.settingsPath, 'utf8')
      const settings = JSON.parse(raw) as Record<string, unknown>
      const hooks = (settings.hooks ?? {}) as Record<string, HookMatcherEntry[]>
      return REQUIRED_ENTRIES.every(({ event, matcher }) =>
        (hooks[event] ?? []).some(
          (e) =>
            (e.matcher ?? undefined) === matcher &&
            e.hooks?.some((h) => h.command?.includes(HOOK_MARKER))
        )
      )
    } catch {
      return false
    }
  }

  async promptAndInstall(win: BrowserWindow): Promise<void> {
    if (this.isComplete()) return
    if (this.isInstalled()) {
      // The user already opted in; just register newly required events.
      try {
        this.install()
      } catch (e) {
        console.error('[sokking] hook upgrade failed:', e)
      }
      return
    }
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['セットアップする', 'あとで'],
      defaultId: 0,
      cancelId: 1,
      title: 'Claude Code 連携',
      message: 'Claude Code 連携をセットアップしますか?',
      detail:
        '~/.claude/settings.json に hooks を登録し、Claude Code の実行状況（実行中・許可待ち・入力待ち）をタブに表示できるようにします。sokking 以外で起動した Claude Code には影響しません。'
    })
    if (response === 0) {
      try {
        this.install()
      } catch (e) {
        dialog.showErrorBox(
          'hooks の登録に失敗しました',
          e instanceof Error ? e.message : String(e)
        )
      }
    }
  }

  install(): void {
    const command = `node "${this.hookScriptPath()}"`

    let settings: Record<string, unknown> = {}
    if (fs.existsSync(this.settingsPath)) {
      const raw = fs.readFileSync(this.settingsPath, 'utf8')
      settings = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {}
      fs.writeFileSync(this.settingsPath + '.sokking.bak', raw)
    } else {
      fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true })
    }

    const hooks = (settings.hooks ?? {}) as Record<string, HookMatcherEntry[]>
    settings.hooks = hooks

    for (const { event, matcher } of REQUIRED_ENTRIES) {
      this.ensureEntry(hooks, event, matcher, command)
    }

    fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2) + '\n')
  }

  private ensureEntry(
    hooks: Record<string, HookMatcherEntry[]>,
    event: string,
    matcher: string | undefined,
    command: string
  ): void {
    if (!Array.isArray(hooks[event])) hooks[event] = []
    const entries = hooks[event]
    const existing = entries.find(
      (e) => (e.matcher ?? undefined) === matcher && e.hooks?.some((h) => h.command?.includes(HOOK_MARKER))
    )
    if (existing) {
      // refresh the command path (e.g. app was moved)
      for (const h of existing.hooks) {
        if (h.command?.includes(HOOK_MARKER)) h.command = command
      }
      return
    }
    const entry: HookMatcherEntry = { hooks: [{ type: 'command', command }] }
    if (matcher !== undefined) entry.matcher = matcher
    entries.push(entry)
  }
}
