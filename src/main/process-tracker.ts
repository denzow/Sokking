import fs from 'node:fs'
import path from 'node:path'
import { WebContents } from 'electron'
import { IPC, TabProcessEvent } from '../shared/ipc'
import { defaultShell, PtyManager } from './pty-manager'

/**
 * Interpreters whose argv[0] says nothing about what is actually running —
 * for these the displayed name is the script/module they execute instead.
 * Matched against argv[0] with any version suffix removed (python3.10 → python).
 */
const INTERPRETERS = new Set(['python', 'node', 'ruby', 'php', 'perl', 'sh', 'bash', 'zsh'])

/** Flags that consume the next argv entry, so it must not be taken as the script. */
const FLAGS_WITH_VALUE = new Set(['-r', '--require', '--loader', '--import', '-W', '-X', '-I'])

interface ForegroundCommand {
  pid: number
  argv: string[]
}

/**
 * The pty's foreground process group leader and its full argv, resolved via
 * /proc/<shellPid>/stat field tpgid + /proc/<tpgid>/cmdline (Linux only,
 * which sokking targets). Null when unreadable (e.g. the group leader of a
 * pipeline already exited).
 */
function foregroundCommand(shellPid: number): ForegroundCommand | null {
  try {
    const stat = fs.readFileSync(`/proc/${shellPid}/stat`, 'utf8')
    // comm (field 2) may itself contain spaces/parens — parse after the last ')'.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    const tpgid = Number(fields[5])
    if (!Number.isInteger(tpgid) || tpgid <= 0) return null
    const argv = fs
      .readFileSync(`/proc/${tpgid}/cmdline`, 'utf8')
      .split('\0')
      .filter((a) => a !== '')
    return argv.length > 0 ? { pid: tpgid, argv } : null
  } catch {
    return null
  }
}

/** Display name for an argv: the script for interpreter commands, else argv[0]. */
function displayName(argv: string[]): string {
  const name = path.basename(argv[0])
  if (!INTERPRETERS.has(name.replace(/[.\d]+$/, ''))) return name
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-m' && argv[i + 1]) return argv[i + 1] // python -m module
    if (arg === '-c' || arg === '-e') return name // inline code, not a script
    if (FLAGS_WITH_VALUE.has(arg)) {
      i++
      continue
    }
    if (arg.startsWith('-')) continue
    return path.basename(arg)
  }
  return name
}

/**
 * Polls each pty's foreground command so tabs can show what is running. For
 * interpreters (python, node, ruby, ...) the script name is shown rather than
 * the interpreter. The shell sitting at its prompt is reported as null —
 * "nothing running".
 */
export class ProcessTracker {
  private cache = new Map<string, string | null>()
  private timer: NodeJS.Timeout | null = null
  private shellName = path.basename(defaultShell())

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

  private poll(): void {
    const fallbackNames = this.ptyManager.foregroundProcesses()
    for (const [tabId, shellPid] of this.ptyManager.pids()) {
      const proc = this.resolve(shellPid, fallbackNames.get(tabId) ?? '')
      if (this.cache.has(tabId) && this.cache.get(tabId) === proc) continue
      this.cache.set(tabId, proc)
      const payload: TabProcessEvent = { tabId, process: proc }
      this.getWebContents()?.send(IPC.TabProcess, payload)
    }
  }

  private resolve(shellPid: number, nodePtyName: string): string | null {
    const fg = foregroundCommand(shellPid)
    if (fg) {
      if (fg.pid === shellPid) return null // the tab's shell at its prompt
      const name = displayName(fg.argv)
      // A bare nested shell at its prompt is "nothing running" too.
      return name === '' || name === this.shellName ? null : name
    }
    // /proc read failed — fall back to node-pty's name (argv[0] only).
    const name = path.basename(nodePtyName)
    return name === '' || name === this.shellName ? null : name
  }
}
