import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Request/response over a Unix domain socket, one JSON object per line.
 * The CLI (`bin/sokking.js`) and other local tools reach the running app
 * through it; the protocol is deliberately tiny so a shell script with
 * `nc -U` could speak it too.
 *
 * Request:  {"op": "task.add", "title": "...", ...}
 * Response: {"ok": true, ...} | {"ok": false, "error": "..."}
 */
export type ControlRequest = { op: string } & Record<string, unknown>
export type ControlResponse = { ok: true } & Record<string, unknown>
export type ControlHandler = (req: ControlRequest) => ControlResponse | Promise<ControlResponse>

export class ControlServer {
  private server: net.Server | null = null
  private handlers = new Map<string, ControlHandler>()

  constructor(public readonly socketPath: string) {}

  handle(op: string, handler: ControlHandler): void {
    this.handlers.set(op, handler)
  }

  start(): void {
    fs.mkdirSync(path.dirname(this.socketPath), { recursive: true })
    // A stale socket file from a crashed instance would refuse the bind.
    if (fs.existsSync(this.socketPath)) fs.unlinkSync(this.socketPath)
    this.server = net.createServer((conn) => this.serve(conn))
    this.server.on('error', (err) => console.error('[sokking] control server error:', err))
    this.server.listen(this.socketPath, () => {
      // Only this user may talk to the app (it can open shells and tasks).
      try {
        fs.chmodSync(this.socketPath, 0o600)
      } catch {
        // best effort
      }
    })
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

  private serve(conn: net.Socket): void {
    let buf = ''
    conn.setEncoding('utf8')
    conn.on('data', (chunk: string) => {
      buf += chunk
      let newline: number
      while ((newline = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, newline).trim()
        buf = buf.slice(newline + 1)
        if (line) void this.dispatch(line, conn)
      }
    })
    conn.on('error', () => {})
  }

  /** Runs a request through its handler; failures come back as {ok: false}. */
  async invoke(req: ControlRequest): Promise<ControlResponse | { ok: false; error: string }> {
    try {
      const handler = typeof req.op === 'string' ? this.handlers.get(req.op) : undefined
      if (!handler) throw new Error(`不明な op: ${String(req.op)}`)
      return await handler(req)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  private async dispatch(line: string, conn: net.Socket): Promise<void> {
    let response: Record<string, unknown>
    try {
      response = await this.invoke(JSON.parse(line) as ControlRequest)
    } catch (e) {
      response = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    if (!conn.destroyed) conn.write(JSON.stringify(response) + '\n')
  }
}

/** One round trip for callers inside the app's own process tree (tests, scripts). */
export function controlRequest(
  socketPath: string,
  req: ControlRequest,
  timeoutMs = 3000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(socketPath)
    let buf = ''
    const timer = setTimeout(() => {
      conn.destroy()
      reject(new Error('control socket timeout'))
    }, timeoutMs)
    conn.setEncoding('utf8')
    conn.on('connect', () => conn.write(JSON.stringify(req) + '\n'))
    conn.on('data', (chunk: string) => {
      buf += chunk
      const newline = buf.indexOf('\n')
      if (newline === -1) return
      clearTimeout(timer)
      conn.end()
      try {
        resolve(JSON.parse(buf.slice(0, newline)) as Record<string, unknown>)
      } catch (e) {
        reject(e)
      }
    })
    conn.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}
