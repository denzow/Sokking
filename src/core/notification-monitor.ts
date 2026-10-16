import { ChildProcess, spawn } from 'node:child_process'
import type { DesktopNotification } from '../shared/notifications'

/**
 * Watches the session bus for desktop notifications. `busctl monitor` (part
 * of systemd, present on every Ubuntu desktop) does the D-Bus work and
 * prints one JSON object per message, so there's no native binding to
 * build and no protocol code to maintain here.
 *
 * Two paths are watched: the freedesktop `Notify` call that libnotify,
 * Electron apps and browsers make, and GNOME's `AddNotification` that
 * portal-using (snap / Flatpak) apps end up on.
 */
const MATCHES = [
  "interface='org.freedesktop.Notifications',member='Notify'",
  "interface='org.gtk.Notifications',member='AddNotification'"
]

/**
 * GNOME Shell re-sends a received Notify to itself on the bus, so the same
 * notification shows up twice within milliseconds. Identical content inside
 * this window is one notification.
 */
const DEDUPE_WINDOW_MS = 3000

const RESTART_DELAY_MS = 5000

interface BusMessage {
  type?: string
  interface?: string
  member?: string
  payload?: { type?: string; data?: unknown[] }
}

/** Parses one line of `busctl monitor --json=short`; null for anything else. */
export function parseBusLine(line: string, receivedAt = new Date().toISOString()): DesktopNotification | null {
  let msg: BusMessage
  try {
    msg = JSON.parse(line) as BusMessage
  } catch {
    return null
  }
  if (msg.type !== 'method_call' || !Array.isArray(msg.payload?.data)) return null
  const data = msg.payload.data
  if (msg.interface === 'org.freedesktop.Notifications' && msg.member === 'Notify') {
    // Notify(app_name, replaces_id, app_icon, summary, body, actions, hints, timeout)
    const [app, , , summary, body] = data
    return {
      app: str(app),
      title: str(summary),
      body: stripMarkup(str(body)),
      receivedAt
    }
  }
  if (msg.interface === 'org.gtk.Notifications' && msg.member === 'AddNotification') {
    // AddNotification(app_id, id, a{sv} notification) — title / body in the dict.
    const [appId, , dict] = data
    const fields = (dict ?? {}) as Record<string, { data?: unknown }>
    return {
      app: str(appId),
      title: str(fields.title?.data),
      body: stripMarkup(str(fields.body?.data)),
      receivedAt
    }
  }
  return null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Notification bodies may carry a little Pango markup (<b>, <i>, <a>). */
function stripMarkup(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Drops a notification identical to one seen moments ago. */
export class Deduplicator {
  private recent: { key: string; at: number }[] = []

  constructor(private windowMs = DEDUPE_WINDOW_MS) {}

  isDuplicate(n: DesktopNotification, now = Date.now()): boolean {
    const key = `${n.app}\u0000${n.title}\u0000${n.body}`
    this.recent = this.recent.filter((r) => now - r.at < this.windowMs)
    if (this.recent.some((r) => r.key === key)) return true
    this.recent.push({ key, at: now })
    return false
  }
}

export class NotificationMonitor {
  private proc: ChildProcess | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private stopped = true
  private dedupe = new Deduplicator()

  constructor(
    private onNotification: (n: DesktopNotification) => void,
    private log: (message: string) => void = () => {}
  ) {}

  get running(): boolean {
    return this.proc !== null
  }

  start(): void {
    this.stopped = false
    this.spawn()
  }

  stop(): void {
    this.stopped = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    this.proc?.kill()
    this.proc = null
  }

  private spawn(): void {
    if (this.stopped || this.proc) return
    const args = ['--user', 'monitor', '--json=short', ...MATCHES.flatMap((m) => ['--match', m])]
    let proc: ChildProcess
    try {
      proc = spawn('busctl', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      this.log(`busctl を起動できません: ${e instanceof Error ? e.message : e}`)
      this.scheduleRestart()
      return
    }
    this.proc = proc
    let buf = ''
    proc.stdout?.setEncoding('utf8')
    proc.stdout?.on('data', (chunk: string) => {
      buf += chunk
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        const n = parseBusLine(line)
        if (n && !this.dedupe.isDuplicate(n)) this.onNotification(n)
      }
    })
    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (chunk: string) => this.log(`busctl: ${chunk.trim()}`))
    proc.on('error', (err) => this.log(`busctl エラー: ${err.message}`))
    proc.on('exit', (code, signal) => {
      if (this.proc === proc) this.proc = null
      if (this.stopped) return
      this.log(`busctl が終了しました (code=${code} signal=${signal})。再起動します`)
      this.scheduleRestart()
    })
  }

  private scheduleRestart(): void {
    if (this.stopped || this.restartTimer) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.spawn()
    }, RESTART_DELAY_MS)
  }
}
