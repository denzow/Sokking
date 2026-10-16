import { afterEach, describe, expect, it } from 'vitest'
import { ControlServer } from '../../src/core/control-server'
import { HttpControlServer } from '../../src/core/http-server'
import { BACKOFF_INITIAL_MS, BACKOFF_MAX_MS, looksRateLimited, RateLimitGuard } from '../../src/core/rate-limit'

describe('RateLimitGuard', () => {
  it('recognizes rate-limit phrases, even split across chunks', () => {
    expect(looksRateLimited("You've hit your usage limit")).toBe(true)
    expect(looksRateLimited('Rate limit exceeded')).toBe(true)
    expect(looksRateLimited('all good')).toBe(false)
    const guard = new RateLimitGuard()
    expect(guard.noteOutput('t', 'usage li', 0)).toBe(false)
    expect(guard.noteOutput('t', 'mit reached', 0)).toBe(true)
  })

  it('pauses with exponential backoff and resets after quiet time', () => {
    const guard = new RateLimitGuard()
    guard.hit(0)
    expect(guard.isPaused(1)).toBe(true)
    expect(guard.isPaused(BACKOFF_INITIAL_MS + 1)).toBe(false)
    // A hit during the pause doesn't restart it.
    guard.hit(10)
    expect(guard.status(11).pausedUntil).toBe(new Date(BACKOFF_INITIAL_MS).toISOString())
    const t2 = BACKOFF_INITIAL_MS + 1000
    guard.hit(t2)
    expect(guard.isPaused(t2 + BACKOFF_INITIAL_MS * 2 - 1)).toBe(true)
    expect(guard.isPaused(t2 + BACKOFF_INITIAL_MS * 2 + 1)).toBe(false)
    expect(guard.status(t2).hits).toBe(2)
    // Long quiet → back to the initial backoff.
    const t3 = t2 + 3 * 3_600_000
    guard.hit(t3)
    expect(guard.isPaused(t3 + BACKOFF_INITIAL_MS + 1)).toBe(false)
    guard.resume()
    expect(guard.isPaused(t3 + 1)).toBe(false)
    // Never beyond the cap.
    let t = t3 + 1
    for (let i = 0; i < 12; i++) {
      guard.hit(t)
      t += BACKOFF_MAX_MS + 1
    }
    guard.hit(t)
    expect(guard.isPaused(t + BACKOFF_MAX_MS - 1)).toBe(true)
    expect(guard.isPaused(t + BACKOFF_MAX_MS + 1)).toBe(false)
  })
})

describe('HttpControlServer', () => {
  const servers: HttpControlServer[] = []
  afterEach(() => {
    for (const s of servers.splice(0)) s.stop()
  })

  it('maps the HTTP routes onto control ops', async () => {
    const control = new ControlServer('/nonexistent')
    control.handle('ping', () => ({ ok: true }))
    control.handle('task.add', (req) => ({ ok: true, task: { id: 1, title: req.title } }))
    control.handle('task.list', (req) => ({ ok: true, tasks: [], status: req.status }))
    const server = new HttpControlServer((req) => control.invoke(req))
    server.start(0)
    servers.push(server)
    await new Promise((r) => setTimeout(r, 50))
    const base = `http://127.0.0.1:${server.port}`
    expect(await (await fetch(`${base}/ping`)).json()).toEqual({ ok: true })
    const created = await fetch(`${base}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'hello' })
    })
    expect(created.status).toBe(201)
    expect(await created.json()).toEqual({ ok: true, task: { id: 1, title: 'hello' } })
    expect(await (await fetch(`${base}/tasks?status=inbox`)).json()).toEqual({ ok: true, tasks: [], status: 'inbox' })
    const bad = await fetch(`${base}/tasks`, { method: 'POST', body: '[1]' })
    expect(bad.status).toBe(400)
    expect((await fetch(`${base}/nope`)).status).toBe(404)
  })
})
