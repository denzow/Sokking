import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ControlServer, controlRequest } from '../../src/core/control-server'

const servers: ControlServer[] = []

afterEach(() => {
  for (const s of servers.splice(0)) s.stop()
})

function start(): ControlServer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sokking-ctl-'))
  const server = new ControlServer(path.join(dir, 'control.sock'))
  server.handle('ping', () => ({ ok: true, pong: true }))
  server.handle('echo', (req) => ({ ok: true, echo: req.text }))
  server.handle('boom', () => {
    throw new Error('kaboom')
  })
  server.start()
  servers.push(server)
  return server
}

describe('ControlServer', () => {
  it('answers a registered op', async () => {
    const server = start()
    const res = await controlRequest(server.socketPath, { op: 'echo', text: 'hi' })
    expect(res).toEqual({ ok: true, echo: 'hi' })
  })

  it('reports handler errors and unknown ops without dropping the connection', async () => {
    const server = start()
    expect(await controlRequest(server.socketPath, { op: 'boom' })).toEqual({
      ok: false,
      error: 'kaboom'
    })
    const unknown = await controlRequest(server.socketPath, { op: 'nope' })
    expect(unknown.ok).toBe(false)
    expect(String(unknown.error)).toContain('nope')
  })

  it('replaces a stale socket file on start', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sokking-ctl-'))
    const sock = path.join(dir, 'control.sock')
    fs.writeFileSync(sock, '')
    const server = new ControlServer(sock)
    server.handle('ping', () => ({ ok: true }))
    server.start()
    servers.push(server)
    expect(await controlRequest(sock, { op: 'ping' })).toEqual({ ok: true })
  })
})
