import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'

export interface HookEvent {
  tabId: string
  hookEventName: string
  notificationType?: string
  message?: string
  /** Claude Code session id (every event carries it). */
  sessionId?: string
}

/**
 * Removes hook-<pid>.sock files left behind by instances that are no longer
 * running (crash, SIGKILL). Live instances' sockets are left untouched, so
 * multiple sokking processes can coexist.
 */
export function cleanupStaleHookSockets(dir: string): void {
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const match = /^hook-(\d+)\.sock$/.exec(name)
    if (!match) continue
    const pid = Number(match[1])
    if (pid === process.pid) continue
    try {
      process.kill(pid, 0) // throws when the owner is gone
    } catch {
      try {
        fs.unlinkSync(path.join(dir, name))
      } catch {
        // already gone
      }
    }
  }
}

/**
 * Unix domain socket server that receives events from the sokking-hook
 * script registered in Claude Code's hooks (Notification / Stop).
 */
export class HookServer {
  private server: net.Server | null = null

  constructor(
    public readonly socketPath: string,
    private onEvent: (event: HookEvent) => void
  ) {}

  start(): void {
    fs.mkdirSync(path.dirname(this.socketPath), { recursive: true })
    if (fs.existsSync(this.socketPath)) fs.unlinkSync(this.socketPath)

    this.server = net.createServer((conn) => {
      let buf = ''
      conn.on('data', (chunk) => {
        buf += chunk.toString('utf8')
      })
      conn.on('end', () => {
        for (const line of buf.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const parsed = JSON.parse(trimmed) as HookEvent
            if (parsed.tabId && parsed.hookEventName) this.onEvent(parsed)
          } catch {
            // ignore malformed payloads
          }
        }
      })
      conn.on('error', () => {})
    })
    this.server.on('error', (err) => {
      console.error('[sokking] hook server error:', err)
    })
    this.server.listen(this.socketPath)
  }

  stop(): void {
    this.server?.close()
    this.server = null
    try {
      fs.unlinkSync(this.socketPath)
    } catch {
      // already gone
    }
  }
}
