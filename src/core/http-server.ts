import http from 'node:http'
import type { ControlRequest, ControlResponse } from './control-server'

export type ControlInvoke = (req: ControlRequest) => Promise<ControlResponse | { ok: false; error: string }>

const BODY_LIMIT = 1024 * 1024

/**
 * A loopback-only HTTP face of the control socket, for tools that find
 * curl easier than a Unix socket (browser extensions, scripts on the same
 * machine, Workflow-style webhooks pointed at localhost).
 *
 *   POST /tasks   {"title": "...", "body": "...", "workdir": "...", "sourceRef": "..."}
 *   GET  /tasks?status=inbox
 *   GET  /ping
 */
export class HttpControlServer {
  private server: http.Server | null = null

  constructor(
    private invoke: ControlInvoke,
    private log: (message: string) => void = () => {}
  ) {}

  get port(): number | null {
    const address = this.server?.address()
    return address && typeof address === 'object' ? address.port : null
  }

  start(port: number): void {
    this.stop()
    const server = http.createServer((req, res) => void this.handle(req, res))
    server.on('error', (err) => this.log(`HTTP の待ち受けに失敗: ${err.message}`))
    server.listen(port, '127.0.0.1', () => this.log(`HTTP: http://127.0.0.1:${this.port}/`))
    this.server = server
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(body) + '\n')
    }
    try {
      if (req.method === 'GET' && url.pathname === '/ping') {
        send(200, await this.invoke({ op: 'ping' }))
        return
      }
      if (req.method === 'GET' && url.pathname === '/tasks') {
        const result = await this.invoke({ op: 'task.list', status: url.searchParams.get('status') })
        send(result.ok ? 200 : 400, result)
        return
      }
      if (req.method === 'POST' && url.pathname === '/tasks') {
        const body = await readJson(req)
        const result = await this.invoke({ op: 'task.add', ...body })
        send(result.ok ? 201 : 400, result)
        return
      }
      send(404, { ok: false, error: 'not found' })
    } catch (e) {
      send(400, { ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      data += chunk
      if (data.length > BODY_LIMIT) {
        reject(new Error('body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!data.trim()) {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(data) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new Error('JSON object expected'))
        } else {
          resolve(parsed as Record<string, unknown>)
        }
      } catch (e) {
        reject(new Error(`invalid JSON: ${e instanceof Error ? e.message : e}`))
      }
    })
    req.on('error', reject)
  })
}
